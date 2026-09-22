import type { MarketLine, Prediction } from "@prisma/client";
import { marketsOf } from "./picks";
import type { Mkt } from "./markets";

/*
 * Value: where the model probability beats the bookmaker price.  edge = p × odds − 1.
 * Prices come from the stored main lines (moneyline, total, handicap, segment total) — only markets at the SAME line
 * as the bookmaker are compared. Filters: Medium/High, p ≥ 35%, odds 1.40–6.00, edge ≥ 3%.
 */
export const VALUE = { minP: 0.35, minOdds: 1.4, maxOdds: 6, minEdge: 0.03, topN: 20 };
export interface ValueTip extends Mkt { odds: number; edge: number; fair: number }

/** Latest price per market ("moneyline" | "total" | "spread" | "seg_total"), newest first input. */
export function latestLines(lines: Pick<MarketLine, "market" | "line" | "priceA" | "priceB" | "fetchedAt">[], before?: Date) {
  const out = new Map<string, { line: number; a: number | null; b: number | null }>();
  for (const l of lines) { if (before && l.fetchedAt > before) continue; if (!out.has(l.market)) out.set(l.market, { line: l.line, a: l.priceA, b: l.priceB }); }
  return out;
}

export function oddsFor(m: Mkt, lines: ReturnType<typeof latestLines>): number | null {
  const q = (k: string) => lines.get(k);
  if (m.kind === "win") { const x = q("moneyline"); return x ? (m.side === "home" ? x.a : x.b) : null; }
  if (m.kind === "total") { const x = q("total"); return x && x.line === m.line ? (m.side === "over" ? x.a : x.b) : null; }
  if (m.kind === "seg") { const x = q("seg_total"); return x && x.line === m.line ? (m.side === "over" ? x.a : x.b) : null; }
  if (m.kind === "spread") { const x = q("spread"); if (!x) return null; const homeLine = m.side === "home" ? m.line : -(m.line ?? 0); return x.line === homeLine ? (m.side === "home" ? x.a : x.b) : null; }
  return null;
}

export function valueTips(p: Prediction, lines: ReturnType<typeof latestLines>): ValueTip[] {
  if (p.band === "LOW") return [];
  return marketsOf(p).flatMap((m) => {
    const o = oddsFor(m, lines);
    if (!o || m.p < VALUE.minP || o < VALUE.minOdds || o > VALUE.maxOdds) return [];
    const edge = m.p * o - 1;
    return edge >= VALUE.minEdge ? [{ ...m, odds: o, edge, fair: 1 / m.p }] : [];
  }).sort((a, b) => b.edge - a.edge);
}

export function selectTopValue<T>(items: { item: T; tips: ValueTip[]; startMs: number }[], n = VALUE.topN) {
  return items.flatMap((x) => (x.tips[0] ? [{ item: x.item, tip: x.tips[0], startMs: x.startMs }] : []))
    .sort((a, b) => b.tip.edge - a.tip.edge || a.startMs - b.startMs).slice(0, n);
}

export function flatStakeRoi(bets: { odds: number; hit: boolean }[]) {
  const profit = bets.reduce((s, b) => s + (b.hit ? b.odds - 1 : -1), 0);
  return { n: bets.length, hits: bets.filter((b) => b.hit).length, profit, roi: bets.length ? profit / bets.length : 0 };
}
