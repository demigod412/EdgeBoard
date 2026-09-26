# Changelog

## 0.10.2 — markets earn their place; a loading bar
- **Legs are now weighted by how well each market has actually delivered.** `Candidate.trust` existed,
  was used in the ranking and was **never once set** — always 1, so the field did nothing. The ledger
  already records each market type's realised hit rate against the average probability the model put on
  it, so that ratio now becomes the weighting: a strong total landing 71% on calls that claimed 78% runs
  at 0.91 and gets ranked behind a market that keeps its promises.
  Guarded against chasing noise: under 25 settled calls a market is ignored entirely, the ratio is
  shrunk toward neutral by sample size (half weight at 60 calls), and clamped to 0.75–1.08 — a market
  can be marked down hard but never promoted much, because being lucky is not being good. Computed over
  six months during each sport's sync and stored per sport, so the builder reads one small row rather
  than re-reading the ledger every time you change the target. Keyed by the same market label the
  accuracy page's hit table uses, so the two can never disagree about what a market is.
- **New Confidence control: Medium and High, or High only.**
- **A loading bar across the top of the app whenever a page is loading.** `loading.tsx` only covers a
  move to a different route, and most waiting here is the *same* route with different search params —
  the Upcoming/Live/Finished tab, the date, a league, a market view, the builder's target. Every page is
  rendered against the database, so those took a second or two with nothing on screen, which reads as
  the app having hung. Clicks are caught app-wide from one place rather than by wrapping every link, it
  clears when the page actually changes, and it times out so a cancelled navigation cannot leave it
  stuck on. Respects `prefers-reduced-motion`.

## 0.10.1 — the builder was choosing the LEAST likely legs; even leg prices
- **Fix: "Safest" systematically preferred the less likely of two equally priced legs.** The candidate
  ranking divided log(p) by *minus* the price, which inverts it: both terms are negative, so the score
  fell as probability rose. Worse, equally priced candidates share a price bucket and only one survives
  the pool cut, so the better leg was thrown away before the search ever saw it. Given a choice between
  p=0.82 and p=0.66 at the same 1.30, the builder returned five legs of 0.66 — a **12.5%** slip where
  **37.1%** was available on the same games at the same price. It now divides by the price, so the
  metric rises with probability. Tested both directions.
  (Reaching a target is a knapsack: maximise the sum of log(p) subject to the sum of log(odds) clearing
  log(target), which makes log(p) per unit of log(odds) the right greedy ratio. With fair odds it is
  −1 for every leg — correct, not broken: every leg is then equally efficient and the target alone
  sets the chance.)
- **Legs are now kept to a similar price.** 19.00 over 12 legs gives twelve legs of 19^(1/12) = **1.28
  each**, not a 1.60 beside a 1.03. Evenness is measured on each leg's share of the price rather than
  on the odds: at a 1.28 ideal, a "within 25%" band on the odds runs from 1.02 to 1.60 and lets a 1.03
  through, though it carries 0.03 of the price where an equal share is 0.25.
- **New controls: Min legs and Leg prices (Even / Any mix).** A minimum leg count spreads the same
  price over more, shorter picks; Even is the default. Min legs offers every step up to whatever Max
  legs is set to, so a 12-leg target is actually reachable.
- Each combination shows **legs average** and, where they differ, the **range**.
- Also: partial slips already at the leg limit are no longer carried forward in the search, since they
  can never be extended.

## 0.10.0 — Upcoming / Live / Finished on every board
- **Three tabs on each sport's board**, with a count on each: **Upcoming** (not started — the default,
  since the board's job is the games you can still bet on), **Live** (being played now, with a pulsing
  dot) and **Finished** (played). The date strip, league filter and market view all still apply, and the
  tab is carried in the URL (`?show=live`) so a link keeps it.
- **A tab cannot rely on the stored status, so it does not.** A provider status of LIVE is only written
  when a job happens to run while the game is in progress, and a full sync runs every three hours — so
  a 19:00 tip-off usually still reads SCHEDULED until 22:00, long after it ended. A Live tab on the raw
  status would sit empty through most of a game night. Start time decides for anything still SCHEDULED,
  **using each sport's own length**: basketball 150 minutes, hockey 160, baseball 200. At 170 minutes in,
  a ball game is very likely still going while the basketball finished an hour ago — one number for all
  three would be wrong for two of them. A game the provider *has* reported as LIVE gets an extra hour
  before that flag is treated as stale, so multiple overtimes are not filed as finished mid-game.
