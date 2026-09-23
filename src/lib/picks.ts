import type { Prediction } from "@prisma/client";
import type { Ladders } from "./model/common";
import { headlineExcluded, type Mkt } from "./markets";

export interface Pick { market: "win" | "total" | "spread" | "seg"; side: string; line: number | null; p: number; label: string }
export interface Picks { win: Pick; total: Pick; spread: Pick; seg: Pick; strongTotal: Pick | null; strongSpread: Pick | null; strongSeg: Pick | null; best: Pick }
export const picksOf = (p: Prediction) => p.picks as unknown as Picks;

/** Flat market list for a prediction (older rows without one are rebuilt from their picks). */
/** Markets retired from the app: "no overtime / no extra innings", and both-teams-score in baseball. */
const retired = (p: Prediction, m: Mkt) => (m.kind === "ot" && m.side === "no") || (m.kind === "btts" && p.sport === "BASEBALL");

export function marketsOf(p: Prediction): Mkt[] {
  const k = p.picks as unknown as Picks & { markets?: Mkt[] };
  if (k.markets?.length) return k.markets.filter((m) => !retired(p, m));
  const conv = (x: Pick | null, strong = false): Mkt | null => x && ({
    key: `${x.market}:${x.side}:${x.line ?? ""}`, group: x.market === "seg" ? "seg" : x.market, kind: x.market, side: x.side, line: x.line,
    label: x.label, short: x.label, p: x.p, strong, main: !strong,
  } as Mkt);
  return [conv(k.win), conv(k.total), conv(k.spread), conv(k.seg), conv(k.strongTotal, true), conv(k.strongSpread, true), conv(k.strongSeg, true)].filter((x): x is Mkt => !!x);
}
export const laddersOf = (p: Prediction) => p.ladders as unknown as Ladders;

export interface Floors { strong: number; safe: number }
export const DEFAULT_FLOORS: Floors = { strong: 0.65, safe: 0.7 };

export const SCANNERS = [
  { slug: "best", name: "Best line pick", blurb: "The single highest-probability pick at the main line (total, handicap or segment total) for each game." },
  { slug: "win", name: "Win probability", blurb: "Model win probability for the more likely side, including overtime / extra innings." },
  { slug: "total", name: "Overs & unders", blurb: "Over or under at the main line, sorted by probability." },
  { slug: "spread", name: "Handicap", blurb: "Side more likely to cover the main handicap line." },
  { slug: "seg", name: "Segment total", blurb: "Over or under for the first segment at its main line." },
  { slug: "strong-total", name: "Strong total", blurb: "The most aggressive total line the model still rates at or above your strong floor." },
  { slug: "strong-spread", name: "Strong handicap", blurb: "The most points a favourite can give (or the smallest start an underdog needs) while staying at or above your strong floor." },
  { slug: "team", name: "Team totals", blurb: "Strongest team-total line per game (points / runs / goals for one side) at or above your strong floor." },
  { slug: "specials", name: "Specials", blurb: "Best special per game: winning margin, overtime / extra innings, regulation 3-way, first-segment result, both teams score, NRFI." },
  { slug: "upset", name: "Upset watch", blurb: "Underdogs the bookmaker prices longer than the model does (value on the side most people avoid). Needs odds." },
  { slug: "strong-seg", name: "Strong segment total", blurb: "The most aggressive segment total line at or above your strong floor." },
  { slug: "blend", name: "Blend", blurb: "Build your own combination from any market on any game, see the combined probability and fair odds, then copy it or get a Sportybet code." },
  { slug: "safe", name: "Safe", blurb: "High confidence and one pick at or above your safe floor. Not a guarantee." },
] as const;
export type ScannerSlug = (typeof SCANNERS)[number]["slug"];

export function scan(slug: ScannerSlug, p: Prediction, f: Floors): Pick | null {
  const k = picksOf(p);
  switch (slug) {
    case "best": return k.best;
    case "win": return k.win;
    case "total": return k.total;
    case "spread": return k.spread;
    case "seg": return k.seg;
    case "strong-total": return k.strongTotal;
    case "strong-spread": return k.strongSpread;
    case "strong-seg": return k.strongSeg;
    case "team": case "specials": {
      const ms = marketsOf(p).filter((m) => (slug === "team" ? m.kind === "team_total" && m.strong : m.group === "props" && !headlineExcluded(m)));
      const b = ms.sort((x, y) => y.p - x.p)[0];
      return b ? ({ market: "win", side: b.side, line: b.line ?? null, p: b.p, label: b.label } as Pick) : null;
    }
    case "upset": case "blend": return null; // handled on the scanner page
    case "safe": {
      if (p.band !== "HIGH") return null;
      const c = [k.win, k.strongTotal, k.strongSpread, k.strongSeg].filter(Boolean) as Pick[];
      const b = c.sort((x, y) => y.p - x.p)[0];
      return b && b.p >= f.safe ? b : null;
    }
  }
}
