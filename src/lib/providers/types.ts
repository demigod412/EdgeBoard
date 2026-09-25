import type { SportId } from "../sports";

export type PStatus = "SCHEDULED" | "LIVE" | "FINISHED" | "POSTPONED" | "CANCELLED";
export interface PTeam { externalId: string; name: string; logoUrl?: string }
export interface PGame {
  externalId: string; leagueExternalId: string; startUtc: Date; status: PStatus; home: PTeam; away: PTeam;
  homeScore: number | null; awayScore: number | null; homeReg: number | null; awayReg: number | null;
  homeSeg: number | null; awaySeg: number | null; extraTime: boolean;
  homeFirst?: number | null; awayFirst?: number | null;
  newsReady?: boolean; // e.g. both MLB probable pitchers announced
}
export interface PLines { total?: number; spread?: number; seg?: number; moneyline?: [number, number]; bookmaker?: string; prices?: Record<string, [number, number]> }

export interface LeagueRef { id: string; name: string; country?: string; focus?: boolean; season?: string; prevSeason?: string }

/** Every data source for EdgeBoard implements this. */
export interface SportProvider {
  sport: SportId;
  source: "API_SPORTS" | "OPEN";
  name: string;
  leagues: LeagueRef[];
  /** Optional live league discovery (API-Sports): which of the wanted leagues exist on your plan, with their current season. */
  discoverLeagues?(): Promise<LeagueRef[]>;
  /**
   * Every competition the plan lists, unfiltered by WANTED. Diagnostics only (`sourcecheck --all`):
   * leagues are matched by country + name, so a provider that spells one differently is skipped
   * silently. This is how you see what was skipped and why.
   */
  rawLeagues?(): Promise<{ id: string; name: string; country: string; type: string; seasons: string[] }[]>;
  season(now: Date): string;
  prevSeason(season: string): string;
  seasonGames(leagueId: string, season: string): Promise<PGame[]>;
  gamesOn(date: string): Promise<PGame[]>;
  /** Bookmaker lines (API-Sports only). */
  odds?(gameExternalId: string): Promise<PLines>;
  /** Fill in first-segment scores that the season list lacks (NHL 1st period). Returns externalId → [home, away]. */
  segmentScores?(dates: string[]): Promise<Map<string, [number, number]>>;
  testConnection(): Promise<{ ok: boolean; message: string }>;
}