- Those per-sport lengths now live in the sport config and are shared with the results job, which had
  the same three numbers written inline — they can no longer drift apart.
- **A row shows a score whenever one exists**, not only once a game is marked final, so a game caught in
  progress shows its running score. Finished games read `Final` (with `(OT)`, `(OT/SO)` or `(extras)` as
  before); one that has been played but whose score has not arrived reads `result pending`.
- **Postponed and cancelled games appear in no tab** — not played, not bettable — but are counted in a
  line under the tabs rather than disappearing silently. Empty states name what the date *does* have and
  link straight to that tab.

## 0.9.5 — readable sync report
- The sync report keys leagues by **"Israel · Super League"** rather than "Super League #51". Provider
  ids disambiguated the clashes in 0.9.2 because leagues did not carry a country yet; they do now, and
  the country settles almost every case. The id remains as a last resort.

## 0.9.4 — WNBA confirmed, G League picked up
- **WNBA is synced and now reads "USA · WNBA".** A live plan confirms API-Sports files it as
  **"NBA W"** (id 13, 345 games in season 2026). The stored name stays the provider's, but the UI
  renames it — nobody calls it "NBA W".
  Note the WNBA plays May–September, so the 2026 season is complete: it contributes history and
  calibration now, and upcoming games return when the 2027 season starts.
- **Fix: the NBA G League was never synced.** API-Sports calls it **"NBA - G League"**, hyphenated, and
  the entry looked for "NBA G League". It matches either spelling now and displays unhyphenated. The
  discovery test had the hyphenated name in its fixture while asserting the league was absent, so it
  was quietly documenting the bug; it now asserts the league is found.
- Deliberately still not synced, from the same USA list: the Las Vegas, Sacramento, Utah, Orlando and
  Salt Lake City Summer Leagues (exhibition), and NBA Cup / NBA In-Season Tournament, whose fixtures
  are regular-season games that would be counted twice under a second league.

## 0.9.3 — WNBA: API-Sports does not call it "WNBA"
- **The women's NBA entry now matches API-Sports' actual naming.** `--find wnba` returns nothing for a
  paid basketball plan, yet the date feed happily returns "Atlanta Dream W at New York Liberty W": the
  league is there, it just isn't spelled "WNBA". API-Sports suffixes women's competitions ("NCAA Women")
  and women's teams ("... W"), so the entry accepts `NBA W`, `NBA-W`, `NBA Women` and `WNBA`, and is
  asserted not to swallow the men's NBA, the G League, NBB or NBL.
- Fix: `sourcecheck` printed "season undefined" for the free sources. It logged the league's own season
  field, which only API-Sports sets, while querying with the fallback — it now prints the season it
  actually used, and labels leagues with their country.

## 0.9.2 — leagues show their country
- **Every league now reads "Lithuania · LKL" rather than "LKL"** — on the board's league filter, the
  heading above each block of games, the game page, the Top list and each leg in the Odds builder.
  With 51 leagues syncing, bare names were ambiguous or meaningless: NBL is Australia, New Zealand,
  Czechia and Bulgaria; Super League is Israel, Serbia, Iran and Uzbekistan; A2 is Greece and Italy.
  The league filter is also ordered by country now, and multi-word countries read as words
  ("Czech Republic", not "Czech-Republic").
- The `country` column has existed on `League` since the schema was written but nothing ever wrote to
  it, so it was empty everywhere. API-Sports discovery now records the country it files each league
  under, and the free sources label theirs. **It fills in on the next sync per sport** — leagues synced
  before this update keep showing the bare name until then.
- Fix: the sync report was keyed by league name, so the several countries running a "Super League",
  "NBL", "Premier League", "National League", "Extraliga" or "Superliga" overwrote each other and a
  league returning no games could hide behind a healthy namesake. The sync itself was unaffected
  (distinct provider ids, distinct rows); only the report lied. Repeated names now carry the id.

