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
      { id: 13, name: "NBA W", type: "League", country: { name: "USA" }, seasons: [{ season: 2025 }, { season: 2026, current: true }] },
      { id: 99, name: "NBA - G League", type: "League", country: { name: "USA" }, seasons: [{ season: "2026-2027", current: true }] },
      { id: 120, name: "Euroleague", type: "League", country: { name: "Europe" }, seasons: [{ season: "2025-2026" }, { season: "2026-2027", current: true }] },
      { id: 5, name: "Copa", type: "Cup", country: { name: "Spain" }, seasons: [] },
    ];
    globalThis.fetch = (async () => new Response(JSON.stringify({ response: leagues, errors: [] }), { status: 200 })) as typeof fetch;
    const d = await apiSports("basketball", { key: "x" }).discoverLeagues!();
    expect(d.map((l) => l.name)).toEqual(["NBA", "NBA W", "Euroleague"]);
    expect(d[0]).toMatchObject({ id: "12", season: "2026-2027", prevSeason: "2025-2026", focus: true, country: "USA" });
    expect(d[1]).toMatchObject({ season: "2026", prevSeason: "2025", country: "USA" });
    expect(d[2]).toMatchObject({ name: "Euroleague", country: "Europe" });
  });
});

describe("access code", () => {
  it("token verifies, rejects a different secret and expires", async () => {
    const { issueToken, readToken } = await import("@/lib/access");
    const t = await issueToken("abc", 30);
    expect((await readToken(t, "abc")).valid).toBe(true);
    expect((await readToken(t, "xyz")).valid).toBe(false);
    expect((await readToken(await issueToken("abc", -1), "abc")).valid).toBe(false);
    expect((await readToken(undefined, "abc")).valid).toBe(false);
  });
  it("hashes the code and derives a secret that changes when the code changes", async () => {
    const { makeHash, hashOf, secretFor } = await import("@/lib/accessSecret");
    const a = makeHash("1234"), b = makeHash("1234");
    expect(a.hash).not.toBe(b.hash);                       // salted
    expect(hashOf("1234", a.salt)).toBe(a.hash);
    expect(hashOf("wrong", a.salt)).not.toBe(a.hash);
    expect(secretFor(a)).not.toBe(secretFor(makeHash("5678")));
  });
  it("leaves Settings and assets reachable while locked", async () => {
    const { isOpenPath } = await import("@/lib/access");
    for (const p of ["/settings", "/api/cron/ingest", "/_next/static/x.js", "/manifest.webmanifest"]) expect(isOpenPath(p)).toBe(true);
    for (const p of ["/", "/basketball", "/basketball/top", "/slips"]) expect(isOpenPath(p)).toBe(false);
  });
});

describe("season picking", () => {
  it("takes the latest season when the list is unordered and nothing is flagged current", async () => {
    const { apiSports } = await import("@/lib/providers/apiSports");
    const leagues = [{ id: 12, name: "NBA", type: "League", country: { name: "USA" },
      seasons: [{ season: "2025-2026" }, { season: "2026-2027" }, { season: "2023-2024" }, { season: "2024-2025" }] }];
    globalThis.fetch = (async () => new Response(JSON.stringify({ response: leagues, errors: [] }), { status: 200 })) as typeof fetch;
    const [nba] = await apiSports("basketball", { key: "x" }).discoverLeagues!();
    expect(nba.season).toBe("2026-2027");
    expect(nba.prevSeason).toBe("2025-2026");
  });
  it("honours the current flag wherever it sits in the list", async () => {
    const { apiSports } = await import("@/lib/providers/apiSports");
    const leagues = [{ id: 9, name: "WNBA", type: "League", country: { name: "USA" },
      seasons: [{ season: 2027 }, { season: 2026, current: true }, { season: 2025 }] }];
    globalThis.fetch = (async () => new Response(JSON.stringify({ response: leagues, errors: [] }), { status: 200 })) as typeof fetch;
    const [w] = await apiSports("basketball", { key: "x" }).discoverLeagues!();
    expect(w.season).toBe("2026"); expect(w.prevSeason).toBe("2025");
  });
});

