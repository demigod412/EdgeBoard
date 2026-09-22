/* Synthetic seasons for DEMO mode and backtests. Hidden team strengths → scores, segments, OT/extras, book lines. */
import { makeRng, poissonSample } from "./rng";
import type { SportId } from "../sports";

export interface SimGame {
  home: number; away: number; date: Date;
  homeScore: number; awayScore: number; homeReg: number; awayReg: number; homeSeg: number; awaySeg: number; extraTime: boolean;
  book: { total: number; spread: number; seg: number }; // "market" lines built from the truth plus noise
  prices?: { ml: [number, number]; total: [number, number]; spread: [number, number]; seg: [number, number] };
  homeFirst?: number; awayFirst?: number;
}
type Rng = () => number;
const normal = (r: Rng) => Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r());
function gamma(r: Rng, k: number): number { // Marsaglia–Tsang, k ≥ 1 (boost for k < 1)
  if (k < 1) return gamma(r, k + 1) * Math.pow(r(), 1 / k);
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) { let x, v; do { x = normal(r); v = 1 + c * x; } while (v <= 0); v = v ** 3; const u = r(); if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v; }
}
const nb = (r: Rng, mu: number, size: number) => poissonSample(r, (gamma(r, size) / size) * mu);
const binom = (r: Rng, n: number, p: number) => { let k = 0; for (let i = 0; i < n; i++) if (r() < p) k++; return k; };
const half = (x: number) => Math.floor(x) + 0.5;

export function makeTruth(sport: SportId, n: number, seed: number) {
  const r = makeRng(seed);
  return Array.from({ length: n }, () => sport === "basketball"
    ? { o: normal(r) * 4, d: normal(r) * 4 }
    : { o: Math.exp(normal(r) * (sport === "baseball" ? 0.12 : 0.13)), d: Math.exp(normal(r) * (sport === "baseball" ? 0.12 : 0.13)) });
}

export function simulateGame(sport: SportId, r: Rng, t: { o: number; d: number }[], h: number, a: number, date: Date): SimGame {
  if (sport === "basketball") {
    const mh = 112 + 1.3 + t[h].o + t[a].d, ma = 112 - 1.3 + t[a].o + t[h].d;
    let hs = Math.round(mh + normal(r) * 11), as = Math.round(ma + normal(r) * 11);
    const hSeg = Math.round(hs * 0.505 + normal(r) * 4), aSeg = Math.round(as * 0.505 + normal(r) * 4);
    const hr = hs, ar = as; let ot = false;
    while (hs === as) { ot = true; hs += Math.round(10 + normal(r) * 3); as += Math.round(10 + normal(r) * 3); }
    const book = { total: half(mh + ma + normal(r) * 2), spread: half(-(mh - ma) + normal(r) * 1.5), seg: half((mh + ma) * 0.505 + normal(r) * 1.2) };
    return { home: h, away: a, date, homeScore: hs, awayScore: as, homeReg: hr, awayReg: ar, homeSeg: hSeg, awaySeg: aSeg, extraTime: ot, book };
  }
  if (sport === "baseball") {
    const mh = 4.3 * t[h].o * t[a].d * 1.04, ma = 4.3 * t[a].o * t[h].d;
    const hr = nb(r, mh, 6), ar = nb(r, ma, 6);
    const hSeg = binom(r, hr, 0.556), aSeg = binom(r, ar, 0.556);
    let hs = hr, as = ar, ex = false;
    if (hr === ar) { ex = true; const y = poissonSample(r, 0.35); if (r() < 0.52) { hs += y + 1; as += y; } else { as += y + 1; hs += y; } }
    const book = { total: half(mh + ma + normal(r) * 0.4), spread: mh >= ma ? -1.5 : 1.5, seg: half((mh + ma) * 0.556 + normal(r) * 0.3) };
    return { home: h, away: a, date, homeScore: hs, awayScore: as, homeReg: hr, awayReg: ar, homeSeg: hSeg, awaySeg: aSeg, extraTime: ex, book };
  }
  const mh = 2.95 * t[h].o * t[a].d * 1.05, ma = 2.95 * t[a].o * t[h].d;
  let hr = poissonSample(r, mh), ar = poissonSample(r, ma);
  if (Math.abs(hr - ar) === 1 && r() < 0.15) { if (hr > ar) hr++; else ar++; } // empty-net goal
  const hSeg = binom(r, hr, 0.31), aSeg = binom(r, ar, 0.31);
  let hs = hr, as = ar, ex = false;
  if (hr === ar) { ex = true; if (r() < 0.5) hs++; else as++; }
  const book = { total: half(mh + ma + 0.25 + normal(r) * 0.25), spread: mh >= ma ? -1.5 : 1.5, seg: half((mh + ma) * 0.31 + normal(r) * 0.15) };
  return { home: h, away: a, date, homeScore: hs, awayScore: as, homeReg: hr, awayReg: ar, homeSeg: hSeg, awaySeg: aSeg, extraTime: ex, book };
}

/** Schedule: every team plays ~every `gap` days; returns games in date order. */
export function simulateSeason(sport: SportId, nTeams: number, startMs: number, days: number, seed: number) {
  const r = makeRng(seed + 17), truth = makeTruth(sport, nTeams, seed);
  const gap = sport === "baseball" ? 1 : 2;
  const games: SimGame[] = [];
  for (let day = 0; day < days; day += gap) {
    const perm = [...Array(nTeams).keys()].sort(() => r() - 0.5);
    const hour = sport === "baseball" ? 23 : 0; // evening US ≈ late night WAT
    for (let k = 0; k + 1 < nTeams; k += 2) games.push(simulateGame(sport, r, truth, perm[k], perm[k + 1], new Date(startMs + day * 864e5 + (hour + (k % 3)) * 3600e3)));
  }
  return { games, truth };
}

/** Demo bookmaker prices: probabilities from 300 re-simulations of the same matchup, 5% margin, small noise. */
export function withPrices(sport: SportId, r: Rng, t: { o: number; d: number }[], g: SimGame): SimGame {
  const N = 300, sr = makeRng(Math.floor(r() * 1e9));
  let hw = 0, over = 0, cov = 0, sov = 0;
  for (let i = 0; i < N; i++) {
    const x = simulateGame(sport, sr, t, g.home, g.away, g.date);
    if (x.homeScore > x.awayScore) hw++;
    if (x.homeScore + x.awayScore > g.book.total) over++;
    if (x.homeScore - x.awayScore + g.book.spread > 0) cov++;
    if (x.homeSeg + x.awaySeg > g.book.seg) sov++;
  }
  const px = (k: number) => { const p = Math.min(0.97, Math.max(0.03, k / N)); const q = 1 - p;
    const f = (v: number) => Math.round(Math.max(1.02, (1 / (v * 1.05)) * (1 + (r() - 0.5) * 0.06)) * 100) / 100; return [f(p), f(q)] as [number, number]; };
  const out: SimGame = { ...g, prices: { ml: px(hw), total: px(over), spread: px(cov), seg: px(sov) } };
  if (sport === "baseball") { out.homeFirst = binom(r, g.homeSeg, 0.2); out.awayFirst = binom(r, g.awaySeg, 0.2); }
  return out;
}
