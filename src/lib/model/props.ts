/*
 * Extra markets ("specials") derived from the same model that prices win / total / handicap:
 *   team totals · winning margin bands · overtime / extra innings · regulation 3-way (hockey)
 *   first-segment 3-way (1st half / F5 / P1) · both teams score · no run in the 1st inning (NRFI, baseball)
 * They are not calibrated yet (raw model probabilities), which the UI says.
 */
import { normCdf } from "./common";
import { pmf, type CountFit, type CountOut } from "./countModel";
import type { NormalFit, NormalOut } from "./normalModel";
import type { Mkt } from "../markets";
import { SPORTS, type SportId } from "../sports";

const key = (m: Omit<Mkt, "key">) => `${m.kind}:${m.side}:${m.line ?? ""}${m.lo != null ? `:${m.lo}-${m.hi}` : ""}`;
export const mk = (m: Omit<Mkt, "key">): Mkt => ({ ...m, key: key(m) });

/**
 * Team totals: lines at the team's expected score (nearest .5) plus the sport's offsets, Over and Under on each.
 * The "strong" line is the most aggressive offered line on the lean side still at/above the floor.
 */
function teamTotals(team: "home" | "away", name: string, mu: number, over: (l: number) => number, lean: "over" | "under", floor: number, unit: string, offs: number[]): Mkt[] {
  const main = Math.max(0.5, Math.round(mu - 0.5) + 0.5);
  const rows = offs.map((o) => main + o).filter((l) => l > 0).map((l) => ({ l, o: over(l) }));
  const strong = lean === "over" ? rows.filter((x) => x.o >= floor).sort((a, b) => b.l - a.l)[0] : rows.filter((x) => 1 - x.o >= floor).sort((a, b) => a.l - b.l)[0];
  return rows.flatMap((r) => (["over", "under"] as const).map((dir) => mk({
    group: "team", kind: "team_total", side: `${team}:${dir}`, line: r.l, label: `${name} ${dir === "over" ? "Over" : "Under"} ${r.l} ${unit}`, short: `${name} ${dir === "over" ? "O" : "U"}${r.l}`,
    p: dir === "over" ? r.o : 1 - r.o, ...(r.l === main ? { main: true } : { alt: true }), ...(strong && strong.l === r.l && dir === lean ? { strong: true } : {}),
  })));
}

export function propsNormal(fit: NormalFit, out: NormalOut, H: string, A: string, floor: number): Mkt[] {
  const res: Mkt[] = [];
  const sTeam = Math.sqrt(out.sigmaT ** 2 + out.sigmaM ** 2) / 2;
  for (const [team, mu, name] of [["home", out.muH, H], ["away", out.muA, A]] as const) {
    res.push(...teamTotals(team, name, mu, (l) => 1 - normCdf((l - mu) / sTeam), mu >= fit.mu ? "over" : "under", floor, "pts", SPORTS.basketball.teamAlt));
  }
  const mM = out.muH - out.muA, sM = out.sigmaM;
  const favHome = out.homeWin >= 0.5, d = favHome ? mM : -mM, fav = favHome ? "home" : "away", fn = favHome ? H : A;
  for (const [lo, hi] of [[1, 5], [6, 10], [11, 99]] as const) {
    const p = (hi >= 99 ? 1 : normCdf((hi + 0.5 - d) / sM)) - normCdf((lo - 0.5 - d) / sM);
    res.push(mk({ group: "props", kind: "margin", side: fav, lo, hi, label: `${fn} to win by ${hi >= 99 ? `${lo}+` : `${lo}–${hi}`}`, short: `${fn} by ${hi >= 99 ? `${lo}+` : `${lo}-${hi}`}`, p }));
  }
  const ot = normCdf((0.5 - mM) / sM) - normCdf((-0.5 - mM) / sM);
  res.push(mk({ group: "props", kind: "ot", side: "yes", label: "Overtime: yes", short: "OT yes", p: ot }));
  const sm = mM * fit.segShare, ss = sM * Math.max(0.55, fit.segSigmaRatio);
  const h1 = 1 - normCdf((0.5 - sm) / ss), a1 = normCdf((-0.5 - sm) / ss);
  res.push(mk({ group: "props", kind: "seg3", side: "home", label: `${H} lead at half-time`, short: `1H ${H}`, p: h1 }));
  res.push(mk({ group: "props", kind: "seg3", side: "draw", label: "Level at half-time", short: "1H draw", p: Math.max(0, 1 - h1 - a1) }));
  res.push(mk({ group: "props", kind: "seg3", side: "away", label: `${A} lead at half-time`, short: `1H ${A}`, p: a1 }));
  return res;
}

