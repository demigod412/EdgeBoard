/**
 * Walk-forward backtest on simulated seasons (no DB). Refit weekly on everything before the week,
 * predict against simulated "book" lines, score each market. Run: npm run backtest
 */
import { predictGame, type Fit } from "../src/lib/model/predict";
import { fitNormal } from "../src/lib/model/normalModel";
import { fitCount } from "../src/lib/model/countModel";
import { simulateSeason } from "../src/lib/demo/simulate";
import type { HistGame } from "../src/lib/model/common";
import { SPORT_IDS, type SportId } from "../src/lib/sports";

type Acc = { n: number; hit: number; sumP: number };
const acc = (): Acc => ({ n: 0, hit: 0, sumP: 0 });
const add = (a: Acc, p: number, hit: boolean | null) => { if (hit == null) return; a.n++; a.sumP += p; if (hit) a.hit++; };
const fmt = (a: Acc) => a.n ? `${String(a.n).padStart(4)} picks  hit ${(100 * a.hit / a.n).toFixed(1).padStart(5)}%  avg p ${(100 * a.sumP / a.n).toFixed(1)}%` : "   0 picks";

for (const sport of SPORT_IDS as SportId[]) {
  const start = Date.UTC(2025, 0, 1);
  const { games } = simulateSeason(sport, 20, start, 330, 99);
  const hist: HistGame[] = games.map((g) => ({ homeId: `t${g.home}`, awayId: `t${g.away}`, date: g.date, homeScore: g.homeScore, awayScore: g.awayScore, homeReg: g.homeReg, awayReg: g.awayReg, homeSeg: g.homeSeg, awaySeg: g.awaySeg, extraTime: g.extraTime }));
  const m = { win: acc(), total: acc(), spread: acc(), seg: acc(), sTotal: acc(), sSpread: acc(), sSeg: acc(), best: acc() };
  let brier = 0, ll = 0, bHome = 0, n = 0;
  const warm = start + 150 * 864e5;
  let fit: Fit | null = null, fitWeek = -1;
  for (let i = 0; i < games.length; i++) {
    const g = games[i]; if (g.date.getTime() < warm) continue;
    const wk = Math.floor(g.date.getTime() / (7 * 864e5));
    if (wk !== fitWeek) { fit = sport === "basketball" ? fitNormal(hist, new Date(wk * 7 * 864e5)) : fitCount(sport, hist, new Date(wk * 7 * 864e5)); fitWeek = wk; }
    const o = predictGame({ sport, fit: fit!, homeId: `t${g.home}`, awayId: `t${g.away}`, homeName: "H", awayName: "A", start: g.date,
      restHomeDays: 2, restAwayDays: 2, newsComplete: true, book: g.book, formHome: "", formAway: "" });
    const hw = g.homeScore > g.awayScore, margin = g.homeScore - g.awayScore, tot = g.homeScore + g.awayScore, seg = g.homeSeg + g.awaySeg;
    brier += 2 * (o.calHomeWin - (hw ? 1 : 0)) ** 2; ll += -Math.log(hw ? o.calHomeWin : 1 - o.calHomeWin);
    const baseRate = 0.55; bHome += 2 * (baseRate - (hw ? 1 : 0)) ** 2; n++;
    const ouHit = (side: string, line: number, v: number) => (v === line ? null : side === "over" ? v > line : v < line);
    const spHit = (side: string, line: number) => { const mm = side === "home" ? margin : -margin; return mm + line === 0 ? null : mm + line > 0; };
    const P = o.picks;
    add(m.win, P.win.p, P.win.side === "home" ? hw : !hw);
    add(m.total, P.total.p, ouHit(P.total.side, P.total.line!, tot));
    add(m.spread, P.spread.p, spHit(P.spread.side, P.spread.line!));
    add(m.seg, P.seg.p, ouHit(P.seg.side, P.seg.line!, seg));
    if (P.strongTotal) add(m.sTotal, P.strongTotal.p, ouHit(P.strongTotal.side, P.strongTotal.line!, tot));
    if (P.strongSpread) add(m.sSpread, P.strongSpread.p, spHit(P.strongSpread.side, P.strongSpread.line!));
    if (P.strongSeg) add(m.sSeg, P.strongSeg.p, ouHit(P.strongSeg.side, P.strongSeg.line!, seg));
    const B = P.best; add(m.best, B.p, B.market === "spread" ? spHit(B.side, B.line!) : ouHit(B.side, B.line!, B.market === "seg" ? seg : tot));
  }
  const S = { basketball: "1H", baseball: "F5", hockey: "P1" }[sport];
  console.log(`\n=== ${sport.toUpperCase()}  (${n} games, walk-forward, lines = simulated book)`);
  console.log(`Win prob    Brier ${(brier / n).toFixed(4)} (always-home ${(bHome / n).toFixed(4)})  log loss ${(ll / n).toFixed(4)}`);
  console.log(`Win pick         ${fmt(m.win)}`);
  console.log(`Total @ book     ${fmt(m.total)}`);
  console.log(`Handicap @ book  ${fmt(m.spread)}`);
  console.log(`${S} total @ book  ${fmt(m.seg)}`);
  console.log(`Strong total     ${fmt(m.sTotal)}`);
  console.log(`Strong handicap  ${fmt(m.sSpread)}`);
  console.log(`Strong ${S} total  ${fmt(m.sSeg)}`);
  console.log(`Best pick        ${fmt(m.best)}`);
}
