import { Card, SectionTitle } from "@/components/ui";
import { MODEL_VERSION } from "@/lib/model/constants";
export const metadata = { title: "Methodology" };
const F = ({ children }: { children: React.ReactNode }) => <pre className="num my-2 overflow-x-auto rounded-lg bg-black/30 p-3 text-[12px] leading-relaxed text-slate-200">{children}</pre>;
export default function Methodology() {
  return (
    <div className="max-w-3xl space-y-4 text-sm leading-relaxed text-slate-300">
      <header><h1 className="text-2xl font-semibold tracking-tight text-slate-50">How the numbers are made</h1>
        <p className="mt-1 text-slate-400">Model <span className="num text-edge">{MODEL_VERSION}</span>. One model per sport, same output for every user. Language models never produce numbers.</p></header>
      <Card><SectionTitle>Basketball: normal points model</SectionTitle>
        <F>{`home pts = μ + h/2 + o_H + d_A      away pts = μ − h/2 + o_A + d_H
o = offence, d = points allowed (both vs league average), ridge 4 pseudo-games, half-life 60 days
margin ~ N(μ_H − μ_A, σ_M²)      total ~ N(μ_H + μ_A, σ_T²)       σ fitted from residuals × 1.06
win = Φ(margin / σ_M)     cover(L) = P(margin + L > 0)     over(T) = P(total > T)
1st half: μ_1H = share · μ (share fitted from half-time scores, default 0.505), σ_1H = ratio · σ_T
back-to-back: −1 point, only when rest days are known`}</F></Card>
      <Card><SectionTitle>Baseball and ice hockey: count model</SectionTitle>
        <F>{`E[home] = c · a_H · d_A · γ      E[away] = c · a_A · d_H       (fitted on regulation scoring)
baseball runs: negative binomial, Var = μ + μ²/r, r fitted by moments
hockey goals: Poisson; empty-net share e of 1-goal wins become 2-goal wins (fitted after 150 games)
tie after regulation → hockey: winner +1 (OT/shootout), home share fitted, default 50%
                      baseball: winner by 1, total + 1 + 2Y, Y ~ Poisson(λx), home share default 52%
First 5 innings / 1st period: each side scores share · E[·] (defaults 0.556 / 0.31, fitted when data exists)`}</F>
        <p>Run line and puck line default to ±1.5. Ties in the first 5 innings or 1st period are pushes for whole-number lines and losses for both sides on .5 lines.</p></Card>
      <Card><SectionTitle>Main lines, strong lines, best pick</SectionTitle>
        <p>Main line: the bookmaker line when one is fetched, otherwise a reference line (league-average total; ±1.5 or the fair spread for handicaps). Reference lines are labelled on every game.</p>
        <p className="mt-2">Strong line: on the side the model leans, the most aggressive line whose probability is still at or above the strong floor (default 65%). Easier lines always have higher probability, so strong picks are about confidence in direction, not value.</p>
        <p className="mt-2">Best pick: the highest-probability main-line pick among total, handicap and first-segment total.</p></Card>
      <Card><SectionTitle>Calibration, confidence, ledger</SectionTitle>
        <F>{`calibration per sport and market (win, total, handicap, segment total):
  n < 50 identity · 50–199 shrunk buckets · 200+ isotonic
confidence = 100 − sample (≤30) − 15 if team news unconfirmed − 20·volatility − calibration residual
High needs ≥ 70, enough games, a 10-point win margin and confirmed news. Low never shows 90%+.`}</F>
        <p>Calls lock 15 minutes before start and are scored after the final. Nothing is edited or deleted. API-Sports does not supply confirmed lineups, probable pitchers or starting goalies, so live calls top out at Medium until a news source is added.</p></Card>
      <Card><SectionTitle>Specials</SectionTitle>
        <F>{`basketball: team totals (strong line) · winning margin 1–5 / 6–10 / 11+ · overtime yes/no · half-time 3-way
baseball:   team totals · both teams score a run · extra innings yes/no · after-5-innings 3-way · NRFI / YRFI
hockey:     team totals · both teams to score · overtime/shootout yes/no · regulation (60 min) 3-way · 1st-period 3-way
all from the same model: normal margin/total for basketball; the final-score joint distribution (after OT / extras) for baseball and hockey
NRFI: first inning ≈ one fifth of each team's F5 scoring rate (not separately fitted yet)`}</F>
        <p>Specials are raw model probabilities (not yet calibrated); the Accuracy page tracks each one.</p></Card>
      <Card><SectionTitle>Best pick, Top 20, value</SectionTitle>
        <F>{`best pick (game page, board): strongest market ≥ 55%, never "no overtime", an underdog + handicap, or both-teams-score ≥ 80%
Top 20 mixed list: one tip per game · ≤ 2 underdog handicaps · ≤ 3 team totals · ≤ 2 both-teams-score · never "no overtime"
value: edge = p × odds − 1 at the SAME line as the bookmaker (moneyline, total, handicap, segment total)
       Medium/High, p ≥ 35%, odds 1.40–6.00, edge ≥ 3% · upset watch: underdog moneyline with edge ≥ 5%`}</F></Card>
      <Card><SectionTitle>Ledger</SectionTitle>
        <p>Every call locks at start − 15 minutes (the latest prediction made before then) and is never edited; nothing is re-predicted inside the window. Results are appended after the final, corrections appended too. Accuracy compares the model with the home base rate and the bookmaker&apos;s moneyline (margin removed). Jobs: full sync every 3 h per sport (separate process), lock every 5 min, results every 15 min.</p></Card>
    </div>
  );
}
