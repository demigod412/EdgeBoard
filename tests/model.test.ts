import { describe, expect, it } from "vitest";
import { fitNormal, predictNormal } from "@/lib/model/normalModel";
import { fitCount, predictCount, pmf } from "@/lib/model/countModel";
import { predictGame } from "@/lib/model/predict";
import { simulateSeason } from "@/lib/demo/simulate";
import type { HistGame } from "@/lib/model/common";
import type { SportId } from "@/lib/sports";

const hist = (sport: SportId, days = 200): HistGame[] => simulateSeason(sport, 16, Date.UTC(2025, 0, 1), days, 5).games.map((g) => ({
  homeId: `t${g.home}`, awayId: `t${g.away}`, date: g.date, homeScore: g.homeScore, awayScore: g.awayScore,
  homeReg: g.homeReg, awayReg: g.awayReg, homeSeg: g.homeSeg, awaySeg: g.awaySeg, extraTime: g.extraTime }));

describe("basketball normal model", () => {
  const h = hist("basketball"), fit = fitNormal(h, new Date(Date.UTC(2025, 8, 1)));
  it("fits sensible league parameters", () => {
    expect(fit.mu).toBeGreaterThan(105); expect(fit.mu).toBeLessThan(119);
    expect(fit.home).toBeGreaterThan(0); expect(fit.sigmaM).toBeGreaterThan(10); expect(fit.sigmaM).toBeLessThan(20);
    expect(fit.segShare).toBeGreaterThan(0.48); expect(fit.segShare).toBeLessThan(0.53);
  });
  it("cover and totals are monotone in the line", () => {
    const o = predictNormal(fit, "t1", "t2", { restHome: 0, restAway: 0 });
    expect(o.totalAt(200.5).a).toBeGreaterThan(o.totalAt(230.5).a);
    expect(o.coverAt(5.5).a).toBeGreaterThan(o.coverAt(-5.5).a);
    expect(o.totalAt(220).push).toBeGreaterThan(0);
    expect(o.totalAt(220.5).push).toBe(0);
  });
});

describe("count models", () => {
  it("NB pmf sums to 1", () => { let s = 0; for (let k = 0; k < 80; k++) s += pmf(k, 4.5, 6); expect(s).toBeCloseTo(1, 6); });
  for (const sport of ["baseball", "hockey"] as const) {
    it(`${sport}: win, run/puck line and totals are coherent`, () => {
      const fit = fitCount(sport, hist(sport), new Date(Date.UTC(2025, 8, 1)));
      const o = predictCount(fit, "t1", "t2", { phiHome: 1, phiAway: 1 });
      expect(o.homeWin).toBeGreaterThan(0.2); expect(o.homeWin).toBeLessThan(0.8);
      // home +1.5 covers whenever home wins, plus every 1-goal/run loss
      expect(o.coverAt(1.5).a).toBeGreaterThan(o.homeWin);
      expect(o.coverAt(-1.5).a).toBeLessThan(o.homeWin);
      expect(o.coverAt(1.5).a + (1 - o.coverAt(1.5).a)).toBeCloseTo(1, 9);
      expect(o.segAt(0.5).a).toBeGreaterThan(o.segAt(2.5).a);
      if (sport === "baseball") expect(fit.dispersion).not.toBeNull();
      if (sport === "hockey") expect(fit.enTransfer).toBeGreaterThan(0.05); // simulator adds empty-net goals
    });
  }
});

describe("predictGame picks", () => {
  it("strong picks respect the floor and Low never shows 90%+", () => {
    for (const sport of ["basketball", "baseball", "hockey"] as const) {
      const h = hist(sport), fit = sport === "basketball" ? fitNormal(h, new Date(Date.UTC(2025, 8, 1))) : fitCount(sport, h, new Date(Date.UTC(2025, 8, 1)));
      const o = predictGame({ sport, fit, homeId: "t3", awayId: "t4", homeName: "H", awayName: "A", start: new Date(), restHomeDays: 2, restAwayDays: 2, newsComplete: false, book: {}, formHome: "", formAway: "", strongFloor: 0.65 });
      for (const k of [o.picks.strongTotal, o.picks.strongSpread, o.picks.strongSeg]) if (k) expect(k.p).toBeGreaterThanOrEqual(0.65);
      expect(o.band).not.toBe("HIGH");
      expect(o.dataFlags).toContain("no_book_lines");
      if (o.band === "LOW") [o.calHomeWin, o.calOver, o.calHomeCover, o.calSegOver].forEach((p) => { expect(p).toBeLessThan(0.9); expect(p).toBeGreaterThan(0.1); });
    }
  });
});