describe("retired markets", () => {
  it("never surfaces 'no overtime' or baseball both-teams-score, even on old stored calls", async () => {
    const { marketsOf } = await import("@/lib/picks");
    const old = { sport: "BASEBALL", picks: { markets: [
      { key: "ot:no:", kind: "ot", side: "no", group: "props", label: "Extra innings: no", short: "Extras no", p: 0.91 },
      { key: "btts:yes:", kind: "btts", side: "yes", group: "props", label: "Both teams score a run", short: "BTTS yes", p: 0.86 },
      { key: "win:home:", kind: "win", side: "home", group: "win", label: "Home", short: "Home", p: 0.58 },
    ] } } as never;
    const out = marketsOf(old);
    expect(out.map((m) => m.kind)).toEqual(["win"]);
    const hockey = { sport: "HOCKEY", picks: { markets: [
      { key: "btts:yes:", kind: "btts", side: "yes", group: "props", label: "Both teams to score", short: "BTTS yes", p: 0.78 },
      { key: "ot:yes:", kind: "ot", side: "yes", group: "props", label: "Overtime: yes", short: "OT yes", p: 0.23 },
    ] } } as never;
    expect(marketsOf(hockey).map((m) => m.kind).sort()).toEqual(["btts", "ot"]); // hockey keeps both
  });
});

import { leagueLabel } from "@/lib/sports";
describe("league labels", () => {
  it("puts the country first, because league names repeat across countries", () => {
    expect(leagueLabel({ name: "LKL", country: "Lithuania" })).toBe("Lithuania · LKL");
    expect(leagueLabel({ name: "NBA", country: "USA" })).toBe("USA · NBA");
    // API-Sports hyphenates multi-word countries; read them as words.
    expect(leagueLabel({ name: "NBL", country: "Czech-Republic" })).toBe("Czech Republic · NBL");
    expect(leagueLabel({ name: "Premijer Liga", country: "Bosnia-and-Herzegovina" })).toBe("Bosnia and Herzegovina · Premijer Liga");
  });
  it("falls back to the bare name when no country is stored", () => {
    // Rows synced before the country was recorded, and the demo generator.
    expect(leagueLabel({ name: "NBA", country: "" })).toBe("NBA");
    expect(leagueLabel({ name: "NBA" })).toBe("NBA");
    expect(leagueLabel({ name: "NBA", country: null })).toBe("NBA");
  });
});

describe("women's basketball league naming", () => {
  // API-Sports does not use the name "WNBA": it suffixes women's competitions ("NCAA Women")
  // and women's teams ("Atlanta Dream W"). Asserted against the real WANTED table rather than a
  // copy of the pattern, so this test cannot drift from what actually ships.
  const usaRows = async () => {
    const { WANTED } = await import("@/lib/providers/apiSports");
    return WANTED.basketball.filter(([c]) => c === "USA");
  };
  it("covers the spellings API-Sports actually uses for the women's league", async () => {
    const usa = await usaRows();
    const hits = (n: string) => usa.filter(([, re]) => re.test(n)).length;
    for (const n of ["NBA W", "NBA Women", "NBA-W", "WNBA", "NBA W Regular Season"]) {
      expect(hits(n), `no USA entry matches "${n}"`).toBeGreaterThan(0);
    }
  });
  it("does not let the women's entry swallow the men's leagues", async () => {
    const usa = await usaRows();
    const hits = (n: string) => usa.filter(([, re]) => re.test(n)).length;
    expect(hits("NBA")).toBe(1);          // the plain NBA entry, and only that one
    expect(hits("NBA G League")).toBe(1); // its own entry
    for (const n of ["NBB", "NBL"]) expect(hits(n)).toBe(0);
  });
});
