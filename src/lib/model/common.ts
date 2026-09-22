export const DAY = 86_400_000;

export function recencyWeight(daysAgo: number, halfLife: number): number {
  return Math.exp((-Math.LN2 * Math.max(0, daysAgo)) / halfLife);
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 via erf, |error| < 1.5e-7). */
export function normCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

export interface HistGame {
  homeId: string; awayId: string; date: Date;
  homeScore: number; awayScore: number;          // final
  homeReg?: number | null; awayReg?: number | null; // regulation
  homeSeg?: number | null; awaySeg?: number | null; // segment
  extraTime?: boolean;
}

/** A ladder row. `a` = over (totals) or home cover (handicap). push is non-zero only on whole-number lines. */
export interface LadderRow { line: number; a: number; push: number }
export interface Ladders { total: LadderRow[]; spread: LadderRow[]; seg: LadderRow[] }

/** Line ladder centred on `center`, on .5 values, `width` steps each side. */
export function halfLines(center: number, step: number, width: number, min = 0.5): number[] {
  const c = Math.floor(center) + 0.5;
  const out: number[] = [];
  for (let k = -width; k <= width; k++) { const l = c + k * step; if (l >= min) out.push(Math.round(l * 10) / 10); }
  return out;
}

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
