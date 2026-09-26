import "server-only";
import type { Mkt } from "../markets";
import type { SportId } from "../sports";

/*
 * Sportybet booking code — EXPERIMENTAL, UNOFFICIAL (Sportybet has no public API).
 * Uses the endpoints Sportybet's own website uses:
 *   GET  /api/{region}/factsCenter/pcUpcomingEvents   (events + markets + outcome ids)
 *   POST /api/{region}/orders/share                   (creates a booking code; stakes nothing)
 *
 * `marketId` is REQUIRED on pcUpcomingEvents. Omitting it does not return "all markets" — the endpoint
 * answers `bizCode 19000 "Invalid"` and nothing works at all. This is why booking never produced a code
 * for any sport here, while the football app (which has always sent marketId) worked.
 *
 * Markets and outcomes are matched by **id**, not by description text. The descriptions are not what one
 * would guess: basketball's plain "1X2" is a three-way market for regular time only, so a moneyline that
 * includes overtime has to come from "Winner (incl. overtime)" (219) instead. Ids are stable; wording is
 * not. Every id below was read off the live endpoint rather than assumed.
 */
const BASE = process.env.SPORTYBET_BASE_URL ?? "https://www.sportybet.com";
const REGION = (process.env.SPORTYBET_REGION ?? "ng").toLowerCase();
const HEADERS = { Accept: "application/json", "Content-Type": "application/json", "Current-Country": REGION.toUpperCase(), "User-Agent": "Mozilla/5.0 (EdgeBoard booking helper)" };

/** Outcome ids, shared across sports for the market shapes we use. */
const OUT = { homeOf2: "4", awayOf2: "5", over: "12", under: "13", hcpHome: "1714", hcpAway: "1715", home3: "1", draw3: "2", away3: "3", yes: "74", no: "76" } as const;

interface SportMap {
  sportId: string;
  /** The marketId list to request. Everything we can map, so one pass covers every leg. */
  markets: string;
  win: string;            // winner including overtime / extra innings
  total: string;          // game total including overtime / extra innings
  spread: string;         // handicap including overtime / extra innings
  seg?: string;           // first-segment total (1st half / 1st period)
  segSuffix?: string;     // extra specifier the segment market needs, e.g. periodnr=1
  teamTotal?: { any: string } | { home: string; away: string };
  reg3?: string;          // regulation three-way
  btts?: string;
}

/** Verified against the live endpoint on 2026-09-26. */
export const SPORTYBET_MARKETS: Record<SportId, SportMap> = {
  // 219 Winner (incl. overtime) · 225 Over/Under (incl. overtime) · 223 Handicap (incl. overtime)
  // 227 <Team> Over/Under (incl. overtime) · 68 1st Half - Over/Under
  basketball: { sportId: "sr:sport:2", markets: "219,225,223,227,68", win: "219", total: "225", spread: "223", seg: "68", teamTotal: { any: "227" } },
  // 251 Winner (incl. extra innings) · 258 Total (incl. extra innings) · 256 Handicap (incl. extra innings)
  // 260/261 home/away team total (incl. extra innings)
  baseball: { sportId: "sr:sport:3", markets: "251,258,256,260,261", win: "251", total: "258", spread: "256", teamTotal: { home: "260", away: "261" } },
  // 406 Winner (incl. overtime and penalties) · 412 Total (same) · 410 Handicap (same)
  // 446 1st period - total · 1 1X2 (regulation) · 29 GG/NG
  hockey: { sportId: "sr:sport:4", markets: "406,412,410,446,1,29", win: "406", total: "412", spread: "410", seg: "446", segSuffix: "periodnr=1", reg3: "1", btts: "29" },
};

interface SbOutcome { id: string; desc: string; isActive?: number }
interface SbMarket { id: string; desc?: string; specifier?: string; outcomes?: SbOutcome[] }
export interface SbEvent { eventId: string; homeTeamName: string; awayTeamName: string; estimateStartTime: number; markets?: SbMarket[] }
export interface BookLeg { gameId: string; sport: SportId; mkt: Mkt; home: string; away: string; start: Date; label: string }

const STOP = new Set(["fc", "sc", "hc", "bc", "the", "club", "de", "and", "&"]);
export const normName = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w));
function nameScore(a: string, b: string) {
  const x = normName(a), y = normName(b); if (!x.length || !y.length) return 0;
  return x.filter((w) => y.some((v) => v === w || (w.length >= 3 && v.length >= 3 && (v.startsWith(w) || w.startsWith(v))))).length / Math.max(x.length, y.length);
}
/** Does a market description name this team? Containment, not similarity: the description carries the team plus boilerplate. */
const descNamesTeam = (desc: string | undefined, team: string) => {
  if (!desc) return false;
  const d = normName(desc), t = normName(team);
  return t.length > 0 && t.every((w) => d.some((v) => v === w || (w.length >= 3 && v.startsWith(w))));
};

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

/** Sportybet writes lines without trailing zeros: total=5, total=185.5, hcp=-12.5. */
const num = (n: number) => String(n);

export type Selection = { eventId: string; marketId: string; specifier: string | null; outcomeId: string };

