/**
 * Prune superseded prediction revisions.
 *
 *   cd /var/www/edgearena && sudo -u ubuntu npm run prune           report only, deletes nothing
 *   cd /var/www/edgearena && sudo -u ubuntu npm run prune -- --apply actually delete
 *   ... npm run prune -- --apply --keep 5                           keep more history per game
 *
 * Locked revisions are never candidates: they are the accuracy ledger. See src/lib/pipeline/prune.ts.
 *
 * Reporting is the default and --apply is required, because this is the one maintenance job here that
 * destroys rows. A dry run prints exactly what the real run would remove.
 */
import { PrismaClient } from "@prisma/client";
import { prunePredictions } from "../src/lib/pipeline/prune";

const db = new PrismaClient();

(async () => {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const ki = args.indexOf("--keep");
  const keep = ki >= 0 ? Number(args[ki + 1]) : undefined;

  const before = await db.prediction.count();
  const locked = await db.prediction.count({ where: { lockedAt: { not: null } } });
  const games = await db.prediction.groupBy({ by: ["gameId"], _count: { _all: true } });
  const avg = games.length ? before / games.length : 0;
  const max = games.reduce((m, g) => Math.max(m, g._count._all), 0);
  console.log(`${before} prediction(s) across ${games.length} game(s) — ${avg.toFixed(1)} per game on average, ${max} at most.`);
  console.log(`${locked} are locked and will never be touched (they are the accuracy ledger).\n`);

  const r = await prunePredictions(db, { keep, dryRun: !apply });
  if (!r.candidates) { console.log(`Nothing to prune: no game has more than ${r.keep} unlocked revision(s).`); return; }

  if (!apply) {
    console.log(`Would delete ${r.candidates} superseded unlocked revision(s), keeping the newest ${r.keep} per game.`);
    console.log(`That leaves ${before - r.candidates} row(s), ${(((before - r.candidates) / (games.length || 1))).toFixed(1)} per game.\n`);
    console.log("Nothing has been deleted. To do it:  npm run prune -- --apply");
    return;
  }

  const after = await db.prediction.count();
  const lockedAfter = await db.prediction.count({ where: { lockedAt: { not: null } } });
  console.log(`Deleted ${r.deleted}. ${after} row(s) remain, ${(after / (games.length || 1)).toFixed(1)} per game.`);
  // Asserted rather than assumed: if this ever drops, the ledger has been damaged and that must be loud.
  console.log(locked === lockedAfter
    ? `Locked revisions intact: ${lockedAfter}.`
    : `WARNING: locked revisions went from ${locked} to ${lockedAfter} — the ledger has changed. This should be impossible; please report it.`);
  console.log("\nDisk is reclaimed by autovacuum over the next while. To reclaim it now, without locking the table:");
  console.log('  sudo -u postgres psql -d <db> -c \'VACUUM (ANALYZE) "Prediction";\'');
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
