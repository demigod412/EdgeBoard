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

export function nbaOpen(key: string): SportProvider {
  const H = { Authorization: key };
  const pages = async (query: string) => {
    const out: PGame[] = []; let cursor: number | null | undefined;
    for (let i = 0; i < 40; i++) {
      const r = await getJson<Page>(`${BASE}/games?per_page=100&${query}${cursor ? `&cursor=${cursor}` : ""}`, H);
      out.push(...r.data.map(parseBdl)); cursor = r.meta?.next_cursor;
      if (!cursor) break;
      await sleep(Number(process.env.BALLDONTLIE_PAGE_DELAY_MS ?? 13_000)); // free tier ≈ 5 requests / minute
    }
    return out;
  };
  return {
    sport: "basketball", source: "OPEN", name: "balldontlie", leagues: [{ id: "NBA", name: "NBA", focus: true }],
    season: (now) => String(now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1),
    prevSeason: (s) => String(Number(s) - 1),
    async seasonGames(_l, season) { return pages(`seasons[]=${season}`); },
    async gamesOn(date) { return pages(`dates[]=${date}`); },
    async testConnection() {
      try { await getJson<unknown>(`${BASE}/teams?per_page=1`, H); return { ok: true, message: "balldontlie: connected" }; }
      catch (e) { return { ok: false, message: `balldontlie: ${(e as Error).message}` }; }
    },
  };
}
