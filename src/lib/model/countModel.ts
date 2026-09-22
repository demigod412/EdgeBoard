/*
 * Baseball and ice hockey: team scoring is a count.
 *   E[home] = c · a_H · d_A · γ       E[away] = c · a_A · d_H        (weighted iterative scaling, mean a = mean d = 1)
 * Regulation scores: Poisson (hockey) or negative binomial (baseball, dispersion r fitted by moments).
 * Ties after regulation are resolved into the final score:
 *   hockey  — OT/shootout: winner gets +1 goal (books count the shootout goal), home wins with q_OT
 *   baseball — extra innings: winner by 1, total += 1 + 2Y, Y ~ Poisson(λ_x); home wins with q_X
 * Hockey empty-net effect: fraction e of 1-goal regulation wins become 2-goal wins (fitted, default 0).
 * Segment (first 5 innings / 1st period): each side scores share·E[·]; ties allowed (no resolution).
 */
import { clamp, DAY, halfLines, mean, recencyWeight, type HistGame, type LadderRow } from "./common";

export interface CountTeam { attack: number; defence: number; sampleWeight: number; games: number }
export interface CountFit {
  kind: "count"; sport: "baseball" | "hockey";
  base: number; home: number; dispersion: number | null; // null = Poisson
  segShare: number; tieHomeWin: number; extraRate: number; enTransfer: number; volatility: number;
  teams: Map<string, CountTeam>; n: number;
}

const DEF = {
  baseball: { half: 90, K: 8, share: 0.556, tieHome: 0.52, extra: 0.35 },
  hockey: { half: 75, K: 6, share: 0.31, tieHome: 0.5, extra: 0 },
};

