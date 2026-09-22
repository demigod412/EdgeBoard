import type { Prediction } from "@prisma/client";
import { marketsOf } from "./picks";
import { headlineExcluded, hitOf, TOP_CAPS, type GameResult, type Group, type Mkt } from "./markets";

/*
 * Top tips: one tip per game (its strongest qualifying market), ranked by strength.
 *   strength = p × (0.85 + 0.15 × confidence/100);  Medium/High confidence only;  p ≥ 55%.
 * Mixed list caps: ≤ 2 underdog handicaps (+1.5 style), ≤ 3 team totals, never "no overtime / no extra innings".
 * A game whose best market is capped out falls back to its next-best market.
 */
export const TOP_N = 20;
export const MIN_P = 0.55;
export const WINDOWS = [1, 2, 3, 4, 5, 6, 7] as const;
export interface Tip extends Mkt { strength: number }

export const strengthOf = (p: number, confidence: number) => p * (0.85 + 0.15 * (confidence / 100));

export function tipsFor(p: Prediction, group?: Group): Tip[] {
  if (p.band === "LOW") return [];
  return marketsOf(p).filter((m) => m.p >= MIN_P && (!group || m.group === group))
    .map((m) => ({ ...m, strength: strengthOf(m.p, p.confidence) })).sort((a, b) => b.strength - a.strength);
}

/** Headline pick for a game: never "no overtime" or an underdog + handicap. */
export function bestTip(p: Prediction, group?: Group): Tip | null {
  return tipsFor(p, group).find((t) => group || !headlineExcluded(t)) ?? null;
}

export function selectTop<T>(items: { item: T; id: string; tips: Tip[]; startMs: number }[], group?: Group, n = TOP_N) {
  const pairs = items.flatMap((x) => x.tips.map((tip) => ({ x, tip }))).sort((a, b) => b.tip.strength - a.tip.strength || a.x.startMs - b.x.startMs);
  const used = new Set<string>(), count = TOP_CAPS.map(() => 0), out: { item: T; tip: Tip }[] = [];
  for (const { x, tip } of pairs) {
    if (out.length >= n) break;
    if (used.has(x.id)) continue;
    const ci = group ? -1 : TOP_CAPS.findIndex((c) => c.test(tip));
    if (ci >= 0 && count[ci] >= TOP_CAPS[ci].max) continue;
    used.add(x.id); if (ci >= 0) count[ci]++;
    out.push({ item: x.item, tip });
  }
  return out;
}

export const tipHit = (t: Mkt, r: GameResult) => hitOf(t, r);
