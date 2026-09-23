/*
 * Every market EdgeBoard offers for a game, as one flat list stored with the prediction (picks.markets).
 * Each market knows how to score itself against the final result, so ledgers and track records are generic.
 */
export type Group = "win" | "total" | "spread" | "seg" | "team" | "props";
export type Kind = "win" | "total" | "spread" | "seg" | "team_total" | "margin" | "ot" | "reg3" | "seg3" | "btts" | "nrfi";
export interface Mkt {
  key: string; group: Group; kind: Kind;
  side: string;          // home|away|over|under|yes|no|draw|home:over …
  line?: number | null; lo?: number; hi?: number;
  label: string; short: string; p: number;
  strong?: boolean;      // most aggressive line still at/above the strong floor
  main?: boolean;        // at the main line (bookmaker line, or the model's estimate of it)
  alt?: boolean;         // alternative line: listed under All markets / Blend / slips, not a Top 20 or headline candidate unless strong
}
export const GROUP_LABEL: Record<Group, string> = { win: "Win", total: "Total", spread: "Handicap", seg: "First segment", team: "Team totals", props: "Specials" };

export interface GameResult {
  h: number; a: number; hSeg?: number | null; aSeg?: number | null; hReg?: number | null; aReg?: number | null;
  extra?: boolean; hFirst?: number | null; aFirst?: number | null;
}

/** true = won, false = lost, null = push or not scorable (missing data). */
export function hitOf(m: Mkt, r: GameResult): boolean | null {
  const over = (v: number | null | undefined, dir: string, line: number) => (v == null || v === line ? null : dir === "over" ? v > line : v < line);
  const three = (h: number | null | undefined, a: number | null | undefined, side: string) => (h == null || a == null ? null : side === "home" ? h > a : side === "away" ? a > h : h === a);
  switch (m.kind) {
    case "win": return m.side === "home" ? r.h > r.a : r.a > r.h;
    case "total": return over(r.h + r.a, m.side, m.line!);
    case "seg": return over(r.hSeg != null && r.aSeg != null ? r.hSeg + r.aSeg : null, m.side, m.line!);
    case "spread": { const d = (m.side === "home" ? r.h - r.a : r.a - r.h) + m.line!; return d === 0 ? null : d > 0; }
    case "team_total": { const [team, dir] = m.side.split(":"); return over(team === "home" ? r.h : r.a, dir, m.line!); }
    case "margin": { const d = m.side === "home" ? r.h - r.a : r.a - r.h; return d >= m.lo! && d <= m.hi!; }
    case "ot": return r.extra == null ? null : m.side === "yes" ? r.extra : !r.extra;
    case "reg3": return three(r.hReg, r.aReg, m.side);
    case "seg3": return three(r.hSeg, r.aSeg, m.side);
    case "btts": return m.side === "yes" ? r.h > 0 && r.a > 0 : r.h === 0 || r.a === 0;
    case "nrfi": return r.hFirst == null || r.aFirst == null ? null : m.side === "no_run" ? r.hFirst + r.aFirst === 0 : r.hFirst + r.aFirst > 0;
  }
}

/** Never the headline pick of a game: near-certain or "too easy" markets (still listed under All markets). */
export const headlineExcluded = (m: Mkt) =>
  (m.kind === "ot" && m.side === "no") || (m.kind === "spread" && (m.line ?? 0) > 0) || (m.kind === "btts" && m.p >= 0.8);

/** Caps in the mixed Top 20, so easy markets can't take over. */
export const TOP_CAPS: { name: string; test: (m: Mkt) => boolean; max: number }[] = [
  { name: "underdog handicap", test: (m) => m.kind === "spread" && (m.line ?? 0) > 0, max: 2 },
  { name: "team totals", test: (m) => m.kind === "team_total", max: 3 },
  { name: "both teams score", test: (m) => m.kind === "btts", max: 2 },
  { name: "no OT / extra innings", test: (m) => m.kind === "ot" && m.side === "no", max: 0 }, // retired, kept so old stored calls can never surface
];