export function fitCount(sport: "baseball" | "hockey", games: HistGame[], asOf: Date): CountFit {
  const D = DEF[sport];
  const gs = games.filter((g) => g.date < asOf);
  // Fit on REGULATION scoring when known (extras/OT are modelled separately).
  const yh = (g: HistGame) => g.homeReg ?? g.homeScore, ya = (g: HistGame) => g.awayReg ?? g.awayScore;
  const w = gs.map((g) => recencyWeight((asOf.getTime() - g.date.getTime()) / DAY, D.half));
  const ids = new Set<string>(); gs.forEach((g) => { ids.add(g.homeId); ids.add(g.awayId); });
  const a = new Map<string, number>(), d = new Map<string, number>(); ids.forEach((i) => { a.set(i, 1); d.set(i, 1); });
  const sw = w.reduce((s, x) => s + x, 0) || 1;
  const hs = gs.reduce((s, g, k) => s + w[k] * yh(g), 0), as = gs.reduce((s, g, k) => s + w[k] * ya(g), 0);
  let c = gs.length ? Math.max(0.3, as / sw) : sport === "baseball" ? 4.3 : 2.9;
  let g0 = as > 0 ? clamp(hs / as, 0.9, 1.3) : 1.04;
  for (let it = 0; it < 40; it++) {
    for (const [target, other] of [[a, d], [d, a]] as const) {
      const num = new Map<string, number>(), den = new Map<string, number>();
      ids.forEach((i) => { num.set(i, D.K * c); den.set(i, D.K * c); });
      gs.forEach((g, k) => {
        if (target === a) {
          num.set(g.homeId, num.get(g.homeId)! + w[k] * yh(g)); den.set(g.homeId, den.get(g.homeId)! + w[k] * c * other.get(g.awayId)! * g0);
          num.set(g.awayId, num.get(g.awayId)! + w[k] * ya(g)); den.set(g.awayId, den.get(g.awayId)! + w[k] * c * other.get(g.homeId)!);
        } else {
          num.set(g.awayId, num.get(g.awayId)! + w[k] * yh(g)); den.set(g.awayId, den.get(g.awayId)! + w[k] * c * other.get(g.homeId)! * g0);
          num.set(g.homeId, num.get(g.homeId)! + w[k] * ya(g)); den.set(g.homeId, den.get(g.homeId)! + w[k] * c * other.get(g.awayId)!);
        }
      });
      ids.forEach((i) => target.set(i, num.get(i)! / den.get(i)!));
      const m = mean([...target.values()]) || 1; ids.forEach((i) => target.set(i, target.get(i)! / m));
    }
    let nh = 0, dh = 0, nc = 0, dc = 0;
    gs.forEach((g, k) => {
      const eh = a.get(g.homeId)! * d.get(g.awayId)!, ea = a.get(g.awayId)! * d.get(g.homeId)!;
      nh += w[k] * yh(g); dh += w[k] * c * eh; nc += w[k] * (yh(g) + ya(g)); dc += w[k] * (eh * g0 + ea);
    });
    if (dh > 0) g0 = clamp(nh / dh, 0.85, 1.35);
    if (dc > 0) c = Math.max(0.3, nc / dc);
  }
  const exp = (g: HistGame) => [c * a.get(g.homeId)! * d.get(g.awayId)! * g0, c * a.get(g.awayId)! * d.get(g.homeId)!];

  // Dispersion (baseball): Var = μ + μ²/r  →  r = Σμ² / Σ[(y−μ)² − μ]
  let dispersion: number | null = null, disp = 1;
  if (gs.length >= 40) {
    let s2 = 0, s1 = 0, pr = 0;
    gs.forEach((g) => { const [eh, ea] = exp(g); for (const [y, m] of [[yh(g), eh], [ya(g), ea]]) { s2 += m * m; s1 += (y - m) ** 2 - m; pr += (y - m) ** 2 / m; } });
    disp = pr / (2 * gs.length);
    if (sport === "baseball" && s1 > 0) dispersion = clamp(s2 / s1, 2, 60);
  } else if (sport === "baseball") dispersion = 6;

  const seg = gs.filter((g) => g.homeSeg != null && g.awaySeg != null);
  const segShare = seg.length >= 40 ? seg.reduce((s, g) => s + g.homeSeg! + g.awaySeg!, 0) / seg.reduce((s, g) => s + yh(g) + ya(g), 0) : D.share;
  const ties = gs.filter((g) => g.extraTime);
  const tieHomeWin = ties.length >= 40 ? clamp(ties.filter((g) => g.homeScore > g.awayScore).length / ties.length, 0.4, 0.6) : D.tieHome;
  let extraRate = D.extra;
  if (sport === "baseball") {
    const x = ties.filter((g) => g.homeReg != null);
    if (x.length >= 30) extraRate = clamp(mean(x.map((g) => (g.homeScore + g.awayScore - g.homeReg! - g.awayReg! - 1) / 2)), 0, 2);
  }
  let enTransfer = 0;
  if (sport === "hockey") {
    const reg = gs.filter((g) => !g.extraTime);
    if (reg.length >= 150) {
      let obs2 = 0, pred2 = 0, pred1 = 0;
      reg.forEach((g) => {
        if (Math.abs(g.homeScore - g.awayScore) >= 2) obs2++;
        const [eh, ea] = exp(g); const m = regulationMatrix(eh, ea, null, 12);
        m.forEach((row, i) => row.forEach((p, j) => { const dd = Math.abs(i - j); if (dd >= 2) pred2 += p; if (dd === 1) pred1 += p; }));
      });
      // Among games decided in regulation, the model's 2+ goal share is pred2/(pred1+pred2).
      // Choose e so that (pred2 + e·pred1)/(pred1 + pred2) matches the observed share.
      const obs = obs2 / reg.length;
      enTransfer = pred1 > 0 ? clamp((obs * (pred1 + pred2) - pred2) / pred1, 0, 0.35) : 0;
    }
  }
  const teams = new Map<string, CountTeam>();
  ids.forEach((i) => {
    let s = 0, n = 0; gs.forEach((g, k) => { if (g.homeId === i || g.awayId === i) { s += w[k]; n++; } });
    teams.set(i, { attack: c * a.get(i)!, defence: d.get(i)!, sampleWeight: s, games: n });
  });
  return { kind: "count", sport, base: c, home: g0, dispersion, segShare, tieHomeWin, extraRate, enTransfer, volatility: clamp(disp / 2, 0, 1), teams, n: gs.length };
}