## 0.9.1 — see why a league is missing
- **`npm run sourcecheck -- --find wnba`** prints the raw rows from your plan's league list whose name
  or country contains that text, with the exact name, country, type, every season it offers and whether
  it is being synced. Leagues are matched by country + name, so a competition the provider spells
  differently is skipped in silence — this turns "it isn't showing" into a one-line answer.
- **`npm run sourcecheck -- --all`** lists every competition your plan returns that is *not* being
  synced, grouped by country, with cups marked.
- **sourcecheck now names the source in use** and says plainly when a sport is on the free source, since
  every sport defaults to it and a paid API-Sports plan does nothing until that sport is switched over
  in Settings → Data source. This is the usual reason an API-Sports league is missing.
- The WNBA pattern is no longer strictly anchored, so a name like "WNBA Regular Season" also matches.
  Discovery itself was already correct and unit-tested: given API-Sports' league list, it picks WNBA
  with its single-year season (2026, previous 2025) rather than the NBA's two-year format.

## 0.9.0 — safest capped at 1.60 a leg, many more leagues, NCAA divisions fixed
- **Builder → Safest never uses a leg priced above 1.60.** A long target is reached with more,
  shorter picks rather than a few risky ones. The cap is absolute: when a target cannot be reached
  under it, the page says so and points at a longer window, all sports, a lower target, more legs or
  Best value, rather than quietly slipping a 3.00 leg into a slip labelled "safest". The 14-day track
  record on that tab is rebuilt under the same cap. Best value is unchanged.
- **Many more leagues on API-Sports** — the wanted list goes from 96 to 170 competitions:
  · basketball (93) — NCAA (every division, see below), NBA G League, FIBA Europe Cup, second tiers in
    Spain (LEB Oro), Germany (ProA), Italy (Serie A2), France (Pro B), Greece (A2) and Turkey (TBL),
    plus Bosnia, Montenegro, North Macedonia, Kosovo, Slovakia, Georgia, Cyprus, Belarus, Norway,
    Iceland, Japan B2, Indonesia, Vietnam, Thailand, India, Iran, Lebanon, Qatar, Saudi Arabia, UAE,
    Kazakhstan, Uzbekistan, Puerto Rico, Dominican Republic, Colombia, Peru, Paraguay, Bolivia,
    Ecuador, and Africa — the Basketball Africa League, Egypt, Tunisia, Morocco, Nigeria, Angola, Senegal
  · baseball (30) — NCAA, Japan's Eastern and Western farm leagues, Korea's Futures League, and the
    European leagues: Germany, Czechia, Spain, France, Austria, Croatia, Belgium, plus Brazil and Curacao
  · hockey (47) — NCAA, USHL, Canada's three junior leagues (OHL, WHL, QMJHL), second tiers in Sweden
    (HockeyEttan), Finland (Suomi-sarja), Czechia (1. Liga), Denmark, Norway and France, plus Slovenia,
    Croatia, Serbia, Ukraine, Estonia, Lithuania, the BeNe League, Spain and South Korea
- **Fix: NCAA only ever synced one division.** League discovery matched each entry with `find`, taking
  the first competition whose name fitted and ignoring the rest — so "NCAA", which covers several
  divisions, contributed exactly one, whichever the provider happened to return first. Entries can now
  opt into taking every match, and NCAA (all three sports) and Canada's juniors do. Every other entry
  behaves exactly as before, and duplicates are dropped.
- **`npm run sourcecheck` now lists the free sources' leagues too**, with the season and game counts it
  already showed for API-Sports. It only did this for API-Sports before, which meant there was no way to
  see whether **WNBA** was actually included in your balldontlie plan. WNBA itself needs no change — it
  has been wired into the free basketball source (its own endpoint and season) and the API-Sports list
  all along; if it is missing it is the plan, and this is now how you confirm that.
- Note: all of the extra leagues live on API-Sports. The free sources carry NBA and WNBA, MLB, and the
  NHL only, and every sport defaults to the free source — switch a sport under **Settings → Data source**
  and give it a plan that includes the competitions you want.

## 0.8.1
- Retired two markets: **"Overtime / extra innings: no"** (near-certain, never a useful tip) and **both teams to score in baseball** (it happens in about 85% of games). They no longer appear anywhere — predictions, All markets, Top 20, scanners, Blend, slips or the Odds builder — including on calls stored before this update. Hockey keeps both teams to score, and "Overtime: yes" stays for all sports.

