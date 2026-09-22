/**
 * Full sync as its OWN process (not inside the web server), so the site stays fast while ratings are fitted.
 *   cd /var/www/edgeboard && npm run ingest              (all sports)
 *   cd /var/www/edgeboard && npm run ingest -- hockey    (one sport)
 */
import { PrismaClient } from "@prisma/client";
import { getProvider } from "../src/lib/providers";
import { ingest } from "../src/lib/pipeline/ingest";
import { lockDue } from "../src/lib/pipeline/ledger";
import { SPORT_IDS, isSport } from "../src/lib/sports";

const db = new PrismaClient();
const only = process.argv.slice(2).find((a) => isSport(a));
(async () => {
  const started = Date.now(), report: Record<string, unknown> = {};
  for (const s of SPORT_IDS.filter((x) => !only || x === only)) {
    const p = await getProvider(s);
    report[s] = p ? await ingest(db, p).catch((e) => ({ error: (e as Error).message })) : "demo (no key or sport disabled)";
  }
  report.locked = await lockDue(db);
  console.log(JSON.stringify({ at: new Date(started).toISOString(), ok: true, seconds: Math.round((Date.now() - started) / 1000), report }));
})().catch((e) => { console.log(JSON.stringify({ at: new Date().toISOString(), ok: false, error: (e as Error).message })); process.exitCode = 1; }).finally(() => db.$disconnect());
