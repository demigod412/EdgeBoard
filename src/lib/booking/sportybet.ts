import "server-only";
import type { Mkt } from "../markets";
import type { SportId } from "../sports";

/*
 * Sportybet booking code — EXPERIMENTAL, UNOFFICIAL (Sportybet has no public API).
 * Uses the endpoints Sportybet's website uses: pcUpcomingEvents (events + markets) and orders/share (creates a code, stakes nothing).
 * Basketball / baseball / ice hockey markets are matched by their description, so some legs may not map; those are listed, never dropped.
 */
const BASE = process.env.SPORTYBET_BASE_URL ?? "https://www.sportybet.com";
const REGION = (process.env.SPORTYBET_REGION ?? "ng").toLowerCase();
const HEADERS = { Accept: "application/json", "Content-Type": "application/json", "Current-Country": REGION.toUpperCase(), "User-Agent": "Mozilla/5.0 (EdgeBoard booking helper)" };
const SPORT_ID: Record<SportId, string> = { basketball: "sr:sport:2", baseball: "sr:sport:3", hockey: "sr:sport:4" };

interface SbOutcome { id: string; desc: string; isActive?: number }
interface SbMarket { id: string; desc?: string; specifier?: string; outcomes?: SbOutcome[] }
export interface SbEvent { eventId: string; homeTeamName: string; awayTeamName: string; estimateStartTime: number; markets?: SbMarket[] }
export interface BookLeg { gameId: string; sport: SportId; mkt: Mkt; home: string; away: string; start: Date; label: string }

