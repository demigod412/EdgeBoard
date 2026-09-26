import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { resolveSelection, SPORTYBET_MARKETS, matchEvent, type SbEvent } from "@/lib/booking/sportybet";
import type { Mkt } from "@/lib/markets";

/*
 * Market shapes copied from a live pcUpcomingEvents response, so these assert the real contract rather
 * than a guess. The ids are the point: basketball's plain "1X2" is regular-time and three-way, so a
 * moneyline including overtime has to come from 219 "Winner (incl. overtime)".
 */
const basketball: SbEvent = {
  eventId: "sr:match:72016782", homeTeamName: "Adelaide 36ers", awayTeamName: "Cairns Taipans",
  estimateStartTime: Date.parse("2026-09-28T09:00:00Z"),
  markets: [
    { id: "1", desc: "1X2", outcomes: [{ id: "1", desc: "Home" }, { id: "2", desc: "Draw" }, { id: "3", desc: "Away" }] },
    { id: "219", desc: "Winner (incl. overtime)", outcomes: [{ id: "4", desc: "Home" }, { id: "5", desc: "Away" }] },
    { id: "225", desc: "Over/Under (incl. overtime) 185.5", specifier: "total=185.5", outcomes: [{ id: "12", desc: "Over 185.5" }, { id: "13", desc: "Under 185.5" }] },
    { id: "223", desc: "Handicap (incl. overtime) -6.5", specifier: "hcp=-6.5", outcomes: [{ id: "1714", desc: "Home (-6.5)" }, { id: "1715", desc: "Away (+6.5)" }] },
    { id: "227", desc: "Adelaide 36ers Over/Under (incl. overtime) 95.5", specifier: "total=95.5", outcomes: [{ id: "12", desc: "Over 95.5" }, { id: "13", desc: "Under 95.5" }] },
    { id: "227", desc: "Cairns Taipans Over/Under (incl. overtime) 88.5", specifier: "total=88.5", outcomes: [{ id: "12", desc: "Over 88.5" }, { id: "13", desc: "Under 88.5" }] },
    { id: "68", desc: "1st Half - Over/Under", specifier: "total=93.5", outcomes: [{ id: "12", desc: "Over 93.5" }, { id: "13", desc: "Under 93.5" }] },
  ],
};
const hockey: SbEvent = {
  eventId: "sr:match:1", homeTeamName: "Boston Bruins", awayTeamName: "Buffalo Sabres",
  estimateStartTime: Date.parse("2026-10-10T23:00:00Z"),
  markets: [
    { id: "406", desc: "Winner (incl. overtime and penalties)", outcomes: [{ id: "4", desc: "Home" }, { id: "5", desc: "Away" }] },
    { id: "412", desc: "Total (incl. overtime and penalties) 5", specifier: "total=5", outcomes: [{ id: "12", desc: "Over 5" }, { id: "13", desc: "Under 5" }] },
    { id: "410", desc: "Handicap (incl. overtime and penalties) 1.5", specifier: "hcp=1.5", outcomes: [{ id: "1714", desc: "Home (+1.5)" }, { id: "1715", desc: "Away (-1.5)" }] },
    { id: "446", desc: "1st period - total", specifier: "total=1.5|periodnr=1", outcomes: [{ id: "12", desc: "Over 1.5" }, { id: "13", desc: "Under 1.5" }] },
    { id: "1", desc: "1X2", outcomes: [{ id: "1", desc: "Home" }, { id: "2", desc: "Draw" }, { id: "3", desc: "Away" }] },
    { id: "29", desc: "GG/NG", outcomes: [{ id: "74", desc: "Yes" }, { id: "76", desc: "No" }] },
  ],
};
const baseball: SbEvent = {
  eventId: "sr:match:2", homeTeamName: "New York Mets", awayTeamName: "Washington Nationals",
  estimateStartTime: Date.parse("2026-09-27T17:00:00Z"),
  markets: [
    { id: "251", desc: "Winner (incl. extra innings)", outcomes: [{ id: "4", desc: "Home" }, { id: "5", desc: "Away" }] },
    { id: "258", desc: "Total (incl. extra innings) 6.5", specifier: "total=6.5", outcomes: [{ id: "12", desc: "Over 6.5" }, { id: "13", desc: "Under 6.5" }] },
    { id: "256", desc: "Handicap (incl. extra innings) -1.5", specifier: "hcp=-1.5", outcomes: [{ id: "1714", desc: "Home (-1.5)" }, { id: "1715", desc: "Away (+1.5)" }] },
    { id: "260", desc: "New York Mets total (incl. extra innings)", specifier: "total=3.5", outcomes: [{ id: "12", desc: "Over 3.5" }, { id: "13", desc: "Under 3.5" }] },
    { id: "261", desc: "Washington Nationals total (incl. extra innings)", specifier: "total=2.5", outcomes: [{ id: "12", desc: "Over 2.5" }, { id: "13", desc: "Under 2.5" }] },
  ],
};

