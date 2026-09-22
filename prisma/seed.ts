import { PrismaClient } from "@prisma/client";
import { seedDemo } from "../src/lib/demo/generate";
import { SPORT_IDS } from "../src/lib/sports";

const db = new PrismaClient();
(async () => {
  for (const s of SPORT_IDS) { await seedDemo(db, s); console.log(`DEMO ${s}: ${await db.prediction.count({ where: { game: { source: "DEMO", sport: s.toUpperCase() as never } } })} predictions`); }
})().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