/** Map one EdgeBoard market onto a Sportybet selection, by market id and outcome id. */
export function resolveSelection(e: SbEvent, m: Mkt, sport: SportId, teams?: { home: string; away: string }): Selection | { error: string } {
  const S = SPORTYBET_MARKETS[sport];
  const find = (id: string | undefined, spec: string | null, extra?: (mk: SbMarket) => boolean) =>
    id ? (e.markets ?? []).find((x) => String(x.id) === id && (spec === null || x.specifier === spec) && (!extra || extra(x))) : undefined;
  const take = (mk: SbMarket | undefined, outcomeId: string): Selection | { error: string } => {
    if (!mk) return { error: "market not offered on this game" };
    const o = (mk.outcomes ?? []).find((x) => String(x.id) === outcomeId && x.isActive !== 0);
    return o ? { eventId: e.eventId, marketId: String(mk.id), specifier: mk.specifier ?? null, outcomeId: String(o.id) } : { error: "selection not available" };
  };
  const line = m.line;

  switch (m.kind) {
    case "win":
      return take(find(S.win, null), m.side === "home" ? OUT.homeOf2 : OUT.awayOf2);

    case "total":
      if (line == null) return { error: "no line on this market" };
      return take(find(S.total, `total=${num(line)}`), m.side === "over" ? OUT.over : OUT.under);

    case "spread": {
      if (line == null) return { error: "no line on this market" };
      // Sportybet states the handicap from the home team's point of view.
      const hcp = m.side === "home" ? line : -line;
      return take(find(S.spread, `hcp=${num(hcp)}`), m.side === "home" ? OUT.hcpHome : OUT.hcpAway);
    }

    case "seg": {
      if (line == null) return { error: "no line on this market" };
      if (!S.seg) return { error: `${sport} first-segment totals are not offered on Sportybet` };
      const spec = S.segSuffix ? `total=${num(line)}|${S.segSuffix}` : `total=${num(line)}`;
      return take(find(S.seg, spec), m.side === "over" ? OUT.over : OUT.under);
    }

    case "team_total": {
      if (line == null) return { error: "no line on this market" };
      const tt = S.teamTotal;
      if (!tt) return { error: `${sport} team totals are not offered on Sportybet` };
      // side is "home:over", "away:under", …
      const [who, dir] = m.side.split(":");
      const outcome = dir === "under" ? OUT.under : OUT.over;
      if ("any" in tt) {
        // One market id for both teams; the description names the team.
        const team = who === "home" ? teams?.home : teams?.away;
        if (!team) return { error: "team name unavailable for a team total" };
        return take(find(tt.any, `total=${num(line)}`, (x) => descNamesTeam(x.desc, team)), outcome);
      }
      return take(find(who === "home" ? tt.home : tt.away, `total=${num(line)}`), outcome);
    }

    case "reg3": {
      if (!S.reg3) return { error: `${sport} regulation three-way is not offered on Sportybet` };
      const o = m.side === "home" ? OUT.home3 : m.side === "away" ? OUT.away3 : OUT.draw3;
      return take(find(S.reg3, null), o);
    }

    case "btts":
      if (!S.btts) return { error: `${sport} both-teams-to-score is not offered on Sportybet` };
      return take(find(S.btts, null), m.side === "no" ? OUT.no : OUT.yes);

    default:
      return { error: `${m.kind} is not mapped to a Sportybet market` };
  }
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15_000);
  try { const r = await fetch(url, { ...init, headers: HEADERS, signal: ctl.signal, cache: "no-store" }); if (!r.ok) throw new Error(`Sportybet HTTP ${r.status}`); return (await r.json()) as T; }
  finally { clearTimeout(t); }
}

export async function sportybetBook(legs: BookLeg[], dropped: { label: string; reason: string }[] = []) {
  const found = new Map<string, SbEvent>();
  for (const sport of [...new Set(legs.map((l) => l.sport))]) {
    const S = SPORTYBET_MARKETS[sport];
    const pending = legs.filter((l) => l.sport === sport);
    const hours = Math.min(720, Math.max(24, Math.ceil((Math.max(...pending.map((l) => l.start.getTime())) - Date.now()) / 3600_000) + 6));
    for (let page = 1; page <= 20 && pending.some((l) => !found.has(l.gameId)); page++) {
      type Resp = { bizCode: number; message?: string; data?: { totalNum?: number; tournaments?: { events: SbEvent[] }[] } };
      const r = await getJson<Resp>(`${BASE}/api/${REGION}/factsCenter/pcUpcomingEvents?sportId=${encodeURIComponent(S.sportId)}&marketId=${encodeURIComponent(S.markets)}&pageSize=100&pageNum=${page}&todayGames=false&timeline=${hours}&_t=${Date.now()}`);
      if (r.bizCode !== 10000) throw new Error(`Sportybet returned code ${r.bizCode}${r.message ? ` (${r.message})` : ""}`);
      const events = (r.data?.tournaments ?? []).flatMap((t) => t.events ?? []);
      if (!events.length) break;
      for (const l of pending) if (!found.has(l.gameId)) { const e = matchEvent(events, l.home, l.away, l.start); if (e) found.set(l.gameId, e); }
      if (page * 100 >= (r.data?.totalNum ?? 0)) break;
      await new Promise((res) => setTimeout(res, 300));
    }
  }
  const selections: Selection[] = [], unbookable = [...dropped];
  for (const l of legs) {
    const e = found.get(l.gameId);
    if (!e) { unbookable.push({ label: `${l.away} at ${l.home}: ${l.label}`, reason: "game not found on Sportybet" }); continue; }
    const s = resolveSelection(e, l.mkt, l.sport, { home: l.home, away: l.away });
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
