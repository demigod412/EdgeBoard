import type { GameStatus } from "@prisma/client";
import { SPORTS, type SportId } from "./sports";

export const GAME_VIEWS = ["upcoming", "live", "finished"] as const;
export type GameView = (typeof GAME_VIEWS)[number];
export const VIEW_LABEL: Record<GameView, string> = { upcoming: "Upcoming", live: "Live", finished: "Finished" };

export const isGameView = (s: string | undefined): s is GameView => !!s && (GAME_VIEWS as readonly string[]).includes(s);

/** A game the provider has reported in progress gets this much longer before LIVE is treated as stale. */
export const LIVE_STATUS_GRACE = 60;

/**
 * Which board tab a game belongs in.
 *
 * The stored status alone is not enough. A provider status of LIVE is only written when a job happens
 * to run while the game is in progress, and a full sync runs every three hours — so a 19:00 tip-off
 * usually still reads SCHEDULED until 22:00, by which point it is over. A Live tab built on the raw
 * status would sit empty through most of a game night. Start time decides for anything still SCHEDULED,
 * using that sport's own length (basketball 150 minutes, hockey 160, baseball 200 — the same figures
 * the results job uses to decide a game should have ended).
 *
 * Postponed and cancelled games belong in none of the three: not played, not bettable. They are
 * counted separately rather than hidden without trace.
 */
export function gameView(g: { status: GameStatus; startUtc: Date }, sport: SportId, now: Date): GameView | "off" {
  if (g.status === "POSTPONED" || g.status === "CANCELLED") return "off";
  if (g.status === "FINISHED") return "finished";
  const since = now.getTime() - g.startUtc.getTime();
  if (since < 0) return "upcoming";
  // Baseball has no clock and hockey/basketball can run to multiple overtimes, so a game the provider
  // says is live gets extra room before we overrule it.
  const window = SPORTS[sport].liveMinutes + (g.status === "LIVE" ? LIVE_STATUS_GRACE : 0);
  return since <= window * 60_000 ? "live" : "finished";
}

export function countViews<T extends { status: GameStatus; startUtc: Date }>(games: T[], sport: SportId, now: Date) {
  const n: Record<GameView | "off", number> = { upcoming: 0, live: 0, finished: 0, off: 0 };
  for (const g of games) n[gameView(g, sport, now)]++;
  return n;
}
