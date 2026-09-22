import { MODEL_VERSION, LOW_BAND_DISPLAY_CAP } from "./constants";
import { apply, IDENTITY, type Calibrator } from "./calibration";
import { clamp, type LadderRow, type Ladders } from "./common";
import { fitNormal, normalLadders, predictNormal, type NormalFit } from "./normalModel";
import { countLadders, predictCount, type CountFit } from "./countModel";
import { inputsHash } from "./hash";
import { SPORTS, type SportId } from "../sports";
import { mk, propsCount, propsNormal } from "./props";
import type { Mkt } from "../markets";

export type Fit = NormalFit | CountFit;
export interface Calibrators { win: Calibrator; total: Calibrator; spread: Calibrator; seg: Calibrator }
export const IDENTITY_CAL: Calibrators = { win: IDENTITY, total: IDENTITY, spread: IDENTITY, seg: IDENTITY };
export type Band = "HIGH" | "MEDIUM" | "LOW";

export interface PredictInput {
  sport: SportId; fit: Fit;
  homeId: string; awayId: string; homeName: string; awayName: string; start: Date;
  restHomeDays: number | null; restAwayDays: number | null;
  newsComplete: boolean;               // lineups (bb) / probable pitchers (mlb) / starting goalies (nhl) confirmed
  book: { total?: number; spread?: number; seg?: number };
  cal?: Calibrators; calResidual?: number; strongFloor?: number;
  formHome: string; formAway: string;
}

export interface Pick { market: "win" | "total" | "spread" | "seg"; side: string; line: number | null; p: number; label: string }

export interface PredictOutput {
  modelVersion: typeof MODEL_VERSION; inputsHash: string;
  muHome: number; muAway: number; muSegHome: number; muSegAway: number;
  rawHomeWin: number; calHomeWin: number;
  fairTotal: number; fairSpread: number; fairSegTotal: number;
  totalLine: number; spreadLine: number; segLine: number; lineSource: "book" | "reference";
  rawOver: number; calOver: number; rawHomeCover: number; calHomeCover: number; rawSegOver: number; calSegOver: number;
  pushTotal: number; pushSpread: number; pushSeg: number;
  ladders: Ladders;
  picks: { win: Pick; total: Pick; spread: Pick; seg: Pick; strongTotal: Pick | null; strongSpread: Pick | null; strongSeg: Pick | null; best: Pick; markets: Mkt[] };
  confidence: number; band: Band; dataFlags: string[]; rationale: string[]; features: Record<string, unknown>;
}

const half = (x: number) => Math.floor(x) + 0.5;
const fmtLine = (l: number) => (l > 0 ? `+${l}` : `${l}`);

