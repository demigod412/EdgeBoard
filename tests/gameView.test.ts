import { describe, expect, it } from "vitest";
import { countViews, gameView, isGameView, LIVE_STATUS_GRACE } from "@/lib/gameView";
import { SPORTS } from "@/lib/sports";
import type { GameStatus } from "@prisma/client";

const NOW = new Date("2026-09-26T23:00:00Z");
const at = (minutesFromNow: number, status: GameStatus = "SCHEDULED") =>
  ({ status, startUtc: new Date(NOW.getTime() + minutesFromNow * 60_000) });

describe("which board tab a game belongs in", () => {
  it("puts games that have not started in upcoming", () => {
    expect(gameView(at(1), "basketball", NOW)).toBe("upcoming");
    expect(gameView(at(60 * 24 * 3), "baseball", NOW)).toBe("upcoming");
  });

  it("uses each sport's own length, not one number for all three", () => {
    // Baseball has no clock and runs far longer than a basketball game. At 170 minutes in, a
    // ball game is very likely still going while the basketball finished an hour ago.
    expect(SPORTS.basketball.liveMinutes).toBe(150);
    expect(SPORTS.hockey.liveMinutes).toBe(160);
    expect(SPORTS.baseball.liveMinutes).toBe(200);
    expect(gameView(at(-170), "basketball", NOW)).toBe("finished");
    expect(gameView(at(-170), "hockey", NOW)).toBe("finished");
    expect(gameView(at(-170), "baseball", NOW)).toBe("live");
  });

  it("puts a game inside its own window in live", () => {
    for (const s of ["basketball", "baseball", "hockey"] as const) {
      expect(gameView(at(0), s, NOW)).toBe("live");
      expect(gameView(at(-SPORTS[s].liveMinutes), s, NOW)).toBe("live");
      expect(gameView(at(-(SPORTS[s].liveMinutes + 1)), s, NOW)).toBe("finished");
    }
  });

  it("files a long-past game as finished even while still marked SCHEDULED", () => {
    // The point of deriving from time: a full sync runs every three hours, so a 19:00 tip-off
    // usually still reads SCHEDULED until 22:00, by which point it is over.
    expect(gameView(at(-60 * 5), "basketball", NOW)).toBe("finished");
  });

  it("gives a reported-live game extra room for overtime", () => {
    const base = SPORTS.hockey.liveMinutes;
    expect(gameView(at(-(base + 30), "LIVE"), "hockey", NOW)).toBe("live");
    expect(gameView(at(-(base + LIVE_STATUS_GRACE), "LIVE"), "hockey", NOW)).toBe("live");
    // Beyond that the LIVE flag is stale, not a five-hour hockey game.
    expect(gameView(at(-(base + LIVE_STATUS_GRACE + 1), "LIVE"), "hockey", NOW)).toBe("finished");
    // A merely SCHEDULED game gets no grace.
    expect(gameView(at(-(base + 30)), "hockey", NOW)).toBe("finished");
  });

  it("trusts an explicit FINISHED over the clock", () => {
    expect(gameView(at(-10, "FINISHED"), "baseball", NOW)).toBe("finished");
  });

  it("keeps postponed and cancelled out of all three tabs", () => {
    expect(gameView(at(120, "POSTPONED"), "baseball", NOW)).toBe("off");
    expect(gameView(at(-500, "CANCELLED"), "hockey", NOW)).toBe("off");
  });

  it("counts a night into the three tabs plus the ones that are off", () => {
    const night = [at(60), at(180), at(-30), at(-60 * 4, "FINISHED"), at(-60 * 6), at(45, "POSTPONED")];
    expect(countViews(night, "basketball", NOW)).toEqual({ upcoming: 2, live: 1, finished: 2, off: 1 });
  });

  it("validates the query parameter", () => {
    for (const ok of ["upcoming", "live", "finished"]) expect(isGameView(ok)).toBe(true);
    for (const bad of ["", undefined, "all", "LIVE", "played"]) expect(isGameView(bad as string)).toBe(false);
  });
});
