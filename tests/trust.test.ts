import { describe, expect, it } from "vitest";
import { marketTrust, trustFor, trustKey, TRUST_CEIL, TRUST_FLOOR, TRUST_MIN_N, TRUST_SHRINK } from "@/lib/trust";

const row = (key: string, n: number, hit: number, avgP: number) => ({ key, n, hit, avgP });

describe("market trust from the settled ledger", () => {
  it("marks down a market that under-delivers and rewards one that keeps its promise", () => {
    // Strong total: claimed 78%, landed 71% -> 0.91 before shrinkage.
    const t = marketTrust([row("Strong total", 400, 0.71, 0.78), row("Handicap (main line)", 400, 0.84, 0.83)]);
    expect(t["Strong total"]).toBeLessThan(1);
    expect(t["Handicap (main line)"]).toBeGreaterThan(1);
    expect(t["Strong total"]).toBeCloseTo(1 + (0.71 / 0.78 - 1) * (400 / 460), 3);
  });

  it("ignores a market with too little history rather than chasing noise", () => {
    expect(marketTrust([row("NRFI", TRUST_MIN_N - 1, 0.4, 0.8)])["NRFI"]).toBeUndefined();
    expect(marketTrust([row("NRFI", TRUST_MIN_N, 0.4, 0.8)])["NRFI"]).toBeDefined();
  });

  it("shrinks harder the smaller the sample", () => {
    const small = marketTrust([row("Win", 30, 0.5, 0.75)])["Win"];
    const large = marketTrust([row("Win", 2000, 0.5, 0.75)])["Win"];
    expect(small).toBeGreaterThan(large);
    expect(Math.abs(1 - small)).toBeLessThan(Math.abs(1 - large));
  });

  it("gives a market with exactly TRUST_SHRINK calls half weight", () => {
    expect(marketTrust([row("Team total (strong line)", TRUST_SHRINK, 0.6, 0.8)])["Team total (strong line)"])
      .toBeCloseTo(1 + (0.75 - 1) * 0.5, 4);
  });

  it("clamps: a market can be marked down hard but never promoted much", () => {
    expect(marketTrust([row("Overtime / extras: no", 5000, 0.2, 0.9)])["Overtime / extras: no"]).toBe(TRUST_FLOOR);
    expect(marketTrust([row("Win", 5000, 0.95, 0.6)])["Win"]).toBe(TRUST_CEIL);
  });

  it("treats a missing or out-of-range entry as neutral", () => {
    expect(trustFor({}, "Win")).toBe(1);
    expect(trustFor({ Win: 0.9 }, "Win")).toBe(0.9);
    expect(trustFor({ Win: 99 }, "Win")).toBe(1);
    expect(trustFor({ Win: -1 }, "Win")).toBe(1);
    expect(trustFor({}, undefined)).toBe(1);
  });

  it("stores a separate record per sport", () => {
    expect(trustKey("basketball")).not.toBe(trustKey("baseball"));
    expect(trustKey("hockey")).toContain("hockey");
  });
});
