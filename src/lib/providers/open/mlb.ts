/*
 * MLB Stats API (statsapi.mlb.com) — free, no key. Official MLB data; terms target personal / non-commercial use.
 * One request per season: schedule with linescore (innings → F5, 1st inning, extras) and probable pitchers.
 */
import type { PGame, PStatus, SportProvider } from "../types";
import { getJson } from "./http";

const BASE = "https://statsapi.mlb.com/api/v1";
const TYPES = "R,F,D,L,W"; // regular season + postseason rounds
type Side = { team: { id: number; name: string }; score?: number; probablePitcher?: { id: number; fullName?: string } };
type Inn = { num: number; home?: { runs?: number }; away?: { runs?: number } };
export type MlbGame = { gamePk: number; gameDate: string; gameType?: string; status: { abstractGameState?: string; detailedState?: string; codedGameState?: string };
  teams: { home: Side; away: Side }; linescore?: { innings?: Inn[] } };

export function mlbStatus(s: MlbGame["status"]): PStatus {
  const d = (s.detailedState ?? "").toLowerCase(), a = (s.abstractGameState ?? "").toLowerCase();
  if (d.includes("postponed") || d.includes("suspended")) return "POSTPONED";
  if (d.includes("cancel")) return "CANCELLED";
  if (a === "final" || d.startsWith("final") || d === "game over" || d.startsWith("completed")) return "FINISHED";
  if (a === "live" || d.includes("in progress") || d.includes("manager challenge") || d.includes("delayed")) return "LIVE";
  return "SCHEDULED";
}
export function parseMlb(g: MlbGame): PGame {
  const status = mlbStatus(g.status), inn = g.linescore?.innings ?? [];
  const sum = (side: "home" | "away", from: number, to: number) => {
    const xs = inn.filter((i) => i.num >= from && i.num <= to);
    if (xs.length < to - from + 1) return null;
    return xs.reduce((s, i) => s + (i[side]?.runs ?? 0), 0); // a missing bottom 9th (home leading) counts as 0
  };
  const fin = status === "FINISHED";
  return {
    externalId: String(g.gamePk), leagueExternalId: "MLB", startUtc: new Date(g.gameDate), status,
    home: { externalId: String(g.teams.home.team.id), name: g.teams.home.team.name },
    away: { externalId: String(g.teams.away.team.id), name: g.teams.away.team.name },
    homeScore: fin ? g.teams.home.score ?? null : null, awayScore: fin ? g.teams.away.score ?? null : null,
    homeReg: fin ? sum("home", 1, 9) ?? sum("home", 1, 8) : null, awayReg: fin ? sum("away", 1, 9) : null,
    homeSeg: fin ? sum("home", 1, 5) : null, awaySeg: fin ? sum("away", 1, 5) : null,
    homeFirst: fin ? sum("home", 1, 1) : null, awayFirst: fin ? sum("away", 1, 1) : null,
    extraTime: fin && inn.length > 9,
    newsReady: !!g.teams.home.probablePitcher && !!g.teams.away.probablePitcher,
  };
}
/** A postponed game can appear twice (original date + new date): keep the playable/final copy. */
export function dedupeMlb(games: PGame[]): PGame[] {
  const by = new Map<string, PGame>();
  for (const g of games) { const cur = by.get(g.externalId); if (!cur || (cur.status === "POSTPONED" && g.status !== "POSTPONED") || g.startUtc > cur.startUtc && g.status !== "POSTPONED") by.set(g.externalId, g); }
  return [...by.values()];
}
type Sched = { dates?: { games: MlbGame[] }[] };
const flat = (r: Sched) => dedupeMlb((r.dates ?? []).flatMap((d) => d.games).map(parseMlb));

export function mlbOpen(): SportProvider {
  return {
    sport: "baseball", source: "OPEN", name: "MLB Stats API", leagues: [{ id: "MLB", name: "MLB", country: "USA", focus: true }],
    season: (now) => String(now.getUTCFullYear()),
    prevSeason: (s) => String(Number(s) - 1),
    async seasonGames(_l, season) { return flat(await getJson<Sched>(`${BASE}/schedule?sportId=1&season=${season}&gameType=${TYPES}&hydrate=linescore,probablePitcher`)); },
    async gamesOn(date) { return flat(await getJson<Sched>(`${BASE}/schedule?sportId=1&date=${date}&hydrate=linescore,probablePitcher`)); },
    async testConnection() {
      try { const r = await getJson<Sched>(`${BASE}/schedule?sportId=1&date=${new Date().toISOString().slice(0, 10)}`); return { ok: true, message: `MLB Stats API: connected (${(r.dates ?? []).flatMap((d) => d.games).length} games today)` }; }
      catch (e) { return { ok: false, message: `MLB Stats API: ${(e as Error).message}` }; }
    },
  };
}
