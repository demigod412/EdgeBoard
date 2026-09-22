/*
 * Basketball: points are close to Normal. Weighted ridge regression on points scored:
 *   home points = μ + h/2 + o_H + d_A        away points = μ − h/2 + o_A + d_H
 * o = offence (points above league mean), d = defence (points allowed above mean; lower is better).
 * Margin ~ N(μ_H − μ_A, σ_M²), Total ~ N(μ_H + μ_A, σ_T²); σ fitted from recency-weighted residuals.
 * Segment (1st half): μ_seg = share · μ, σ_seg = ratio · σ_T; share and ratio fitted from half-time scores.
 */
import { clamp, DAY, halfLines, normCdf, recencyWeight, type HistGame, type LadderRow } from "./common";

export interface NormalTeam { o: number; d: number; sampleWeight: number; games: number }
export interface NormalFit {
  kind: "normal";
  mu: number; home: number; sigmaM: number; sigmaT: number;
  segShare: number; segSigmaRatio: number; volatility: number;
  teams: Map<string, NormalTeam>; n: number;
}

const RIDGE = 4;           // pseudo-games of shrinkage toward league average
const HALF_LIFE = 60;      // days
const DEF = { mu: 112, sigmaM: 12.5, sigmaT: 18.5, share: 0.505, ratio: 0.64 };

export function fitNormal(games: HistGame[], asOf: Date, defaults = DEF): NormalFit {
  const gs = games.filter((g) => g.date < asOf);
  const w = gs.map((g) => recencyWeight((asOf.getTime() - g.date.getTime()) / DAY, HALF_LIFE));
  const ids = new Set<string>(); gs.forEach((g) => { ids.add(g.homeId); ids.add(g.awayId); });
  const o = new Map<string, number>(), d = new Map<string, number>();
  ids.forEach((i) => { o.set(i, 0); d.set(i, 0); });
  const sw = w.reduce((s, x) => s + x, 0) || 1;
  let mu = gs.length ? gs.reduce((s, g, k) => s + w[k] * (g.homeScore + g.awayScore), 0) / (2 * sw) : defaults.mu;
  let h = gs.length ? gs.reduce((s, g, k) => s + w[k] * (g.homeScore - g.awayScore), 0) / sw : 2.5;

  for (let it = 0; it < 40; it++) {
    const num = new Map<string, number>(), den = new Map<string, number>();
    ids.forEach((i) => { num.set(i, 0); den.set(i, RIDGE); });
    gs.forEach((g, k) => {
      num.set(g.homeId, num.get(g.homeId)! + w[k] * (g.homeScore - mu - h / 2 - d.get(g.awayId)!)); den.set(g.homeId, den.get(g.homeId)! + w[k]);
      num.set(g.awayId, num.get(g.awayId)! + w[k] * (g.awayScore - mu + h / 2 - d.get(g.homeId)!)); den.set(g.awayId, den.get(g.awayId)! + w[k]);
    });
    ids.forEach((i) => o.set(i, num.get(i)! / den.get(i)!));
    ids.forEach((i) => { num.set(i, 0); den.set(i, RIDGE); });
    gs.forEach((g, k) => {
      num.set(g.awayId, num.get(g.awayId)! + w[k] * (g.homeScore - mu - h / 2 - o.get(g.homeId)!)); den.set(g.awayId, den.get(g.awayId)! + w[k]);
      num.set(g.homeId, num.get(g.homeId)! + w[k] * (g.awayScore - mu + h / 2 - o.get(g.awayId)!)); den.set(g.homeId, den.get(g.homeId)! + w[k]);
    });
    ids.forEach((i) => d.set(i, num.get(i)! / den.get(i)!));
    const mo = [...o.values()].reduce((s, x) => s + x, 0) / (ids.size || 1), md = [...d.values()].reduce((s, x) => s + x, 0) / (ids.size || 1);
    ids.forEach((i) => { o.set(i, o.get(i)! - mo); d.set(i, d.get(i)! - md); });
    if (gs.length) {
      let sm = 0, sh = 0;
      gs.forEach((g, k) => {
        const eh = o.get(g.homeId)! + d.get(g.awayId)!, ea = o.get(g.awayId)! + d.get(g.homeId)!;
        sm += w[k] * (g.homeScore + g.awayScore - eh - ea); sh += w[k] * (g.homeScore - g.awayScore - eh + ea);
      });
      mu = sm / (2 * sw); h = sh / sw;
    }
  }

  // Residual spreads (inflated 6% for out-of-sample), segment share and spread ratio.
  let sigmaM = defaults.sigmaM * (mu / defaults.mu), sigmaT = defaults.sigmaT * (mu / defaults.mu);
  if (gs.length >= 60) {
    let rm = 0, rt = 0;
    gs.forEach((g, k) => {
      const eh = mu + h / 2 + o.get(g.homeId)! + d.get(g.awayId)!, ea = mu - h / 2 + o.get(g.awayId)! + d.get(g.homeId)!;
      rm += w[k] * (g.homeScore - g.awayScore - (eh - ea)) ** 2; rt += w[k] * (g.homeScore + g.awayScore - (eh + ea)) ** 2;
    });
    sigmaM = Math.sqrt(rm / sw) * 1.06; sigmaT = Math.sqrt(rt / sw) * 1.06;
  }
  let segShare = defaults.share, segSigmaRatio = defaults.ratio;
  const seg = gs.filter((g) => g.homeSeg != null && g.awaySeg != null);
  if (seg.length >= 40) {
    const tot = seg.reduce((s, g) => s + g.homeScore + g.awayScore, 0);
    segShare = seg.reduce((s, g) => s + g.homeSeg! + g.awaySeg!, 0) / tot;
    const r = Math.sqrt(seg.reduce((s, g) => s + (g.homeSeg! + g.awaySeg! - segShare * (g.homeScore + g.awayScore)) ** 2, 0) / seg.length);
    // residual vs realised total understates vs predicted total; blend with prior
    segSigmaRatio = clamp((r / sigmaT) * 0.5 + defaults.ratio * 0.5, 0.45, 0.85);
  }
  const teams = new Map<string, NormalTeam>();
  ids.forEach((i) => {
    let s = 0, n = 0; gs.forEach((g, k) => { if (g.homeId === i || g.awayId === i) { s += w[k]; n++; } });
    teams.set(i, { o: o.get(i)!, d: d.get(i)!, sampleWeight: s, games: n });
  });
  return { kind: "normal", mu, home: h, sigmaM, sigmaT, segShare, segSigmaRatio, volatility: clamp(0.5 * sigmaM / (DEF.sigmaM * mu / DEF.mu), 0, 1), teams, n: gs.length };
}

