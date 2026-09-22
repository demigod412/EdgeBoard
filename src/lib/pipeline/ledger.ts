import type { PrismaClient } from "@prisma/client";
import { fitBinary } from "../model/calibration";
import { MODEL_VERSION } from "../model/constants";
import { SPORT_ENUM, type SportId } from "../sports";
import type { SportProvider } from "../providers/types";

const LOCK_MIN = Number(process.env.PREDICTION_LOCK_MINUTES ?? 15);

/**
 * T-15 lock: for each game reaching start − 15 min, stamp the latest prediction generated BEFORE that moment.
 * lockedAt = the lock moment itself. A locked row is never modified again.
 */
export async function lockDue(db: PrismaClient, now = new Date()) {
  const due = await db.game.findMany({
    where: { startUtc: { lte: new Date(now.getTime() + LOCK_MIN * 60_000), gte: new Date(now.getTime() - 7 * 86_400_000) }, predictions: { some: {}, none: { lockedAt: { not: null } } } },
    select: { id: true, startUtc: true },
  });
  let n = 0;
  for (const g of due) {
    const lockAt = new Date(g.startUtc.getTime() - LOCK_MIN * 60_000);
    const p = await db.prediction.findFirst({ where: { gameId: g.id, generatedAt: { lte: lockAt } }, orderBy: { revision: "desc" } });
    if (!p) continue; // no call existed before the lock moment → this game is not scored
    const r = await db.prediction.updateMany({ where: { id: p.id, lockedAt: null }, data: { lockedAt: lockAt } }); n += r.count;
  }
  return n;
}

/** Results refresh: only when a game that should have ended is not marked finished; one request per date. */
export async function syncResults(db: PrismaClient, p: SportProvider, now = new Date()) {
  const S = SPORT_ENUM[p.sport];
  const minutes = p.sport === "baseball" ? 200 : p.sport === "hockey" ? 160 : 150;
  const pending = await db.game.findMany({ where: { sport: S, source: p.source, status: { in: ["SCHEDULED", "LIVE"] }, startUtc: { lte: new Date(now.getTime() - minutes * 60_000), gte: new Date(now.getTime() - 3 * 86_400_000) } }, select: { startUtc: true } });
  if (!pending.length) return { checked: 0, updated: 0 };
  const dates = [...new Set(pending.map((g) => g.startUtc.toISOString().slice(0, 10)))];
  let updated = 0;
  for (const date of dates) {
    for (const g of await p.gamesOn(date)) {
      if (g.homeScore == null || g.awayScore == null) continue;
      const u = await db.game.updateMany({ where: { sport: S, source: p.source, externalId: g.externalId }, data: {
        status: g.status, homeScore: g.homeScore, awayScore: g.awayScore, homeReg: g.homeReg, awayReg: g.awayReg, extraTime: g.extraTime,
        ...(g.homeFirst != null ? { homeFirst: g.homeFirst, awayFirst: g.awayFirst } : {}), ...(g.homeSeg == null ? {} : { homeSeg: g.homeSeg, awaySeg: g.awaySeg }) } });
      updated += u.count;
    }
  }
  return { checked: dates.length, updated };
}

/** Append a Result for every finished game without one; a changed score appends a correction (never edits). */
export async function settle(db: PrismaClient, sport?: SportId) {
  const gs = await db.game.findMany({
    where: { status: "FINISHED", homeScore: { not: null }, awayScore: { not: null }, ...(sport ? { sport: SPORT_ENUM[sport] } : {}), startUtc: { gte: new Date(Date.now() - 30 * 86_400_000) } },
    include: { results: { orderBy: { settledAt: "desc" }, take: 1 } },
  });
  let created = 0, corrected = 0;
  for (const g of gs) {
    const last = g.results[0];
    if (last && last.homeScore === g.homeScore && last.awayScore === g.awayScore && last.homeSeg === g.homeSeg && last.awaySeg === g.awaySeg) continue;
    await db.result.create({ data: { gameId: g.id, homeScore: g.homeScore!, awayScore: g.awayScore!, homeSeg: g.homeSeg, awaySeg: g.awaySeg,
      hReg: g.homeReg, aReg: g.awayReg, extraTime: g.extraTime, hFirst: g.homeFirst, aFirst: g.awayFirst, supersedesId: last?.id ?? null } });
    if (last) corrected++; else created++;
  }
  return { created, corrected };
}

/** Refit calibration per market from locked + settled predictions. */
/** Live calibration is fitted from LIVE calls only (demo games never influence live probabilities). */
export async function refitCalibration(db: PrismaClient, sport: SportId, source: "API_SPORTS" | "OPEN") {
  const rows = await db.prediction.findMany({ where: { sport: SPORT_ENUM[sport], modelVersion: MODEL_VERSION, lockedAt: { not: null }, game: { source, results: { some: {} } } }, include: { game: { include: { results: { orderBy: { settledAt: "desc" }, take: 1 } } } } });
  const data: Record<string, { p: number[]; y: (0 | 1)[] }> = { win: { p: [], y: [] }, total: { p: [], y: [] }, spread: { p: [], y: [] }, seg_total: { p: [], y: [] } };
  for (const r of rows) {
    const res = r.game.results[0]; if (!res) continue;
    const tot = res.homeScore + res.awayScore, m = res.homeScore - res.awayScore;
    data.win.p.push(r.rawHomeWin); data.win.y.push(m > 0 ? 1 : 0);
    if (tot !== r.totalLine) { data.total.p.push(r.rawOver); data.total.y.push(tot > r.totalLine ? 1 : 0); }
    if (m + r.spreadLine !== 0) { data.spread.p.push(r.rawHomeCover); data.spread.y.push(m + r.spreadLine > 0 ? 1 : 0); }
    if (res.homeSeg != null && res.awaySeg != null && res.homeSeg + res.awaySeg !== r.segLine) { data.seg_total.p.push(r.rawSegOver); data.seg_total.y.push(res.homeSeg + res.awaySeg > r.segLine ? 1 : 0); }
  }
  for (const [market, d] of Object.entries(data)) {
    const c = fitBinary(d.p, d.y);
    await db.calibrationModel.updateMany({ where: { sport: SPORT_ENUM[sport], market, active: true }, data: { active: false } });
    await db.calibrationModel.create({ data: { sport: SPORT_ENUM[sport], modelVersion: MODEL_VERSION, market, method: c.method, n: c.n, knots: c.knots } });
  }
  return rows.length;
}