const STOP = new Set(["fc", "sc", "hc", "bc", "the", "club", "de", "and", "&"]);
export const normName = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w));
function nameScore(a: string, b: string) {
  const x = normName(a), y = normName(b); if (!x.length || !y.length) return 0;
  return x.filter((w) => y.some((v) => v === w || (w.length >= 3 && v.length >= 3 && (v.startsWith(w) || w.startsWith(v))))).length / Math.max(x.length, y.length);
}
export function matchEvent(events: SbEvent[], home: string, away: string, start: Date): SbEvent | null {
  let best: { e: SbEvent; s: number } | null = null;
  for (const e of events) {
    if (Math.abs(e.estimateStartTime - start.getTime()) > 3 * 3600_000) continue;
    const sh = nameScore(home, e.homeTeamName), sa = nameScore(away, e.awayTeamName);
    if (sh < 0.5 || sa < 0.5) continue;
    if (!best || sh + sa > best.s) best = { e, s: sh + sa };
  }
  return best?.e ?? null;
}
const has = (d: string | undefined, ...w: string[]) => !!d && w.every((x) => d.toLowerCase().includes(x));
/** Map a market by description: winner (incl. OT), totals and handicaps at the same line, 1st half/period totals. */
export function resolveSelection(e: SbEvent, m: Mkt): { eventId: string; marketId: string; specifier: string | null; outcomeId: string } | { error: string } {
  const ms = e.markets ?? [];
  const pick = (mk: SbMarket | undefined, test: (o: SbOutcome) => boolean) => {
    if (!mk) return { error: "market not offered" };
    const o = (mk.outcomes ?? []).find((x) => test(x) && x.isActive !== 0);
    return o ? { eventId: e.eventId, marketId: mk.id, specifier: mk.specifier ?? null, outcomeId: o.id } : { error: "selection not available" };
  };
  const full = (x: SbMarket) => !/(1st|2nd|3rd|4th|half|quarter|period|inning|innings)/i.test(x.desc ?? "");
  switch (m.kind) {
    case "win": return pick(ms.find((x) => full(x) && /winner|moneyline|home\/away/i.test(x.desc ?? "") && (x.outcomes?.length ?? 0) === 2), (o) => (m.side === "home" ? has(o.desc, "home") || o.desc === "1" : has(o.desc, "away") || o.desc === "2"));
    case "total": return pick(ms.find((x) => full(x) && /total|over\/under/i.test(x.desc ?? "") && !/home|away/i.test(x.desc ?? "") && x.specifier === `total=${m.line}`), (o) => has(o.desc, m.side));
    case "spread": { const hcp = m.side === "home" ? m.line! : -m.line!;
      return pick(ms.find((x) => full(x) && /handicap|spread|run line|puck line/i.test(x.desc ?? "") && x.specifier === `hcp=${hcp}`), (o) => has(o.desc, m.side) || o.desc === (m.side === "home" ? "1" : "2")); }
    case "seg": return pick(ms.find((x) => /(1st half|first half|1st period|first 5|5 innings)/i.test(x.desc ?? "") && /total|over\/under/i.test(x.desc ?? "") && x.specifier === `total=${m.line}`), (o) => has(o.desc, m.side));
    default: return { error: "market not supported by Sportybet export" };
  }
}
async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15_000);
  try { const r = await fetch(url, { ...init, headers: HEADERS, signal: ctl.signal, cache: "no-store" }); if (!r.ok) throw new Error(`Sportybet HTTP ${r.status}`); return (await r.json()) as T; }
  finally { clearTimeout(t); }
}
export async function sportybetBook(legs: BookLeg[]) {
  const found = new Map<string, SbEvent>();
  for (const sport of [...new Set(legs.map((l) => l.sport))]) {
    const pending = legs.filter((l) => l.sport === sport);
    const hours = Math.min(720, Math.max(24, Math.ceil((Math.max(...pending.map((l) => l.start.getTime())) - Date.now()) / 3600_000) + 6));
    for (let page = 1; page <= 20 && pending.some((l) => !found.has(l.gameId)); page++) {
      type Resp = { bizCode: number; data?: { totalNum?: number; tournaments?: { events: SbEvent[] }[] } };
      const r = await getJson<Resp>(`${BASE}/api/${REGION}/factsCenter/pcUpcomingEvents?sportId=${encodeURIComponent(SPORT_ID[sport])}&pageSize=100&pageNum=${page}&todayGames=false&timeline=${hours}&_t=${Date.now()}`);
      if (r.bizCode !== 10000) throw new Error(`Sportybet returned code ${r.bizCode}`);
      const events = (r.data?.tournaments ?? []).flatMap((t) => t.events ?? []);
      if (!events.length) break;
      for (const l of pending) if (!found.has(l.gameId)) { const e = matchEvent(events, l.home, l.away, l.start); if (e) found.set(l.gameId, e); }
      if (page * 100 >= (r.data?.totalNum ?? 0)) break;
      await new Promise((res) => setTimeout(res, 300));
    }
  }
  const selections: { eventId: string; marketId: string; specifier: string | null; outcomeId: string }[] = [], unbookable: { label: string; reason: string }[] = [];
  for (const l of legs) {
    const e = found.get(l.gameId);
    if (!e) { unbookable.push({ label: `${l.away} at ${l.home}: ${l.label}`, reason: "game not found on Sportybet" }); continue; }
    const s = resolveSelection(e, l.mkt);
    if ("error" in s) unbookable.push({ label: `${l.away} at ${l.home}: ${l.label}`, reason: s.error }); else selections.push(s);
  }
  if (!selections.length) return { code: null, url: null, unbookable };
  type Share = { bizCode: number; message?: string; data?: { shareCode?: string; shareURL?: string; unavailableOutcomes?: unknown[] } };
  const res = await getJson<Share>(`${BASE}/api/${REGION}/orders/share`, { method: "POST", body: JSON.stringify({ selections }) });
  if (res.bizCode !== 10000 || !res.data?.shareCode) throw new Error(`Sportybet did not return a code (${res.message ?? res.bizCode})`);
  const un = res.data.unavailableOutcomes?.length ?? 0;
  if (un) unbookable.push({ label: `${un} selection(s)`, reason: "rejected by Sportybet as unavailable" });
  return { code: res.data.shareCode, url: res.data.shareURL ?? `${BASE}/${REGION}/?shareCode=${res.data.shareCode}`, unbookable };
}
