/* Slip maths (pure). */
export interface Leg {
  gameId: string; sport: string; market: string; label: string; match: string; start: string; // ISO
  p: number; band: string; addedAt: string;
}
export const MAX_LEGS = 30;
export const combinedP = (legs: { p: number }[]) => legs.reduce((s, l) => s * l.p, 1);
export const fairOdds = (p: number) => (p > 0 ? 1 / p : Infinity);
export function addLeg(legs: Leg[], leg: Leg) {
  const i = legs.findIndex((l) => l.gameId === leg.gameId);
  if (i >= 0) { const next = [...legs]; next[i] = leg; return { legs: next, replaced: true, full: false }; }
  if (legs.length >= MAX_LEGS) return { legs, replaced: false, full: true };
  return { legs: [...legs, leg], replaced: false, full: false };
}
export const removeLeg = (legs: Leg[], gameId: string) => legs.filter((l) => l.gameId !== gameId);
export function dropWeakest(legs: Leg[]) {
  if (!legs.length) return { legs, dropped: [] as Leg[] };
  const w = legs.reduce((m, l) => (l.p < m.p ? l : m));
  return { legs: legs.filter((l) => l !== w), dropped: [w] };
}
export const dropLowConfidence = (legs: Leg[]) => ({ legs: legs.filter((l) => l.band !== "LOW"), dropped: legs.filter((l) => l.band === "LOW") });
export function trimToTarget(legs: Leg[], target: number) {
  let cur = [...legs]; const dropped: Leg[] = [];
  while (cur.length > 1 && combinedP(cur) < target) { const r = dropWeakest(cur); cur = r.legs; dropped.push(...r.dropped); }
  return { legs: cur, dropped };
}
export function splitInTwo(legs: Leg[]): [Leg[], Leg[]] {
  const s = [...legs].sort((a, b) => b.p - a.p), a: Leg[] = [], b: Leg[] = [];
  s.forEach((l, i) => (i % 2 === 0 ? a : b).push(l)); return [a, b];
}
export function mergeSlips(a: Leg[], b: Leg[]) {
  const out = new Map(a.map((l) => [l.gameId, l])); const duplicates: string[] = [];
  for (const l of b) { const cur = out.get(l.gameId); if (cur) { duplicates.push(l.match); if (l.p > cur.p) out.set(l.gameId, l); } else out.set(l.gameId, l); }
  return { legs: [...out.values()].slice(0, MAX_LEGS), duplicates };
}
export function slipText(name: string, legs: Leg[], fmt: (iso: string) => string) {
  const p = combinedP(legs);
  return [`${name} — ${legs.length} leg${legs.length === 1 ? "" : "s"}`,
    ...legs.map((l, i) => `${i + 1}. [${l.sport}] ${l.match} (${fmt(l.start)}): ${l.label} — ${(l.p * 100).toFixed(0)}%`),
    `Combined model probability ${(p * 100).toFixed(1)}% · fair odds ${fairOdds(p).toFixed(2)}`, `EdgeBoard statistical estimates, not guarantees. 18+`].join("\n");
}
