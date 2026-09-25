import { describe, expect, it } from "vitest";
import { buildSlips, SAFE_MAX_LEG_ODDS } from "@/lib/builder";

const cand = (i: number, p: number, odds?: number) => ({
  matchId: `g${i}`, league: `L${i % 8}`, startMs: i, match: `A${i} at H${i}`, label: `pick ${i}`,
  market: "moneyline", group: ["win", "total", "spread", "team", "special"][i % 5],
  p, odds: odds ?? 1 / p, real: true, band: "MEDIUM",
});

describe("builder: safest leg cap", () => {
  // Prices spread from about 1.25 to about 3.30, so the cap has something to exclude.
  const pool = Array.from({ length: 80 }, (_, i) => cand(i, 0.3 + (i % 10) * 0.05));

  it("never uses a leg priced above the cap", () => {
    const slips = buildSlips(pool, { target: 5, maxLegOdds: SAFE_MAX_LEG_ODDS, minP: 0.3 }, 3);
    expect(slips.length).toBeGreaterThan(0);
    for (const s of slips) for (const l of s.legs) expect(l.odds).toBeLessThanOrEqual(SAFE_MAX_LEG_ODDS);
  });

  it("reaches the same target with more legs than an uncapped search", () => {
    const [uncapped] = buildSlips(pool, { target: 8, minP: 0.3 });
    const [capped] = buildSlips(pool, { target: 8, maxLegOdds: SAFE_MAX_LEG_ODDS, minP: 0.3 });
    expect(capped.legs.length).toBeGreaterThan(uncapped.legs.length);
    expect(capped.odds).toBeGreaterThanOrEqual(8);
  });

  it("returns nothing rather than breaking the cap when the target is out of reach", () => {
    // Every leg is 1.25, so four legs is the most this can give: 1.25^4 is about 2.44.
    const shortOnly = Array.from({ length: 30 }, (_, i) => cand(i, 0.8, 1.25));
    expect(buildSlips(shortOnly, { target: 50, maxLegs: 4, maxLegOdds: SAFE_MAX_LEG_ODDS })).toEqual([]);
  });

  it("leaves an uncapped search alone", () => {
    const [best] = buildSlips(pool, { target: 5, minP: 0.3 });
    expect(best.odds).toBeGreaterThanOrEqual(5);
    expect(Math.max(...best.legs.map((l) => l.odds))).toBeGreaterThan(SAFE_MAX_LEG_ODDS);
  });
});