/** P(X > line) for integer-valued X ≈ N(m, s²) with continuity correction; push when line is whole. */
function overProb(line: number, m: number, s: number) {
  if (Number.isInteger(line)) {
    const up = 1 - normCdf((line + 0.5 - m) / s), push = normCdf((line + 0.5 - m) / s) - normCdf((line - 0.5 - m) / s);
    return { a: up, push };
  }
  return { a: 1 - normCdf((line - m) / s), push: 0 };
}

export interface NormalOut {
  muH: number; muA: number; muSegH: number; muSegA: number; sigmaM: number; sigmaT: number; sigmaSeg: number;
  homeWin: number; fairTotal: number; fairSpread: number; fairSeg: number;
  totalAt: (l: number) => { a: number; push: number };
  coverAt: (homeLine: number) => { a: number; push: number };
  segAt: (l: number) => { a: number; push: number };
}

export function predictNormal(fit: NormalFit, homeId: string, awayId: string, adj: { restHome: number; restAway: number }): NormalOut {
  const th = fit.teams.get(homeId) ?? { o: 0, d: 0 }, ta = fit.teams.get(awayId) ?? { o: 0, d: 0 };
  const muH = fit.mu + fit.home / 2 + th.o + ta.d + adj.restHome;
  const muA = fit.mu - fit.home / 2 + ta.o + th.d + adj.restAway;
  const mM = muH - muA, mT = muH + muA, sSeg = fit.sigmaT * fit.segSigmaRatio;
  return {
    muH, muA, muSegH: muH * fit.segShare, muSegA: muA * fit.segShare, sigmaM: fit.sigmaM, sigmaT: fit.sigmaT, sigmaSeg: sSeg,
    homeWin: normCdf(mM / fit.sigmaM), // OT resolves ties; a tied regulation splits symmetrically around 0
    fairTotal: mT, fairSpread: -mM, fairSeg: mT * fit.segShare,
    totalAt: (l) => overProb(l, mT, fit.sigmaT),
    coverAt: (L) => { const r = overProb(-L, mM, fit.sigmaM); return r; }, // home covers L ⇔ margin > −L
    segAt: (l) => overProb(l, mT * fit.segShare, sSeg),
  };
}

export function normalLadders(p: NormalOut, cfg: { width: number }) {
  const total: LadderRow[] = halfLines(p.fairTotal, 1, cfg.width).map((line) => ({ line, ...p.totalAt(line) }));
  const seg: LadderRow[] = halfLines(p.fairSeg, 1, Math.ceil(cfg.width * 0.6)).map((line) => ({ line, ...p.segAt(line) }));
  const spread: LadderRow[] = halfLines(p.fairSpread, 1, cfg.width, -80).map((line) => ({ line, ...p.coverAt(line) }));
  return { total, spread, seg };
}
