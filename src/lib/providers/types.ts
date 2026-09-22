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

/** Every data source for EdgeBoard implements this. */
export interface SportProvider {
  sport: SportId;
  source: "API_SPORTS" | "OPEN";
  name: string;
  leagues: { id: string; name: string; focus?: boolean }[];
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