const mkt = (o: Partial<Mkt>): Mkt => ({ key: "k", group: "win", kind: "win", side: "home", label: "l", short: "s", p: 0.6, ...o });
const ok = (r: unknown) => { expect(r, JSON.stringify(r)).not.toHaveProperty("error"); return r as { marketId: string; outcomeId: string; specifier: string | null }; };

describe("Sportybet market mapping", () => {
  it("asks for a marketId list for every sport", () => {
    // Without marketId the endpoint answers bizCode 19000 "Invalid" and nothing can ever be booked.
    for (const s of ["basketball", "baseball", "hockey"] as const) {
      expect(SPORTYBET_MARKETS[s].markets, `${s} has no marketId list`).toMatch(/^\d+(,\d+)*$/);
      expect(SPORTYBET_MARKETS[s].markets).toContain(SPORTYBET_MARKETS[s].win);
      expect(SPORTYBET_MARKETS[s].markets).toContain(SPORTYBET_MARKETS[s].total);
      expect(SPORTYBET_MARKETS[s].markets).toContain(SPORTYBET_MARKETS[s].spread);
    }
  });

  it("books a basketball moneyline from 219, not the regular-time 1X2", () => {
    const home = ok(resolveSelection(basketball, mkt({ kind: "win", side: "home" }), "basketball"));
    expect(home.marketId).toBe("219");
    expect(home.outcomeId).toBe("4");
    const away = ok(resolveSelection(basketball, mkt({ kind: "win", side: "away" }), "basketball"));
    expect(away.outcomeId).toBe("5");
  });

  it("books totals, handicaps and the first half at the right line", () => {
    const over = ok(resolveSelection(basketball, mkt({ kind: "total", side: "over", line: 185.5 }), "basketball"));
    expect([over.marketId, over.specifier, over.outcomeId]).toEqual(["225", "total=185.5", "12"]);
    const hcp = ok(resolveSelection(basketball, mkt({ kind: "spread", side: "home", line: -6.5 }), "basketball"));
    expect([hcp.marketId, hcp.specifier, hcp.outcomeId]).toEqual(["223", "hcp=-6.5", "1714"]);
    // Away side of the same line: Sportybet states the handicap from the home team's view.
    const away = ok(resolveSelection(basketball, mkt({ kind: "spread", side: "away", line: 6.5 }), "basketball"));
    expect([away.specifier, away.outcomeId]).toEqual(["hcp=-6.5", "1715"]);
    const seg = ok(resolveSelection(basketball, mkt({ kind: "seg", side: "under", line: 93.5 }), "basketball"));
    expect([seg.marketId, seg.outcomeId]).toEqual(["68", "13"]);
  });

  it("picks the right team's total when one market id serves both", () => {
    const h = ok(resolveSelection(basketball, mkt({ kind: "team_total", side: "home:over", line: 95.5 }), "basketball", { home: "Adelaide 36ers", away: "Cairns Taipans" }));
    expect(h.specifier).toBe("total=95.5");
    const a = ok(resolveSelection(basketball, mkt({ kind: "team_total", side: "away:under", line: 88.5 }), "basketball", { home: "Adelaide 36ers", away: "Cairns Taipans" }));
    expect([a.specifier, a.outcomeId]).toEqual(["total=88.5", "13"]);
  });

  it("uses the sport's own ids for hockey and baseball", () => {
    expect(ok(resolveSelection(hockey, mkt({ kind: "win", side: "away" }), "hockey")).marketId).toBe("406");
    expect(ok(resolveSelection(hockey, mkt({ kind: "total", side: "over", line: 5 }), "hockey")).specifier).toBe("total=5");
    expect(ok(resolveSelection(hockey, mkt({ kind: "seg", side: "over", line: 1.5 }), "hockey")).specifier).toBe("total=1.5|periodnr=1");
    expect(ok(resolveSelection(hockey, mkt({ kind: "reg3", side: "draw" }), "hockey")).outcomeId).toBe("2");
    expect(ok(resolveSelection(hockey, mkt({ kind: "btts", side: "no" }), "hockey")).outcomeId).toBe("76");
    expect(ok(resolveSelection(baseball, mkt({ kind: "win", side: "home" }), "baseball")).marketId).toBe("251");
    expect(ok(resolveSelection(baseball, mkt({ kind: "total", side: "under", line: 6.5 }), "baseball")).marketId).toBe("258");
    // Separate ids per team here, rather than one market naming the team.
    expect(ok(resolveSelection(baseball, mkt({ kind: "team_total", side: "away:over", line: 2.5 }), "baseball")).marketId).toBe("261");
  });

  it("writes integer lines without a trailing zero, the way Sportybet does", () => {
    expect(ok(resolveSelection(hockey, mkt({ kind: "total", side: "over", line: 5 }), "hockey")).specifier).toBe("total=5");
  });

  it("says why a leg cannot be booked instead of failing quietly", () => {
    expect(resolveSelection(basketball, mkt({ kind: "total", side: "over", line: 999.5 }), "basketball")).toEqual({ error: "market not offered on this game" });
    expect(resolveSelection(basketball, mkt({ kind: "btts", side: "yes" }), "basketball")).toEqual({ error: "basketball both-teams-to-score is not offered on Sportybet" });
    expect(resolveSelection(basketball, mkt({ kind: "nrfi", side: "no_run" }), "basketball")).toEqual({ error: "nrfi is not mapped to a Sportybet market" });
    expect(resolveSelection(basketball, mkt({ kind: "total", side: "over", line: null }), "basketball")).toEqual({ error: "no line on this market" });
  });

  it("skips an inactive outcome rather than booking it", () => {
    const dead: SbEvent = { ...basketball, markets: [{ id: "219", desc: "Winner (incl. overtime)", outcomes: [{ id: "4", desc: "Home", isActive: 0 }, { id: "5", desc: "Away" }] }] };
    expect(resolveSelection(dead, mkt({ kind: "win", side: "home" }), "basketball")).toEqual({ error: "selection not available" });
  });

  it("matches an event by team names within a three-hour window", () => {
    const start = new Date(basketball.estimateStartTime);
    expect(matchEvent([basketball], "Adelaide 36ers", "Cairns Taipans", start)?.eventId).toBe(basketball.eventId);
    // Short names and noise still match.
    expect(matchEvent([basketball], "Adelaide", "Cairns", start)).toBeTruthy();
    // A different game at the same time does not.
    expect(matchEvent([basketball], "Sydney Kings", "Illawarra Hawks", start)).toBeNull();
    // Nor the right teams a day out.
    expect(matchEvent([basketball], "Adelaide 36ers", "Cairns Taipans", new Date(start.getTime() + 864e5))).toBeNull();
  });
});
