# Changelog

## 0.6.0 — realistic total lines, Over and Under on every line
- **Main total line** (game total and 1st half / F5 / 1st period): the bookmaker's line when odds are known; otherwise the line a bookmaker would post — the .5 line closest to a 50/50 split (the median, not the league average, which is what made lines look far off).
- **Offered lines, Over and Under on each:** basketball main ±4 / ±8 / ±12 (1st half ±3 / ±6) · baseball main ±1 / ±2 (F5 ±1) · hockey main −1…+2 (1st period ±1). Shown under All markets, in Blend and slips.
- **Strong lines** are now chosen only among those offered lines (no more lines 20+ points away), and team totals work the same way (basketball ±3 / ±6 points, baseball / hockey ±1).
- Top 20 and the best pick use main and strong lines only; the other alternative lines are listed for your own choice.

## 0.5.0 — more leagues, more run lines
- **Alternative run lines (baseball) −4.5 … +4.5 and puck lines (hockey) −3.5 … +3.5**, both sides, on every game (All markets, Blend, slips, Top 20 handicap filter), priced from the same calibrated ladder.
- **WNBA** added to the free basketball source (balldontlie; skipped with a clear message if your balldontlie plan doesn't include it).
- **API-Sports league discovery:** when a sport uses API-Sports, EdgeBoard reads your plan's league list and syncs every available top league with its real current season —
  basketball NBA, WNBA, EuroLeague, EuroCup, ACB, Turkish Super Lig, Lega A, Greek Basket League, LNB, BBL, NBL, CBA, LKL ·
  baseball MLB, NPB, KBO, CPBL, LMB · hockey NHL, KHL, SHL, Liiga, DEL, Czech Extraliga, Swiss National League, AHL.
- Fix: balldontlie free tier (≈5 requests/min) — every request is now spaced and 429s are waited out, so last season's history loads (it was silently skipped, leaving NBA with 0 games).
- Sync reports now say when a previous season could not be loaded instead of skipping silently.

## 0.4.1
- Fix: calibration for live predictions was being fitted from the demo ledger too. It now uses live locked calls from the active source only (identity until 50 settled live calls). The next sync replaces the old maps and re-predicts upcoming games.

## 0.4.0 — free live data
- **Free official sources, chosen per sport in Settings → Data source (default):**
  - Baseball → **MLB Stats API** (no key): current season, innings (F5, 1st inning for NRFI, extras) and **probable pitchers** — games with both starters announced count as "news confirmed", so baseball calls can now reach High confidence.
  - Ice hockey → **NHL API** (no key): current season, OT/shootout, regulation scores; 1st-period scores back-filled from the daily score feed (25 dates per sync).
  - Basketball → **balldontlie** (free key): NBA games with quarter scores (1st half, regulation, OT).
- API-Sports stays available per sport (paid plan: bookmaker odds, more leagues). Value features need odds, so they stay empty on free sources.
- New `npm run sourcecheck` tests each sport's live source on the server.
- Leagues and games from free sources are stored under source `OPEN`; demo and API-Sports data are untouched.

## 0.3.1
- **Blend builder** (Scanners → Blend): pick any market on any game (mixed markets, one per game), see combined probability and fair odds, **Copy blend text**, or get a **Sportybet code** with **Copy code** and Open on Sportybet.
- **Copy to clipboard** on slips: Copy code and Copy text, with a phone-friendly fallback and "Copied" confirmation.

## 0.3.0 — parity with PitchEdge 0.5.x + specials
- **Ledger:** calls lock at start − 15 min (latest call made before then), nothing re-predicted inside the window; results job every 15 min (provider called only when a game should have ended); results appended, corrections appended with `supersedesId`; calibration refit per sport.
- **Accuracy page:** model vs home base rate and bookmaker moneyline (margin removed, before the lock); Brier chart; calibration buckets; confidence bands; every market type's hit rate.
- **Specials (new markets):** team totals (strong lines), winning-margin bands (basketball), overtime / extra innings yes/no, regulation 3-way (hockey), first-segment 3-way (half-time / after 5 innings / 1st period), both teams score (baseball, hockey), NRFI / YRFI (baseball).
- **Best pick per game** (board + game page): never "no overtime", an underdog + handicap, or both-teams-score ≥ 80%. **Best value card** per game.
- **Top 20:** Most likely / Best value switch, market-group filter, All sports, caps (≤ 2 underdog handicaps, ≤ 3 team totals, ≤ 2 both-teams-score, never "no overtime"), locked-only track records with value ROI.
- **Scanners:** Team totals, Specials, Upset watch (underdog moneyline with ≥ 5% edge).
- **Odds:** moneyline prices stored alongside total / handicap / segment lines.
- **Slips:** + on every market, multiple slips per device (mixed sports), drop weakest / drop Low / trim to 25%, split, merge, copy text, experimental Sportybet code.
- **Mobile date bar:** 6-second fallback to a normal page load, neighbour-day preloading, invalid dates → today, empty days link to the next game day.
- **Ops:** 3-hourly sync per sport runs as its own low-priority process (`npm run ingest -- <sport>`); `npm run selfcheck` (+ `-- --demo`).