export function propsCount(sport: SportId, fit: CountFit, out: CountOut, H: string, A: string, floor: number): Mkt[] {
  const res: Mkt[] = [];
  const unit = sport === "baseball" ? "runs" : "goals";
  // team marginals and BTTS from the final joint distribution
  const ph = new Map<number, number>(), pa = new Map<number, number>(); let btts = 0;
  out.final.forEach((p, k) => { const [h, a] = k.split(",").map(Number); ph.set(h, (ph.get(h) ?? 0) + p); pa.set(a, (pa.get(a) ?? 0) + p); if (h > 0 && a > 0) btts += p; });
  const overOf = (mp: Map<number, number>) => (l: number) => [...mp].reduce((s, [k, p]) => s + (k > l ? p : 0), 0);
  const leagueSide = fit.base * (1 + fit.home) / 2;
  for (const [team, mp, mu, name] of [["home", ph, out.muH, H], ["away", pa, out.muA, A]] as const) {
    res.push(...teamTotals(team, name, mu, overOf(mp), mu >= leagueSide ? "over" : "under", floor, unit, SPORTS[sport].teamAlt));
  }
  // Baseball: both teams scoring a run happens in ~85% of games — not a useful market, so it isn't offered.
  if (sport !== "baseball") {
    res.push(mk({ group: "props", kind: "btts", side: "yes", label: "Both teams to score", short: "BTTS yes", p: btts }));
    res.push(mk({ group: "props", kind: "btts", side: "no", label: "Both teams to score: No", short: "BTTS no", p: 1 - btts }));
  }
  const m = out.regMatrix;
  let rh = 0, rd = 0, ra = 0; m.forEach((row, i) => row.forEach((p, j) => { if (i > j) rh += p; else if (i === j) rd += p; else ra += p; }));
  // Only the "yes" side: "no overtime / no extra innings" is near-certain and was never a tip worth showing.
  const otName = sport === "baseball" ? "Extra innings" : "Overtime / shootout";
  res.push(mk({ group: "props", kind: "ot", side: "yes", label: `${otName}: yes`, short: sport === "baseball" ? "Extras yes" : "OT yes", p: rd }));
  if (sport === "hockey") {
    res.push(mk({ group: "props", kind: "reg3", side: "home", label: `${H} win in regulation (60 min)`, short: `60' ${H}`, p: rh }));
    res.push(mk({ group: "props", kind: "reg3", side: "draw", label: "Draw after 60 minutes", short: "60' draw", p: rd }));
    res.push(mk({ group: "props", kind: "reg3", side: "away", label: `${A} win in regulation (60 min)`, short: `60' ${A}`, p: ra }));
  }
  let sh = 0, sd = 0, sa = 0; out.segMatrix.forEach((row, i) => row.forEach((p, j) => { if (i > j) sh += p; else if (i === j) sd += p; else sa += p; }));
  const seg = sport === "baseball" ? "F5" : "P1";
  res.push(mk({ group: "props", kind: "seg3", side: "home", label: `${H} lead after ${sport === "baseball" ? "5 innings" : "1st period"}`, short: `${seg} ${H}`, p: sh }));
  res.push(mk({ group: "props", kind: "seg3", side: "draw", label: `Level after ${sport === "baseball" ? "5 innings" : "1st period"}`, short: `${seg} draw`, p: sd }));
  res.push(mk({ group: "props", kind: "seg3", side: "away", label: `${A} lead after ${sport === "baseball" ? "5 innings" : "1st period"}`, short: `${seg} ${A}`, p: sa }));
  if (sport === "baseball") {
    // 1st inning ≈ one fifth of the F5 scoring rate per team (not separately fitted yet)
    const inn = (mu: number) => pmf(0, mu * fit.segShare / 5, fit.dispersion == null ? null : fit.dispersion * fit.segShare / 5);
    const nr = inn(out.muH) * inn(out.muA);
    res.push(mk({ group: "props", kind: "nrfi", side: "no_run", label: "No run in the 1st inning (NRFI)", short: "NRFI", p: nr }));
    res.push(mk({ group: "props", kind: "nrfi", side: "run", label: "A run in the 1st inning (YRFI)", short: "YRFI", p: 1 - nr }));
  }
  return res;
}
