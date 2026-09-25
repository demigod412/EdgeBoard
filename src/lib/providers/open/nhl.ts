/*
 * NHL web API (api-web.nhle.com) — free, no key, unofficial (can change without notice).
 * Season list: weekly schedule pages. 1st-period scores: /score/{date} (goals with running scores), back-filled a few dates per run.
 */
import type { PGame, PStatus, SportProvider } from "../types";
import { getJson, sleep, ymd } from "./http";

const BASE = "https://api-web.nhle.com/v1";
type Name = { default?: string } | string | undefined;
const txt = (n: Name) => (typeof n === "string" ? n : n?.default ?? "");
type Team = { id: number; abbrev?: string; placeName?: Name; commonName?: Name; name?: Name; score?: number; logo?: string };
type Goal = { period?: number; periodDescriptor?: { number?: number }; homeScore?: number; awayScore?: number };
export type NhlGame = { id: number; gameType?: number; gameState?: string; startTimeUTC: string; homeTeam: Team; awayTeam: Team;
  gameOutcome?: { lastPeriodType?: string }; periodDescriptor?: { periodType?: string }; goals?: Goal[] };

export function nhlStatus(s?: string): PStatus {
  const x = (s ?? "").toUpperCase();
  if (x === "FINAL" || x === "OFF") return "FINISHED";
  if (x === "LIVE" || x === "CRIT") return "LIVE";
  if (x === "PPD") return "POSTPONED";
  if (x === "CNCL") return "CANCELLED";
  return "SCHEDULED";
}
const teamName = (t: Team) => [txt(t.placeName), txt(t.commonName)].filter(Boolean).join(" ") || txt(t.name) || t.abbrev || String(t.id);
/** First-period score from running goal scores; null when the goal list is absent. */
export function nhlFirstPeriod(g: NhlGame): [number, number] | null {
  if (!Array.isArray(g.goals)) return null;
  const p1 = g.goals.filter((x) => (x.period ?? x.periodDescriptor?.number) === 1);
  const last = p1[p1.length - 1];
  return last ? [last.homeScore ?? 0, last.awayScore ?? 0] : [0, 0];
}
export function parseNhl(g: NhlGame): PGame | null {
  if (g.gameType != null && g.gameType !== 2 && g.gameType !== 3) return null; // skip preseason / all-star
  const status = nhlStatus(g.gameState), fin = status === "FINISHED";
  const h = fin ? g.homeTeam.score ?? null : null, a = fin ? g.awayTeam.score ?? null : null;
  const last = (g.gameOutcome?.lastPeriodType ?? g.periodDescriptor?.periodType ?? "REG").toUpperCase();
  const extra = fin && (last === "OT" || last === "SO");
  // OT / shootout add exactly one goal to the winner, so regulation ended level at the loser's score.
  const reg = h != null && a != null ? (extra ? [Math.min(h, a), Math.min(h, a)] : [h, a]) : [null, null];
  const p1 = fin ? nhlFirstPeriod(g) : null;
  return {
    externalId: String(g.id), leagueExternalId: "NHL", startUtc: new Date(g.startTimeUTC), status,
    home: { externalId: String(g.homeTeam.id), name: teamName(g.homeTeam), logoUrl: g.homeTeam.logo },
    away: { externalId: String(g.awayTeam.id), name: teamName(g.awayTeam), logoUrl: g.awayTeam.logo },
    homeScore: h, awayScore: a, homeReg: reg[0], awayReg: reg[1], homeSeg: p1?.[0] ?? null, awaySeg: p1?.[1] ?? null, extraTime: extra,
  };
}
type Week = { nextStartDate?: string; gameWeek?: { date: string; games: NhlGame[] }[] };
type Score = { games?: NhlGame[] };

export function nhlOpen(): SportProvider {
  return {
    sport: "hockey", source: "OPEN", name: "NHL API", leagues: [{ id: "NHL", name: "NHL", country: "USA", focus: true }],
    season: (now) => { const y = now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1; return `${y}${y + 1}`; },
    prevSeason: (s) => `${Number(s.slice(0, 4)) - 1}${Number(s.slice(0, 4))}`,
    async seasonGames(_l, season) {
      const y = Number(season.slice(0, 4));
      let d = `${y}-09-20`; const end = new Date(Math.min(Date.UTC(y + 1, 6, 1), Date.now() + 21 * 864e5));
      const out = new Map<string, PGame>();
      for (let i = 0; i < 45 && new Date(d) <= end; i++) {
        const w = await getJson<Week>(`${BASE}/schedule/${d}`);
        for (const day of w.gameWeek ?? []) for (const g of day.games ?? []) { const p = parseNhl(g); if (p) out.set(p.externalId, p); }
        const next = w.nextStartDate ?? ymd(new Date(new Date(d).getTime() + 7 * 864e5));
        if (next <= d) break;
        d = next; await sleep(250);
      }
      return [...out.values()];
    },
    async gamesOn(date) { const r = await getJson<Score>(`${BASE}/score/${date}`); return (r.games ?? []).map(parseNhl).filter((x): x is PGame => !!x); },
    async segmentScores(dates) {
      const out = new Map<string, [number, number]>();
      for (const d of dates) {
        const r = await getJson<Score>(`${BASE}/score/${d}`);
        for (const g of r.games ?? []) { if (nhlStatus(g.gameState) !== "FINISHED") continue; const p = nhlFirstPeriod(g); if (p) out.set(String(g.id), p); }
        await sleep(250);
      }
      return out;
    },
    async testConnection() {
      try { const r = await getJson<Week>(`${BASE}/schedule/${new Date().toISOString().slice(0, 10)}`); return { ok: true, message: `NHL API: connected (${(r.gameWeek ?? []).reduce((s, d) => s + (d.games?.length ?? 0), 0)} games this week)` }; }
      catch (e) { return { ok: false, message: `NHL API: ${(e as Error).message}` }; }
    },
  };
}
