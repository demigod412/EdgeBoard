import "server-only";
import { getSecret, getSetting } from "../secrets";
import { apiSports } from "./apiSports";
import { mlbOpen } from "./open/mlb";
import { nhlOpen } from "./open/nhl";
import { nbaOpen } from "./open/nba";
import type { SportProvider } from "./types";
import type { SportId } from "../sports";

export type SourceChoice = "open" | "api-sports";
export const DEFAULT_SOURCES: Record<SportId, SourceChoice> = { basketball: "open", baseball: "open", hockey: "open" };

/**
 * Data source per sport (Settings → Data sources):
 *   open       → free official sources: MLB Stats API, NHL API (no key), balldontlie for NBA (free key)
 *   api-sports → API-Sports (needs a paid plan for current seasons; adds bookmaker odds and more leagues)
 * null ⇒ DEMO for that sport (switched off, or the chosen source has no key).
 */
export async function getProvider(sport: SportId): Promise<SportProvider | null> {
  const enabled = await getSetting<Record<string, boolean>>("sportsEnabled", { basketball: true, baseball: true, hockey: true });
  if (enabled[sport] === false) return null;
  const choice = { ...DEFAULT_SOURCES, ...(await getSetting<Partial<Record<SportId, SourceChoice>>>("sources", {})) }[sport];
  if (choice === "api-sports") {
    const key = await getSecret("API_SPORTS_KEY"), rapid = await getSecret("RAPIDAPI_KEY");
    return key || rapid ? apiSports(sport, { key: key ?? undefined, rapidKey: rapid ?? undefined }) : null;
  }
  if (sport === "baseball") return mlbOpen();
  if (sport === "hockey") return nhlOpen();
  const bdl = await getSecret("BALLDONTLIE_API_KEY");
  return bdl ? nbaOpen(bdl) : null;
}