export function pmf(k: number, mu: number, r: number | null): number {
  if (mu <= 0) return k === 0 ? 1 : 0;
  if (r == null) { let lf = 0; for (let i = 2; i <= k; i++) lf += Math.log(i); return Math.exp(k * Math.log(mu) - mu - lf); }
  // NB(r, p) with mean mu: p = r / (r + mu)
  const lg = (x: number) => lgamma(x);
  return Math.exp(lg(k + r) - lg(r) - lg(k + 1) + r * Math.log(r / (r + mu)) + k * Math.log(mu / (r + mu)));
}
function lgamma(x: number): number { // Lanczos
  const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1; let a = c[0]; const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

export function regulationMatrix(muH: number, muA: number, r: number | null, max: number): number[][] {
  const ph = Array.from({ length: max + 1 }, (_, i) => pmf(i, muH, r)), pa = Array.from({ length: max + 1 }, (_, j) => pmf(j, muA, r));
  const m = ph.map((x) => pa.map((y) => x * y));
  const s = m.flat().reduce((t, v) => t + v, 0);
  return m.map((row) => row.map((v) => v / s));
}

export interface CountOut {
  muH: number; muA: number; muSegH: number; muSegA: number;
  homeWin: number; fairTotal: number; fairSpread: number; fairSeg: number;
  totalAt: (l: number) => { a: number; push: number };
  coverAt: (homeLine: number) => { a: number; push: number };
  segAt: (l: number) => { a: number; push: number };
  regMatrix: number[][];
  segMatrix: number[][];
  /** Final score joint distribution after OT / extra innings: "h,a" → p */
  final: Map<string, number>;
}

export function predictCount(fit: CountFit, homeId: string, awayId: string, adj: { phiHome: number; phiAway: number }): CountOut {
  const th = fit.teams.get(homeId) ?? { attack: fit.base, defence: 1 }, ta = fit.teams.get(awayId) ?? { attack: fit.base, defence: 1 };
  const muH = th.attack * ta.defence * fit.home * adj.phiHome, muA = ta.attack * th.defence * adj.phiAway;
  const max = fit.sport === "baseball" ? 25 : 12;
  const m = regulationMatrix(muH, muA, fit.dispersion, max);

  // Final-score distributions (margin, total) after resolving ties.
  const margin = new Map<number, number>(), total = new Map<number, number>(), final = new Map<string, number>();
  const add = (mp: Map<number, number>, k: number, p: number) => mp.set(k, (mp.get(k) ?? 0) + p);
  const addF = (h: number, a: number, p: number) => final.set(`${h},${a}`, (final.get(`${h},${a}`) ?? 0) + p);
  const yPmf = Array.from({ length: 8 }, (_, y) => pmf(y, fit.extraRate, null));
  m.forEach((row, i) => row.forEach((p, j) => {
    if (i !== j) {
      const dlt = i - j;
      if (fit.sport === "hockey" && Math.abs(dlt) === 1 && fit.enTransfer > 0) {
        add(margin, dlt, p * (1 - fit.enTransfer)); add(total, i + j, p * (1 - fit.enTransfer));
        add(margin, dlt * 2, p * fit.enTransfer); add(total, i + j + 1, p * fit.enTransfer);
        addF(i, j, p * (1 - fit.enTransfer)); addF(i + (dlt > 0 ? 1 : 0), j + (dlt < 0 ? 1 : 0), p * fit.enTransfer);
      } else { add(margin, dlt, p); add(total, i + j, p); addF(i, j, p); }
    } else {
      add(margin, 1, p * fit.tieHomeWin); add(margin, -1, p * (1 - fit.tieHomeWin));
      if (fit.sport === "hockey") { add(total, 2 * i + 1, p); addF(i + 1, i, p * fit.tieHomeWin); addF(i, i + 1, p * (1 - fit.tieHomeWin)); }
      else yPmf.forEach((py, y) => { add(total, 2 * i + 1 + 2 * y, p * py); addF(i + y + 1, i + y, p * py * fit.tieHomeWin); addF(i + y, i + y + 1, p * py * (1 - fit.tieHomeWin)); });
    }
  }));
  const tail = (mp: Map<number, number>, pred: (k: number) => boolean) => [...mp].reduce((s, [k, p]) => s + (pred(k) ? p : 0), 0);
  const lineProb = (mp: Map<number, number>, l: number) => ({ a: tail(mp, (k) => k > l), push: Number.isInteger(l) ? mp.get(l) ?? 0 : 0 });

  // Segment: independent counts with share-scaled means; NB size scales with the share.
  const sH = muH * fit.segShare, sA = muA * fit.segShare, rs = fit.dispersion == null ? null : fit.dispersion * fit.segShare;
  const segM = regulationMatrix(sH, sA, rs, max);
  const segTot = new Map<number, number>(); segM.forEach((row, i) => row.forEach((p, j) => add(segTot, i + j, p)));

  const median = (mp: Map<number, number>) => { let c = 0; for (const k of [...mp.keys()].sort((x, y) => x - y)) { c += mp.get(k)!; if (c >= 0.5) return k; } return 0; };
  const eMargin = [...margin].reduce((s, [k, p]) => s + k * p, 0);
  return {
    muH, muA, muSegH: sH, muSegA: sA, regMatrix: m, segMatrix: segM, final,
    homeWin: tail(margin, (k) => k > 0),
    fairTotal: median(total), fairSpread: -eMargin, fairSeg: median(segTot),
    totalAt: (l) => lineProb(total, l),
    coverAt: (L) => ({ a: tail(margin, (k) => k + L > 0), push: Number.isInteger(L) ? margin.get(-L) ?? 0 : 0 }),
    segAt: (l) => lineProb(segTot, l),
  };
}

export function countLadders(p: CountOut, cfg: { width: number; handicaps: number[] }) {
  const total: LadderRow[] = halfLines(p.fairTotal, 1, cfg.width).map((line) => ({ line, ...p.totalAt(line) }));
  const seg: LadderRow[] = halfLines(p.fairSeg, 1, Math.max(2, cfg.width)).map((line) => ({ line, ...p.segAt(line) }));
  const spread: LadderRow[] = [-2.5, ...cfg.handicaps, 2.5].sort((a, b) => a - b).map((line) => ({ line, ...p.coverAt(line) }));
  return { total, spread, seg };
}
