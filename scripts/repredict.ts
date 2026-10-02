/**
 * Re-price games you already have, without fetching anything:
 *   cd /var/www/edgearena && sudo -u ubuntu npm run repredict                  20 stalest leagues, all sports
 *   cd /var/www/edgearena && sudo -u ubuntu npm run repredict -- basketball    one sport
 *   cd /var/www/edgearena && sudo -u ubuntu npm run repredict -- basketball 40 a bigger batch
 *
 * What this is for. `npm run ingest` re-sweeps every league from the provider — hundreds of requests
 * against a daily quota — to re-download games that are already stored. Re-pricing needs none of that:
 * the fit comes from stored results and the predictions from stored games. So this touches no network,
 * costs nothing against the API plan, and is safe to run as often as you like.
 *
 * ── Why it works in batches, stalest first ─────────────────────────────────────────────────────────
 * Fitting a league holds 400 days of its history in memory, and doing every league in one process is
 * what made the sister app's sync crawl — leagues taking two seconds each early on were taking thirty by
 * the end. Each invocation handles a fixed number and stops, so the memory goes back to the operating
 * system in between.
 *
 * Ordering is by how stale each league's newest prediction is, so repeated runs rotate through the lot
 * rather than redoing the same leagues. A run that reports fewer leagues than the batch size has reached
 * the end of the list.
 *
 * ── What it will not touch ─────────────────────────────────────────────────────────────────────────
 * Games inside the lock window. From fifteen minutes before start the locked call is final, and
 * rateAndPredictLeague excludes them — so re-pricing can never rewrite a call that has been scored.
 */
import { PrismaClient } from "@prisma/client";
import { rateAndPredictLeague } from "../src/lib/pipeline/predict";
import { getProvider } from "../src/lib/providers";
import { SPORT_IDS, SPORT_ENUM, isSport, type SportId } from "../src/lib/sports";

const db = new PrismaClient();
const DEFAULT_BATCH = 20;
const LOCK_MIN = Number(process.env.PREDICTION_LOCK_MINUTES ?? 15);
const DAY = 86_400_000;

(async () => {
  const args = process.argv.slice(2);
  const only = args.find((a) => isSport(a)) as SportId | undefined;
  const batch = Number(args.find((a) => /^\d+$/.test(a))) || DEFAULT_BATCH;
  const now = new Date();

  // The predictor's own window, so a league is only counted as outstanding if it has work it can do.
  const upcoming = {
    status: "SCHEDULED" as const,
    startUtc: { gt: new Date(now.getTime() + LOCK_MIN * 60_000), lte: new Date(now.getTime() + 8 * DAY) },
  };

  const sports = SPORT_IDS.filter((s) => !only || s === only);
  const candidates: { id: string; name: string; country: string; sport: SportId; games: number; stale: number }[] = [];

  for (const s of sports) {
    const p = await getProvider(s);
    if (!p) { console.log(`${s}: skipped (demo mode — no key, or the sport is disabled in Settings)`); continue; }
    const leagues = await db.league.findMany({
      where: { sport: SPORT_ENUM[s], source: p.source, games: { some: upcoming } },
      select: { id: true, name: true, country: true, _count: { select: { games: { where: upcoming } } } },
    });
    for (const l of leagues) {
      // Newest prediction in this league, as a staleness key. One small query per league; there are tens.
      const newest = await db.prediction.findFirst({
        where: { game: { leagueId: l.id } },
        orderBy: { generatedAt: "desc" },
        select: { generatedAt: true },
      });
      candidates.push({
        id: l.id, name: l.name, country: l.country, sport: s,
        games: l._count.games, stale: newest?.generatedAt.getTime() ?? 0,
      });
    }
  }

  if (!candidates.length) { console.log("Nothing to re-price: no league has an upcoming game inside the prediction window."); return; }

  // Stalest first, then busiest, so the most visible competitions come back soonest.
  candidates.sort((a, b) => a.stale - b.stale || b.games - a.games);
  const todo = candidates.slice(0, batch);
  console.log(`${candidates.length} league(s) have upcoming games. Re-pricing the ${todo.length} stalest now, no provider requests.\n`);

  let written = 0;
  for (const [i, lg] of todo.entries()) {
    const label = `${lg.country} · ${lg.name} (${lg.sport})`;
    process.stderr.write(`  → [${i + 1}/${todo.length}] ${label}…\n`);
    try {
      const r = await rateAndPredictLeague(db, lg.sport, lg.id, { now });
      written += r.predictions;
      console.log(`  [${i + 1}/${todo.length}] ${label} — ${r.predictions} re-priced of ${r.upcoming} upcoming (fitted from ${r.games} finished)`);
    } catch (e) {
      // One league's history being unfittable must not end the batch.
      console.log(`  [${i + 1}/${todo.length}] ${label} — FAILED: ${(e as Error).message.slice(0, 120)}`);
    }
  }

  const left = candidates.length - todo.length;
  console.log(`\n${written} prediction(s) rewritten.`);
  console.log(left
    ? `${left} league(s) not reached this run — run it again to take the next ${Math.min(batch, left)}.`
    : "Every league with upcoming games has been re-priced.");
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
