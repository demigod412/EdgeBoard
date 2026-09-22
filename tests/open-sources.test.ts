import { describe, expect, it } from "vitest";
import { parseMlb, dedupeMlb, type MlbGame } from "@/lib/providers/open/mlb";
import { parseNhl, nhlFirstPeriod, type NhlGame } from "@/lib/providers/open/nhl";
import { parseBdl, type BdlGame } from "@/lib/providers/open/nba";

describe("MLB Stats API parsing", () => {
  const inn = (h: number[], a: number[]) => h.map((x, i) => ({ num: i + 1, home: { runs: x }, away: { runs: a[i] } }));
  const g = (o: Partial<MlbGame>): MlbGame => ({ gamePk: 1, gameDate: "2026-09-21T23:05:00Z", status: { abstractGameState: "Final", detailedState: "Final" },
    teams: { home: { team: { id: 1, name: "Home" }, score: 5, probablePitcher: { id: 9 } }, away: { team: { id: 2, name: "Away" }, score: 4, probablePitcher: { id: 8 } } },
    linescore: { innings: inn([1, 0, 0, 2, 0, 0, 0, 1, 0, 1], [0, 0, 1, 0, 0, 1, 2, 0, 0, 0]) }, ...o });
  it("final with extras: F5, 1st inning, regulation, extras flag", () => {
    const p = parseMlb(g({}));
    expect(p.status).toBe("FINISHED"); expect(p.homeSeg).toBe(3); expect(p.awaySeg).toBe(1);
    expect(p.homeFirst).toBe(1); expect(p.awayFirst).toBe(0); expect(p.homeReg).toBe(4); expect(p.awayReg).toBe(4); expect(p.extraTime).toBe(true);
    expect(p.newsReady).toBe(true);
  });
  it("scheduled / postponed; duplicate postponed copy dropped", () => {
    const s = parseMlb(g({ gamePk: 2, status: { abstractGameState: "Preview", detailedState: "Scheduled" }, linescore: {} }));
    expect(s.status).toBe("SCHEDULED"); expect(s.homeScore).toBeNull();
    const pp = parseMlb(g({ gamePk: 3, status: { abstractGameState: "Final", detailedState: "Postponed" } }));
    expect(pp.status).toBe("POSTPONED");
    const again = parseMlb(g({ gamePk: 3, gameDate: "2026-09-22T17:05:00Z", status: { abstractGameState: "Preview", detailedState: "Scheduled" } }));
    expect(dedupeMlb([pp, again])).toEqual([again]);
  });
});

describe("NHL API parsing", () => {
  const base: NhlGame = { id: 2025020001, gameType: 2, gameState: "OFF", startTimeUTC: "2026-10-08T23:00:00Z",
    homeTeam: { id: 10, placeName: { default: "Toronto" }, commonName: { default: "Maple Leafs" }, score: 3 }, awayTeam: { id: 8, placeName: { default: "Montréal" }, commonName: { default: "Canadiens" }, score: 2 },
    gameOutcome: { lastPeriodType: "OT" }, goals: [{ period: 1, homeScore: 1, awayScore: 0 }, { period: 1, homeScore: 1, awayScore: 1 }, { period: 2, homeScore: 2, awayScore: 1 }, { period: 3, homeScore: 2, awayScore: 2 }, { period: 4, homeScore: 3, awayScore: 2 }] };
  it("OT final: regulation level, 1st period from running scores", () => {
    const p = parseNhl(base)!;
    expect(p.status).toBe("FINISHED"); expect(p.extraTime).toBe(true);
    expect([p.homeReg, p.awayReg]).toEqual([2, 2]); expect([p.homeSeg, p.awaySeg]).toEqual([1, 1]); expect(p.home.name).toBe("Toronto Maple Leafs");
  });
  it("goalless 1st period, regulation win, preseason skipped", () => {
    expect(nhlFirstPeriod({ ...base, goals: [{ periodDescriptor: { number: 2 }, homeScore: 1, awayScore: 0 }] })).toEqual([0, 0]);
    const r = parseNhl({ ...base, gameOutcome: { lastPeriodType: "REG" } })!; expect([r.homeReg, r.awayReg]).toEqual([3, 2]); expect(r.extraTime).toBe(false);
    expect(parseNhl({ ...base, gameType: 1 })).toBeNull();
    expect(parseNhl({ ...base, gameState: "FUT", goals: undefined })!.status).toBe("SCHEDULED");
  });
});

describe("balldontlie parsing", () => {
  const g: BdlGame = { id: 1, date: "2026-10-22", datetime: "2026-10-22T23:30:00.000Z", status: "Final", period: 5,
    home_team: { id: 1, full_name: "Boston Celtics" }, visitor_team: { id: 2, full_name: "New York Knicks" }, home_team_score: 118, visitor_team_score: 112,
    home_q1: 28, home_q2: 27, home_q3: 25, home_q4: 25, home_ot1: 13, visitor_q1: 30, visitor_q2: 22, visitor_q3: 26, visitor_q4: 25, visitor_ot1: 9 };
  it("final in OT: halves, regulation, OT flag", () => {
    const p = parseBdl(g);
    expect(p.status).toBe("FINISHED"); expect(p.homeSeg).toBe(55); expect(p.awaySeg).toBe(52);
    expect(p.homeReg).toBe(105); expect(p.awayReg).toBe(103); expect(p.extraTime).toBe(true); expect(p.startUtc.toISOString()).toBe("2026-10-22T23:30:00.000Z");
  });
  it("scheduled game with time in status", () => {
    const p = parseBdl({ ...g, status: "2026-10-23T00:00:00Z", datetime: null, period: 0, home_team_score: 0, visitor_team_score: 0 });
    expect(p.status).toBe("SCHEDULED"); expect(p.homeScore).toBeNull(); expect(p.startUtc.toISOString()).toBe("2026-10-23T00:00:00.000Z");
  });
});

import { vi } from "vitest";
vi.mock("server-only", () => ({}));
describe("API-Sports league discovery", () => {
  it("picks wanted top leagues with their current and previous season", async () => {
    const { apiSports } = await import("@/lib/providers/apiSports");
    const leagues = [
      { id: 12, name: "NBA", type: "League", country: { name: "USA" }, seasons: [{ season: "2024-2025" }, { season: "2025-2026" }, { season: "2026-2027", current: true }] },
      { id: 13, name: "WNBA", type: "League", country: { name: "USA" }, seasons: [{ season: 2025 }, { season: 2026, current: true }] },
      { id: 99, name: "NBA - G League", type: "League", country: { name: "USA" }, seasons: [{ season: "2026-2027", current: true }] },
      { id: 120, name: "Euroleague", type: "League", country: { name: "Europe" }, seasons: [{ season: "2025-2026" }, { season: "2026-2027", current: true }] },
      { id: 5, name: "Copa", type: "Cup", country: { name: "Spain" }, seasons: [] },
    ];
    globalThis.fetch = (async () => new Response(JSON.stringify({ response: leagues, errors: [] }), { status: 200 })) as typeof fetch;
    const d = await apiSports("basketball", { key: "x" }).discoverLeagues!();
    expect(d.map((l) => l.name)).toEqual(["NBA", "WNBA", "Euroleague"]);
    expect(d[0]).toMatchObject({ id: "12", season: "2026-2027", prevSeason: "2025-2026", focus: true });
    expect(d[1]).toMatchObject({ season: "2026", prevSeason: "2025" });
  });
});
