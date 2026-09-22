/**
 * Server self-check:  cd /var/www/edgeboard && sudo -u ubuntu npm run selfcheck        (checks + lock/settle)
 *                     … npm run selfcheck -- --demo                                     (also rebuilds DEMO data and tests the full pipeline)
 */
import { PrismaClient } from "@prisma/client";
import { lockDue, settle } from "../src/lib/pipeline/ledger";
import { seedDemo } from "../src/lib/demo/generate";
import { marketsOf } from "../src/lib/picks";
import { selectTop, tipsFor } from "../src/lib/top";
import { latestLines, valueTips } from "../src/lib/value";
import { computeAccuracy } from "../src/lib/accuracy";
import { SPORT_ENUM, SPORT_IDS, type SportId } from "../src/lib/sports";

const db = new PrismaClient();
const LOCK = Number(process.env.PREDICTION_LOCK_MINUTES ?? 15);
let failures = 0;
const check = (name: string, ok: boolean, info = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? ` — ${info}` : ""}`); if (!ok) failures++; };

async function ledger(sport: SportId, source: "DEMO" | "API_SPORTS") {
  const S = SPORT_ENUM[sport];
  const locked = await db.prediction.findMany({ where: { sport: S, lockedAt: { not: null }, game: { source } }, include: { game: { include: { results: { orderBy: { settledAt: "desc" }, take: 1 } } } } });
  const per = new Map<string, number>(); let late = 0, gen = 0;
  for (const p of locked) { per.set(p.gameId, (per.get(p.gameId) ?? 0) + 1); if (+p.lockedAt! > +p.game.startUtc - LOCK * 60_000 + 1000) late++; if (+p.generatedAt > +p.lockedAt! + 1000) gen++; }
  const tag = `${sport}/${source}`;
  check(`${tag}: one locked call per game`, [...per.values()].every((n) => n === 1), `${locked.length} locked`);
  check(`${tag}: locks at or before start − ${LOCK} min`, late === 0, late ? `${late} late` : "");
  check(`${tag}: locked calls generated before the lock`, gen === 0);
  const after = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM "Prediction" p JOIN "Prediction" l ON l."gameId" = p."gameId" AND l."lockedAt" IS NOT NULL JOIN "Game" g ON g.id = p."gameId"
    WHERE g.sport = $1::"Sport" AND g.source = $2::"Source" AND p."lockedAt" IS NULL AND p."generatedAt" > l."lockedAt"`, S, source);
  check(`${tag}: nothing written after a lock`, Number(after[0]?.n ?? 0) === 0);
  const missing = await db.game.count({ where: { sport: S, source, status: "FINISHED", homeScore: { not: null }, startUtc: { gte: new Date(Date.now() - 30 * 864e5) }, results: { none: {} } } });
  check(`${tag}: finished games (30 days) have results`, missing === 0, missing ? `${missing} missing` : "");
  const scored = locked.filter((p) => p.game.results[0]).map((p) => { const r = p.game.results[0]; return { start: p.game.startUtc, band: p.band, pHome: p.calHomeWin, markets: marketsOf(p), market: null,
    result: { h: r.homeScore, a: r.awayScore, hSeg: r.homeSeg, aSeg: r.awaySeg, hReg: r.hReg, aReg: r.aReg, extra: r.extraTime ?? undefined, hFirst: r.hFirst, aFirst: r.aFirst } }; });
  const acc = computeAccuracy(scored);
  console.log(`      ${tag}: ${acc.n} scored · Brier ${acc.n ? acc.model.brier.toFixed(3) : "-"} vs home base rate ${acc.n ? acc.alwaysHome.brier.toFixed(3) : "-"}`);
  return acc;
}

(async () => {
  const demo = process.argv.includes("--demo");
  console.log(`EdgeBoard self-check ${new Date().toISOString()}${demo ? " (with demo rebuild)" : ""}\n`);
  check("lock job runs", true, `${await lockDue(db)} newly locked`);
  for (const s of SPORT_IDS) {
    const st = await settle(db, s); check(`${s}: settle runs`, true, `${st.created} new, ${st.corrected} corrections`);
    for (const src of ["API_SPORTS", "DEMO"] as const) if (await db.league.count({ where: { sport: SPORT_ENUM[s], source: src } })) await ledger(s, src);
  }
  if (demo) {
    for (const s of SPORT_IDS) {
      await seedDemo(db, s);
      const acc = await ledger(s, "DEMO");
      check(`${s}: demo ledger scored`, acc.n > 20, `${acc.n}`);
      check(`${s}: model beats the home base rate`, acc.n > 0 && acc.model.brier < acc.alwaysHome.brier);
      const up = await db.game.findMany({ where: { sport: SPORT_ENUM[s], source: "DEMO", status: "SCHEDULED", startUtc: { gt: new Date() } }, include: { predictions: { orderBy: { revision: "desc" }, take: 1 }, lines: { orderBy: { fetchedAt: "desc" } } } });
      const top = selectTop(up.flatMap((g) => g.predictions[0] ? [{ item: g, id: g.id, startMs: +g.startUtc, tips: tipsFor(g.predictions[0]) }] : []));
      const dog = top.filter((t) => t.tip.kind === "spread" && (t.tip.line ?? 0) > 0).length, noOt = top.filter((t) => t.tip.kind === "ot" && t.tip.side === "no").length;
      check(`${s}: Top 20 with caps`, top.length > 0 && dog <= 2 && noOt === 0, `${top.length} tips · underdog handicaps ${dog}`);
      const specials = up[0]?.predictions[0] ? marketsOf(up[0].predictions[0]).filter((m) => m.group === "props" || m.group === "team").length : 0;
      check(`${s}: specials generated`, specials >= 4, `${specials} on the first game`);
      const v = up.flatMap((g) => g.predictions[0] ? valueTips(g.predictions[0], latestLines(g.lines)) : []);
      check(`${s}: value list computes`, true, `${v.length} candidates`);
    }
  }
  console.log(`\n${failures ? `${failures} check(s) FAILED` : "All checks passed"}`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("FAIL  self-check crashed:", e); process.exit(1); }).finally(() => db.$disconnect());
