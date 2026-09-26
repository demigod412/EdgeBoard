/* Accuracy maths for locked calls (pure; unit-tested). Win probability is 2-way (OT / extras decide every game). */
import { formatInTimeZone } from "date-fns-tz";
import { hitOf, type GameResult, type Mkt } from "./markets";

export interface ScoredCall { start: Date; band: string; pHome: number; result: GameResult; markets: Mkt[]; market: number | null /* de-vigged home prob before lock */ }
export interface Metrics { n: number; brier: number; logloss: number; hit: number }
const agg = (rows: { p: number; y: boolean }[]): Metrics => {
  const n = rows.length || 1;
  return { n: rows.length, brier: rows.reduce((s, r) => s + (r.p - (r.y ? 1 : 0)) ** 2, 0) / n,
    logloss: rows.reduce((s, r) => s - Math.log(Math.max(1e-12, r.y ? r.p : 1 - r.p)), 0) / n,
    hit: rows.filter((r) => (r.p >= 0.5) === r.y).length / n };
};
export const devig2 = (home: number, away: number) => (1 / home) / (1 / home + 1 / away);

/**
 * Market-type label for the hit table (lines collapsed: "Total over", "Team total", "Overtime yes"…).
 * Exported because the ledger's per-market record is keyed by it, and the builder looks up a market's
 * trust under the same name — the two must agree or the weighting silently does nothing.
 */
export const kindLabel = (m: Mkt) => ({
  win: "Win", total: m.strong ? "Strong total" : "Total (main line)", spread: m.strong ? "Strong handicap" : "Handicap (main line)", seg: m.strong ? "Strong segment total" : "Segment total (main line)",
  team_total: "Team total (strong line)", margin: "Winning margin band", ot: m.side === "yes" ? "Overtime / extras: yes" : "Overtime / extras: no",
  reg3: "Regulation 3-way", seg3: "Segment 3-way", btts: "Both teams score", nrfi: m.side === "no_run" ? "NRFI" : "YRFI",
}[m.kind]);

export function computeAccuracy(calls: ScoredCall[]) {
  const rows = calls.map((c) => ({ p: c.pHome, y: c.result.h > c.result.a, c }));
  const base = (rows.filter((r) => r.y).length + 1) / (rows.length + 2);
  const withMarket = rows.filter((r) => r.c.market != null);
  const byBand: Record<string, Metrics> = {};
  for (const b of ["HIGH", "MEDIUM", "LOW"]) { const x = rows.filter((r) => r.c.band === b); if (x.length) byBand[b] = agg(x); }
  const mk = new Map<string, { n: number; hit: number; p: number }>();
  for (const { c } of rows) for (const m of c.markets) {
    if (m.p < 0.5) continue;
    const h = hitOf(m, c.result); if (h == null) continue;
    const k = kindLabel(m); const e = mk.get(k) ?? { n: 0, hit: 0, p: 0 }; e.n++; e.p += m.p; if (h) e.hit++; mk.set(k, e);
  }
  const buckets = Array.from({ length: 5 }, (_, i) => ({ lo: 0.5 + i * 0.1, n: 0, p: 0, y: 0 }));
  for (const r of rows) { const fav = Math.max(r.p, 1 - r.p), b = buckets[Math.min(4, Math.floor((fav - 0.5) / 0.1))]; b.n++; b.p += fav; if ((r.p >= 0.5) === r.y) b.y++; }
  return {
    n: rows.length, model: agg(rows),
    alwaysHome: { ...agg(rows.map((r) => ({ p: base, y: r.y }))), hit: rows.filter((r) => r.y).length / (rows.length || 1) },
    market: withMarket.length ? { model: agg(withMarket), market: agg(withMarket.map((r) => ({ p: r.c.market!, y: r.y }))) } : null,
    byBand,
    markets: [...mk.entries()].map(([label, e]) => ({ label, n: e.n, hit: e.hit / e.n, avgP: e.p / e.n })).sort((a, b) => b.n - a.n),
    calibration: buckets.filter((b) => b.n).map((b) => ({ lo: b.lo, n: b.n, avgP: b.p / b.n, rate: b.y / b.n })),
  };
}
export function dailySeries(calls: ScoredCall[], tz = "Africa/Lagos") {
  const by = new Map<string, ScoredCall[]>();
  for (const c of calls) { const k = formatInTimeZone(c.start, tz, "yyyy-MM-dd"); by.set(k, [...(by.get(k) ?? []), c]); }
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, cs]) => { const r = computeAccuracy(cs); return { day, n: r.n, model: r.model.brier, home: r.alwaysHome.brier }; });
}