export function predictGame(inp: PredictInput): PredictOutput {
  const cfg = SPORTS[inp.sport];
  const cal = inp.cal ?? IDENTITY_CAL;
  const flags: string[] = [];
  if (!inp.newsComplete) flags.push(inp.sport === "basketball" ? "missing_lineups" : inp.sport === "baseball" ? "missing_pitchers" : "missing_goalies");
  if (!inp.fit.teams.has(inp.homeId)) flags.push("new_team_home");
  if (!inp.fit.teams.has(inp.awayId)) flags.push("new_team_away");

  // Engine
  let out, lad: Ladders, leagueTotal: number;
  if (inp.fit.kind === "normal") {
    const b2b = (d: number | null) => (d != null && d <= 1 ? -1.0 : 0); // back-to-back: −1 point (applied only when rest is known)
    if (inp.restHomeDays == null || inp.restAwayDays == null) flags.push("missing_rest");
    out = predictNormal(inp.fit, inp.homeId, inp.awayId, { restHome: b2b(inp.restHomeDays), restAway: b2b(inp.restAwayDays) });
    lad = normalLadders(out, { width: cfg.ladderWidth });
    leagueTotal = 2 * inp.fit.mu;
  } else {
    out = predictCount(inp.fit, inp.homeId, inp.awayId, { phiHome: 1, phiAway: 1 });
    lad = countLadders(out, { width: cfg.ladderWidth, handicaps: cfg.fixedHandicaps ?? [-1.5, 1.5], alt: cfg.altHandicaps });
    leagueTotal = 2 * inp.fit.base * (1 + inp.fit.home) / 2;
    if (inp.fit.sport === "hockey" && inp.fit.enTransfer === 0) flags.push("no_empty_net_adjustment");
  }

  // Main lines: bookmaker if known, otherwise reference lines (league-average total; fair / ±1.5 handicap).
  const haveBook = inp.book.total != null || inp.book.spread != null || inp.book.seg != null;
  if (!haveBook) flags.push("no_book_lines");
  const segShare = inp.fit.kind === "normal" ? inp.fit.segShare : inp.fit.segShare;
  const totalLine = inp.book.total ?? half(leagueTotal);
  const segLine = inp.book.seg ?? half(leagueTotal * segShare);
  const favHome = out.homeWin >= 0.5;
  const spreadLine = inp.book.spread ?? (cfg.fixedHandicaps ? (favHome ? -1.5 : 1.5) : half(out.fairSpread));

  // Calibrate (per market) and apply the Low-band display cap later.
  const cWin = apply(cal.win, out.homeWin);
  const t = out.totalAt(totalLine), s = out.coverAt(spreadLine), g = out.segAt(segLine);
  const calLad = (rows: LadderRow[], c: Calibrator) => rows.map((r) => ({ ...r, a: apply(c, r.a) }));
  const ladders: Ladders = { total: calLad(lad.total, cal.total), spread: calLad(lad.spread, cal.spread), seg: calLad(lad.seg, cal.seg) };
  let calOver = apply(cal.total, t.a), calCover = apply(cal.spread, s.a), calSeg = apply(cal.seg, g.a);

  // Confidence
  const target = inp.sport === "basketball" ? 10 : inp.sport === "baseball" ? 15 : 12;
  const sw = (id: string) => inp.fit.teams.get(id)?.sampleWeight ?? 0;
  const sample = Math.min(sw(inp.homeId), sw(inp.awayId));
  if (sample < target * 0.6) flags.push("thin_sample");
  let score = 100 - 30 * Math.max(0, 1 - Math.min(1, sample / target)) - (inp.newsComplete ? 0 : 15) - 20 * inp.fit.volatility - Math.min(15, 100 * (inp.calResidual ?? 0));
  score = Math.round(clamp(score, 0, 100));
  const highOk = score >= 70 && sample >= target * 0.8 && Math.abs(cWin - 0.5) >= 0.1 && inp.newsComplete;
  const band: Band = highOk ? "HIGH" : score >= 45 ? "MEDIUM" : "LOW";
  if (!highOk && score >= 70) score = 69;

  let calWin = cWin;
  if (band === "LOW") {
    const lo = 1 - LOW_BAND_DISPLAY_CAP, hi = LOW_BAND_DISPLAY_CAP;
    const cap = (x: number) => clamp(x, lo, hi);
    if (calWin !== cap(calWin) || calOver !== cap(calOver) || calCover !== cap(calCover) || calSeg !== cap(calSeg)) flags.push("low_band_capped");
    calWin = cap(calWin); calOver = cap(calOver); calCover = cap(calCover); calSeg = cap(calSeg);
    for (const k of ["total", "spread", "seg"] as const) ladders[k] = ladders[k].map((r) => ({ ...r, a: cap(r.a) }));
  }

  // Picks
  const H = inp.homeName, A = inp.awayName, U = cfg.segmentShort;
  const win: Pick = calWin >= 0.5 ? { market: "win", side: "home", line: null, p: calWin, label: `${H} to win` } : { market: "win", side: "away", line: null, p: 1 - calWin, label: `${A} to win` };
  const ou = (market: "total" | "seg", pOver: number, push: number, line: number, prefix: string): Pick =>
    pOver >= (1 - push) / 2 ? { market, side: "over", line, p: pOver, label: `${prefix}Over ${line}` } : { market, side: "under", line, p: 1 - pOver - push, label: `${prefix}Under ${line}` };
  const total = ou("total", calOver, t.push, totalLine, "");
  const seg = ou("seg", calSeg, g.push, segLine, `${U} `);
  const spread: Pick = calCover >= (1 - s.push) / 2
    ? { market: "spread", side: "home", line: spreadLine, p: calCover, label: `${H} ${fmtLine(spreadLine)}` }
    : { market: "spread", side: "away", line: -spreadLine, p: 1 - calCover - s.push, label: `${A} ${fmtLine(-spreadLine)}` };

  const floor = inp.strongFloor ?? 0.65;
  const strongOU = (market: "total" | "seg", rows: LadderRow[], lean: "over" | "under", prefix: string): Pick | null => {
    if (lean === "over") { const r = rows.filter((x) => x.a >= floor).sort((x, y) => y.line - x.line)[0]; return r ? { market, side: "over", line: r.line, p: r.a, label: `${prefix}Over ${r.line}` } : null; }
    const r = rows.filter((x) => 1 - x.a - x.push >= floor).sort((x, y) => x.line - y.line)[0];
    return r ? { market, side: "under", line: r.line, p: 1 - r.a - r.push, label: `${prefix}Under ${r.line}` } : null;
  };
  const strongTotal = strongOU("total", ladders.total, out.fairTotal >= totalLine ? "over" : "under", "");
  const strongSeg = strongOU("seg", ladders.seg, out.fairSeg >= segLine ? "over" : "under", `${U} `);
  // Handicap: the most points the favourite can give while still ≥ floor; else the smallest start the underdog needs.
  const fav = favHome ? "home" : "away";
  const cover = (r: LadderRow, side: "home" | "away") => (side === "home" ? r.a : 1 - r.a - r.push);
  const lineFor = (r: LadderRow, side: "home" | "away") => (side === "home" ? r.line : -r.line);
  const nm = (side: "home" | "away") => (side === "home" ? H : A);
  let strongSpread: Pick | null = null;
  for (const side of [fav, fav === "home" ? "away" : "home"] as const) {
    const ok = ladders.spread.filter((r) => cover(r, side) >= floor).sort((x, y) => lineFor(x, side) - lineFor(y, side));
    if (ok.length) { const r = ok[0]; strongSpread = { market: "spread", side, line: lineFor(r, side), p: cover(r, side), label: `${nm(side)} ${fmtLine(lineFor(r, side))}` }; break; }
  }
  const best = [total, spread, seg].sort((x, y) => y.p - x.p)[0];

  // ---- One flat market list (main lines, strong lines, specials) ----
  const capLowP = (x: number) => (band === "LOW" ? clamp(x, 1 - LOW_BAND_DISPLAY_CAP, LOW_BAND_DISPLAY_CAP) : x);
  const segName = cfg.segmentName;
  const markets: Mkt[] = [
    mk({ group: "win", kind: "win", side: "home", label: `${H} to win`, short: `${H} win`, p: calWin, main: true }),
    mk({ group: "win", kind: "win", side: "away", label: `${A} to win`, short: `${A} win`, p: 1 - calWin, main: true }),
    mk({ group: "total", kind: "total", side: "over", line: totalLine, label: `Over ${totalLine}`, short: `O${totalLine}`, p: calOver, main: true }),
    mk({ group: "total", kind: "total", side: "under", line: totalLine, label: `Under ${totalLine}`, short: `U${totalLine}`, p: 1 - calOver - t.push, main: true }),
    mk({ group: "spread", kind: "spread", side: "home", line: spreadLine, label: `${H} ${fmtLine(spreadLine)}`, short: `${H} ${fmtLine(spreadLine)}`, p: calCover, main: true }),
    mk({ group: "spread", kind: "spread", side: "away", line: -spreadLine, label: `${A} ${fmtLine(-spreadLine)}`, short: `${A} ${fmtLine(-spreadLine)}`, p: 1 - calCover - s.push, main: true }),
    mk({ group: "seg", kind: "seg", side: "over", line: segLine, label: `${segName} Over ${segLine}`, short: `${U} O${segLine}`, p: calSeg, main: true }),
    mk({ group: "seg", kind: "seg", side: "under", line: segLine, label: `${segName} Under ${segLine}`, short: `${U} U${segLine}`, p: 1 - calSeg - g.push, main: true }),
  ];
  const fromStrong = (pk: Pick | null) => pk && mk({ group: pk.market === "seg" ? "seg" : pk.market === "total" ? "total" : "spread", kind: pk.market === "seg" ? "seg" : pk.market === "total" ? "total" : "spread",
    side: pk.side, line: pk.line, label: pk.market === "seg" ? pk.label.replace(`${U} `, `${segName} `) : pk.label, short: pk.label, p: pk.p, strong: true });
  for (const x of [fromStrong(strongTotal), fromStrong(strongSpread), fromStrong(strongSeg)]) if (x && !markets.some((m) => m.key === x.key)) markets.push(x);
  // Alternative run / puck lines (both sides of every line), priced from the same calibrated ladder
  if (cfg.altHandicaps) for (const r of ladders.spread) {
    if (!cfg.altHandicaps.includes(r.line)) continue;
    for (const side of ["home", "away"] as const) {
      const line = side === "home" ? r.line : -r.line, p = side === "home" ? r.a : 1 - r.a - r.push;
      const x = mk({ group: "spread", kind: "spread", side, line, label: `${side === "home" ? H : A} ${fmtLine(line)}`, short: `${side === "home" ? H : A} ${fmtLine(line)}`, p });
      if (!markets.some((m) => m.key === x.key)) markets.push(x);
    }
  }
  const specials = inp.fit.kind === "normal" ? propsNormal(inp.fit, out as ReturnType<typeof predictNormal>, H, A, floor)
    : propsCount(inp.sport, inp.fit, out as ReturnType<typeof predictCount>, H, A, floor);
  for (const x of specials) markets.push({ ...x, p: capLowP(x.p) });

  const features = {
    sport: inp.sport, sample, newsComplete: inp.newsComplete, restHomeDays: inp.restHomeDays, restAwayDays: inp.restAwayDays,
    fit: inp.fit.kind === "normal"
      ? { mu: inp.fit.mu, home: inp.fit.home, sigmaM: inp.fit.sigmaM, sigmaT: inp.fit.sigmaT, segShare: inp.fit.segShare, n: inp.fit.n }
      : { base: inp.fit.base, home: inp.fit.home, dispersion: inp.fit.dispersion, segShare: inp.fit.segShare, tieHomeWin: inp.fit.tieHomeWin, extraRate: inp.fit.extraRate, enTransfer: inp.fit.enTransfer, n: inp.fit.n },
    home: inp.fit.teams.get(inp.homeId) ?? null, away: inp.fit.teams.get(inp.awayId) ?? null,
    book: inp.book, formHome: inp.formHome, formAway: inp.formAway,
  };
  const rationale = buildRationale(inp, out, cfg.unit, cfg.segmentName, { totalLine, lineSource: haveBook ? "book" : "reference", calWin, flags });

  return {
    modelVersion: MODEL_VERSION,
    inputsHash: inputsHash({ h: inp.homeId, a: inp.awayId, start: inp.start.toISOString(), features, calN: cal.win.n }),
    muHome: out.muH, muAway: out.muA, muSegHome: out.muSegH, muSegAway: out.muSegA,
    rawHomeWin: out.homeWin, calHomeWin: calWin,
    fairTotal: out.fairTotal, fairSpread: out.fairSpread, fairSegTotal: out.fairSeg,
    totalLine, spreadLine, segLine, lineSource: haveBook ? "book" : "reference",
    rawOver: t.a, calOver, rawHomeCover: s.a, calHomeCover: calCover, rawSegOver: g.a, calSegOver: calSeg,
    pushTotal: t.push, pushSpread: s.push, pushSeg: g.push,
    ladders, picks: { win, total, spread, seg, strongTotal, strongSpread, strongSeg, best, markets },
    confidence: score, band, dataFlags: flags, rationale, features,
  };
}