## 0.8.0 — Odds builder
- New **Builder** page per sport (with an **All sports** option): pick a target price (3, 5, 10, 30, 100 or your own) and a window, and get the combination that reaches it with the best chance, plus two alternatives.
- Legs come from every market, alternative lines and specials included. One leg per game, at most 2 per competition and 2 of the same market type; the spread rules relax only if the target is otherwise unreachable.
- Bookmaker prices are used where stored (value legs preferred, **Best value / Safest** switch); otherwise the model's fair odds, with the chance stated plainly.
- Each combination has **Save as slip**, **Copy** and **Sportybet code**, and shows its honest chance ("about 1 in 12") after a small correlation haircut.
- **Track record**: the same target rebuilt from locked calls on each of the last 14 days.

## 0.7.3 — calmer screens, steadier syncs
- **Dropdown filters** instead of long chip rows: league on the board (grouped by country — useful now that a paid plan brings 30+ leagues) and market on Top 20. Sport, time window and Most likely / Best value stay as buttons.
- **Markets on a game page are collapsible**: Win and Total open by default; each closed section shows how many markets it holds and the best probability. Keeps a 40-market page short.
- **Rate limits handled properly** on the free sources: a 429 now waits for the provider's own window (Retry-After, else a full minute) instead of retrying after two seconds.
- README on GitHub: sync commands, key changes (Settings and `.env`), every `.env` setting, updating, access code, and a troubleshooting table.

## 0.7.2
- Fix: API-Sports lists a league's seasons in no particular order and often doesn't flag the current one, so EdgeBoard was syncing an old season (NBA 2025-26 as "current", and much older seasons elsewhere). Seasons are now sorted by year: the flagged season if there is one, otherwise the latest, with the one before it as history.
- `sourcecheck` now says exactly why a sport has no source: switched off, set to API-Sports without a key, or missing balldontlie key.

## 0.7.1
- `npm run sourcecheck` now lists every league your plan includes, the season it picked and how many games that season returns (current and previous) — so an empty league is easy to tell apart from a missing one.

## 0.7.0 — access code, many more leagues
- **Access code:** a full-screen prompt covers the app until the code is entered. Set, change or remove it in **Settings → Access code** (PIN-protected), which always stays reachable. It locks again after 30 minutes of inactivity, every page view extends the window, and "Lock this device now" is available. The code is stored hashed (salted scrypt); changing it signs every device out. After 5 wrong codes the form locks for 5 minutes, tracked on the server.
- **Many more leagues when a sport uses API-Sports** (matched by country + name, so they work on any plan that includes them):
  · basketball — NBA, WNBA, NCAA, EuroLeague, EuroCup, Basketball Champions League, ABA League, Spain, Turkey, Italy, Greece, France, Germany, Lithuania, Israel, Russia VTB, Poland, Serbia, Czechia, Croatia, Slovenia, Belgium/Netherlands BNXT, Portugal, Finland, Sweden, Denmark, Switzerland, Austria, Hungary, Romania, Bulgaria, Ukraine, Latvia, Estonia, Japan B.League, Korea KBL, Philippines PBA, China CBA, Australia and New Zealand NBL, Argentina, Brazil NBB, Mexico, Uruguay, Chile, Venezuela, Canada CEBL, Taiwan
  · baseball — MLB, NPB, KBO, CPBL, Mexico (LMB and LMP), Dominican LIDOM, Venezuela LVBP, Puerto Rico, Colombia, Panama, Nicaragua, Cuba, Australia ABL, Netherlands, Italy, China, MiLB
  · hockey — NHL, KHL, SHL, Liiga, DEL and DEL2, Czech Extraliga, Swiss National and Swiss League, AHL, ECHL, Austria ICE, Slovakia, Norway, Denmark, Poland, Latvia, Belarus, Kazakhstan, France, Italy, UK EIHL, HockeyAllsvenskan, Mestis, Hungary, Romania, Asia League
- Free sources still cover NBA, WNBA, MLB and NHL; the extra leagues need a paid API-Sports plan for that sport.

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
