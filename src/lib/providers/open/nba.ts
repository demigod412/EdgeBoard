/*
 * balldontlie (api.balldontlie.io) — free NBA data with a free API key (sign up at app.balldontlie.io).
 * Free tier is rate-limited (≈5 requests/minute), so pages are spaced out; runs in the background sync process.
 */
import type { PGame, PStatus, SportProvider } from "../types";
import { getJson, sleep } from "./http";

const BASE = "https://api.balldontlie.io/v1";
type Team = { id: number; full_name?: string; name?: string; abbreviation?: string };
export type BdlGame = { id: number; date: string; datetime?: string | null; season?: number; status: string; period?: number; postseason?: boolean;
  home_team: Team; visitor_team: Team; home_team_score?: number; visitor_team_score?: number;
  home_q1?: number | null; home_q2?: number | null; home_q3?: number | null; home_q4?: number | null; home_ot1?: number | null;
  visitor_q1?: number | null; visitor_q2?: number | null; visitor_q3?: number | null; visitor_q4?: number | null; visitor_ot1?: number | null };

export function bdlStatus(g: BdlGame): PStatus {
  const s = (g.status ?? "").toLowerCase();
  if (s === "final") return "FINISHED";
  if (s.includes("postponed")) return "POSTPONED";
  if (s.includes("cancel")) return "CANCELLED";
  if ((g.period ?? 0) > 0 || /qtr|half|ot/.test(s)) return "LIVE";
  return "SCHEDULED";
}
export function bdlStart(g: BdlGame): Date {
  if (g.datetime) return new Date(g.datetime);
  if (/^\d{4}-\d{2}-\d{2}T/.test(g.status)) return new Date(g.status);
  return new Date(`${g.date.slice(0, 10)}T23:00:00Z`); // date only: evening US tip-off
}
export function parseBdl(g: BdlGame): PGame {
  const status = bdlStatus(g), fin = status === "FINISHED";
  const q = (side: "home" | "visitor", n: number) => g[`${side}_q${n}` as keyof BdlGame] as number | null | undefined;
  const half = (side: "home" | "visitor") => (q(side, 1) != null && q(side, 2) != null ? q(side, 1)! + q(side, 2)! : null);
  const reg = (side: "home" | "visitor") => ([1, 2, 3, 4].every((n) => q(side, n) != null) ? [1, 2, 3, 4].reduce((s, n) => s + q(side, n)!, 0) : null);
  const h = fin ? g.home_team_score ?? null : null, a = fin ? g.visitor_team_score ?? null : null;
  const extra = fin && ((g.period ?? 4) > 4 || g.home_ot1 != null);
  return {
    externalId: String(g.id), leagueExternalId: "NBA", startUtc: bdlStart(g), status,
    home: { externalId: String(g.home_team.id), name: g.home_team.full_name ?? g.home_team.name ?? String(g.home_team.id) },
    away: { externalId: String(g.visitor_team.id), name: g.visitor_team.full_name ?? g.visitor_team.name ?? String(g.visitor_team.id) },
    homeScore: h, awayScore: a, homeReg: fin ? reg("home") ?? (extra ? null : h) : null, awayReg: fin ? reg("visitor") ?? (extra ? null : a) : null,
    homeSeg: fin ? half("home") : null, awaySeg: fin ? half("visitor") : null, extraTime: extra,
  };
}
type Page = { data: BdlGame[]; meta?: { next_cursor?: number | null } };
/** The WNBA feed may name fields differently (home_score / away_team); map them onto the NBA shape. */
function normWnba(g: BdlGame & { home_score?: number; away_score?: number; away_team?: BdlGame["visitor_team"] }): BdlGame {
  return { ...g, visitor_team: g.visitor_team ?? g.away_team!, home_team_score: g.home_team_score ?? g.home_score, visitor_team_score: g.visitor_team_score ?? g.away_score };
}

/** balldontlie free tier ≈ 5 requests/minute: space EVERY request (not just pages) and wait out 429s. */
let lastCall = 0;
async function spaced<T>(fn: () => Promise<T>): Promise<T> {
  const gap = Number(process.env.BALLDONTLIE_PAGE_DELAY_MS ?? 13_000);
  for (let attempt = 0; ; attempt++) {
    const wait = lastCall + gap - Date.now(); if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    try { return await fn(); }
    catch (e) { if (attempt < 3 && /429/.test((e as Error).message)) { await sleep(gap * 2); continue; } throw e; }
  }
}

export function nbaOpen(key: string): SportProvider {
  const H = { Authorization: key };
  const base = (league: string) => (league === "WNBA" ? "https://api.balldontlie.io/wnba/v1" : BASE);
  const pages = async (query: string, league = "NBA") => {
    const out: PGame[] = []; let cursor: number | null | undefined;
    for (let i = 0; i < 40; i++) {
      let r: Page;
      try { r = await spaced(() => getJson<Page>(`${base(league)}/games?per_page=100&${query}${cursor ? `&cursor=${cursor}` : ""}`, H)); }
      catch (e) { if (league === "WNBA" && /HTTP 40[13]/.test((e as Error).message)) throw new Error("WNBA isn't included in your balldontlie plan"); throw e; }
      out.push(...r.data.map((g) => ({ ...parseBdl(normWnba(g)), leagueExternalId: league }))); cursor = r.meta?.next_cursor;
      if (!cursor) break;
    }
    return out;
  };
  return {
    sport: "basketball", source: "OPEN", name: "balldontlie",
    leagues: [{ id: "NBA", name: "NBA", country: "USA", focus: true }, { id: "WNBA", name: "WNBA", country: "USA", focus: true, season: String(new Date().getUTCFullYear()), prevSeason: String(new Date().getUTCFullYear() - 1) }],
    season: (now) => String(now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1),
    prevSeason: (s) => String(Number(s) - 1),
    async seasonGames(league, season) { return pages(`seasons[]=${season}`, league); },
    async gamesOn(date) {
      const nba = await pages(`dates[]=${date}`, "NBA");
      const wnba = await pages(`dates[]=${date}`, "WNBA").catch(() => [] as PGame[]);
      return [...nba, ...wnba];
    },
    async testConnection() {
      try { await spaced(() => getJson<unknown>(`${BASE}/teams?per_page=1`, H)); return { ok: true, message: "balldontlie: connected" }; }
      catch (e) { return { ok: false, message: `balldontlie: ${(e as Error).message}` }; }
    },
  };
}