function buildRationale(inp: PredictInput, o: { muH: number; muA: number; muSegH: number; muSegA: number; fairTotal: number }, unit: string, segName: string,
  x: { totalLine: number; lineSource: string; calWin: number; flags: string[] }): string[] {
  const f1 = (v: number) => v.toFixed(1), pc = (p: number) => `${Math.round(p * 100)}%`;
  const fit = inp.fit;
  const b1 = fit.kind === "normal"
    ? `${inp.homeName} project ${f1(o.muH)} ${unit}, ${inp.awayName} ${f1(o.muA)}, from recency-weighted offence and defence ratings (home edge ${f1(fit.home)}).`
    : `${inp.homeName} project ${f1(o.muH)} ${unit}, ${inp.awayName} ${f1(o.muA)}, from attack × defence ratings (home factor ${fit.home.toFixed(2)}).`;
  const b2 = `Win probability ${pc(x.calWin)} for ${inp.homeName}${fit.kind === "count" ? `; tied regulation games are resolved with a ${pc(fit.tieHomeWin)} home share` : ""}.`;
  const b3 = `Projected total ${f1(o.muH + o.muA)} against the ${x.lineSource === "book" ? "bookmaker" : "league reference"} line ${x.totalLine}; ${segName} projects ${f1(o.muSegH + o.muSegA)}.`;
  const b4 = `Last 5: ${inp.homeName} ${inp.formHome || "n/a"}, ${inp.awayName} ${inp.formAway || "n/a"}.` +
    (x.flags.some((f) => f.startsWith("missing_")) ? ` ${inp.sport === "baseball" ? "Probable pitchers" : inp.sport === "hockey" ? "Starting goalies" : "Lineups"} not confirmed, so confidence is reduced.` : "");
  return [b1, b2, b3, b4];
}

export { fitNormal };
