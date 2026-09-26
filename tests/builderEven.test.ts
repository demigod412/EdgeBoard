import { describe, expect, it } from "vitest";
import { buildSlips, legEvenness } from "@/lib/builder";

const GROUPS = ["win", "total", "spread", "team", "special", "seg"];

describe("builder: safest picks the likeliest legs", () => {
  // Every game offers a likely and an unlikely leg at IDENTICAL odds, in the same market group.
  // One leg per game is allowed, so the only question is which of the two the search takes.
  const pool = Array.from({ length: 12 }, (_, i) => [0.82, 0.66].map((p) => ({
    matchId: `g${i}`, league: `L${i}`, startMs: i, match: `A${i} at H${i}`,
    label: p > 0.7 ? "likely" : "unlikely", market: `mk${p}`, group: GROUPS[i % GROUPS.length],
    p, odds: 1.3, real: true, band: "MEDIUM",
  }))).flat();

  it("takes the high-probability leg every time, not the cheap-looking one", () => {
    // Before the ranking fix this returned five unlikely legs: 12.5% where 37.1% was on offer.
    const [s] = buildSlips(pool, { target: 3, maxLegs: 6, mode: "safe", minP: 0.5 });
    expect(s).toBeTruthy();
    expect(s.legs.every((l) => l.label === "likely"), "an unlikely leg was chosen over an equally priced likely one").toBe(true);
    expect(s.p).toBeCloseTo(Math.pow(0.82, s.legs.length), 6);
  });
});

describe("builder: even legs", () => {
  // 40 games x 6 market groups, fair odds from about 1.09 to 1.82.
  const pool = Array.from({ length: 40 }, (_, m) => GROUPS.map((g, j) => {
    const p = 0.55 + ((m * 3 + j * 5) % 38) / 100;
    return { matchId: `g${m}`, league: `L${m % 20}`, startMs: m, match: `A${m} at H${m}`,
      label: `${g} pick`, market: `${g}${j}`, group: g, p, odds: 1 / p, real: false, band: "MEDIUM" };
  })).flat();

  it("a 19.00 target over 12 legs comes out near 1.28 each", () => {
    const [s] = buildSlips(pool, { target: 19, minLegs: 12, maxLegs: 12, minP: 0.5, evenLegs: true });
    expect(s).toBeTruthy();
    expect(s.legs.length).toBe(12);
    const ideal = Math.pow(19, 1 / 12); // 1.278
    for (const l of s.legs) {
      expect(l.odds, `leg at ${l.odds.toFixed(2)} is nowhere near ${ideal.toFixed(2)}`).toBeGreaterThan(ideal * 0.85);
      expect(l.odds).toBeLessThan(ideal * 1.25);
    }
    expect(s.odds).toBeGreaterThanOrEqual(19);
  });

  it("is measurably more even than the same search without it", () => {
    const opts = { target: 19, minLegs: 12, maxLegs: 12, minP: 0.5 };
    const [even] = buildSlips(pool, { ...opts, evenLegs: true });
    const [mixed] = buildSlips(pool, { ...opts, evenLegs: false });
    expect(even.spread).toBeLessThan(mixed.spread);
  });

  it("honours a minimum leg count by using shorter legs", () => {
    const [few] = buildSlips(pool, { target: 5, maxLegs: 12, minP: 0.5 });
    const [many] = buildSlips(pool, { target: 5, minLegs: 8, maxLegs: 12, minP: 0.5, evenLegs: true });
    expect(many.legs.length).toBeGreaterThanOrEqual(8);
    expect(many.legs.length).toBeGreaterThan(few.legs.length);
    expect(Math.max(...many.legs.map((l) => l.odds))).toBeLessThan(Math.max(...few.legs.map((l) => l.odds)));
  });

  it("still reaches a range of targets", () => {
    for (const target of [3, 5, 10, 19, 30]) {
      const [s] = buildSlips(pool, { target, minLegs: 6, maxLegs: 15, minP: 0.5, evenLegs: true });
      expect(s, `no slip for target ${target}`).toBeTruthy();
      expect(s.odds).toBeGreaterThanOrEqual(target);
    }
  });

  it("measures evenness on each leg's share of the price, not on the odds", () => {
    const equal = Array.from({ length: 12 }, () => Math.pow(19, 1 / 12));
    expect(legEvenness(equal, 19)).toBeCloseTo(1, 5);
    // A 1.03 leg carries almost none of the price: badly uneven, though 1.03 and 1.28 look close
    // as plain numbers. A naive +/-25% band on the odds would have allowed it.
    expect(legEvenness([1.6, 1.03, 1.28, 1.28, 1.28, 1.3], 19)).toBeGreaterThan(5);
  });
});