import { bestTip, selectTop, tipsFor } from "@/lib/top";
import { hitOf, type Mkt } from "@/lib/markets";
import { mk } from "@/lib/model/props";
describe("markets, headline and caps", () => {
  const m = (o: Partial<Mkt> & Pick<Mkt, "kind" | "side" | "p">): Mkt => mk({ group: "win", label: "x", short: "x", ...o } as Omit<Mkt, "key">);
  const pred = (markets: Mkt[], band = "MEDIUM") => ({ band, confidence: 60, picks: { markets } }) as never;
  it("headline never picks 'no overtime' or an underdog + handicap", () => {
    const t = bestTip(pred([m({ kind: "ot", side: "no", p: 0.93, group: "props" }), m({ kind: "spread", side: "away", line: 1.5, p: 0.8, group: "spread" }), m({ kind: "win", side: "home", p: 0.7 })]));
    expect(t?.kind).toBe("win");
    expect(bestTip(pred([m({ kind: "win", side: "home", p: 0.9 })], "LOW"))).toBeNull();
  });
  it("Top 20 caps underdog handicaps at 2 and excludes 'no overtime'", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ item: i, id: String(i), startMs: i, tips: tipsFor(pred([
      m({ kind: "ot", side: "no", p: 0.94, group: "props" }), m({ kind: "spread", side: "away", line: 1.5, p: 0.8, group: "spread" }), m({ kind: "win", side: "home", p: 0.6 })])) }));
    const top = selectTop(items);
    expect(top.filter((x) => x.tip.kind === "spread").length).toBe(2);
    expect(top.some((x) => x.tip.kind === "ot")).toBe(false);
    expect(top).toHaveLength(10);
  });
  it("scores every market kind", () => {
    const r = { h: 3, a: 2, hSeg: 1, aSeg: 1, hReg: 2, aReg: 2, extra: true, hFirst: 0, aFirst: 0 };
    expect(hitOf(m({ kind: "win", side: "home", p: 0 }), r)).toBe(true);
    expect(hitOf(m({ kind: "spread", side: "away", line: 1.5, p: 0 }), r)).toBe(true);
    expect(hitOf(m({ kind: "total", side: "under", line: 5, p: 0 }), r)).toBeNull();
    expect(hitOf(m({ kind: "ot", side: "yes", p: 0 }), r)).toBe(true);
    expect(hitOf(m({ kind: "reg3", side: "draw", p: 0 }), r)).toBe(true);
    expect(hitOf(m({ kind: "seg3", side: "draw", p: 0 }), r)).toBe(true);
    expect(hitOf(m({ kind: "btts", side: "yes", p: 0 }), r)).toBe(true);
    expect(hitOf(m({ kind: "nrfi", side: "no_run", p: 0 }), r)).toBe(true);
    expect(hitOf(m({ kind: "team_total", side: "home:over", line: 2.5, p: 0 }), r)).toBe(true);
    expect(hitOf(m({ kind: "margin", side: "home", lo: 1, hi: 5, p: 0 }), r)).toBe(true);
  });
});

describe("specials from the model", () => {
  for (const sport of ["basketball", "baseball", "hockey"] as const) {
    it(`${sport}: specials are coherent`, () => {
      const h = hist(sport), fit = sport === "basketball" ? fitNormal(h, new Date(Date.UTC(2025, 8, 1))) : fitCount(sport, h, new Date(Date.UTC(2025, 8, 1)));
      const o = predictGame({ sport, fit, homeId: "t3", awayId: "t4", homeName: "H", awayName: "A", start: new Date(), restHomeDays: 2, restAwayDays: 2, newsComplete: true, book: {}, formHome: "", formAway: "" });
      const ms = o.picks.markets;
      const sum = (k: string) => ms.filter((m) => m.kind === k).reduce((s, m) => s + m.p, 0);
      expect(sum("seg3")).toBeCloseTo(1, 2);
      expect(sum("ot")).toBeCloseTo(1, 6);
      if (sport === "hockey") expect(sum("reg3")).toBeCloseTo(1, 6);
      if (sport !== "basketball") expect(sum("btts")).toBeCloseTo(1, 6);
      if (sport === "baseball") { const n = ms.find((m) => m.kind === "nrfi" && m.side === "no_run")!; expect(n.p).toBeGreaterThan(0.3); expect(n.p).toBeLessThan(0.8); }
      if (sport === "basketball") expect(ms.filter((m) => m.kind === "margin")).toHaveLength(3);
      expect(ms.filter((m) => m.kind === "win")).toHaveLength(2);
      expect(new Set(ms.map((m) => m.key)).size).toBe(ms.length); // unique keys
      const ot = ms.find((m) => m.kind === "ot" && m.side === "yes")!;
      expect(ot.p).toBeGreaterThan(0.01); expect(ot.p).toBeLessThan(sport === "baseball" ? 0.2 : sport === "hockey" ? 0.35 : 0.12);
    });
  }
});
