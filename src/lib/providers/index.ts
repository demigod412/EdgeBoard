import "server-only";
import { getSecret, getSetting } from "../secrets";
import { apiSports, type SportProvider } from "./apiSports";
import type { SportId } from "../sports";

/** null ⇒ DEMO for that sport (no key, or the sport is switched off in Settings). */
export async function getProvider(sport: SportId): Promise<SportProvider | null> {
  const enabled = await getSetting<Record<string, boolean>>("sportsEnabled", { basketball: true, baseball: true, hockey: true });
  if (enabled[sport] === false) return null;
  const key = await getSecret("API_SPORTS_KEY"), rapid = await getSecret("RAPIDAPI_KEY");
  if (!key && !rapid) return null;
  return apiSports(sport, { key: key ?? undefined, rapidKey: rapid ?? undefined });
}
