import type { PrismaClient } from "@prisma/client";
import { SPORTS, SPORT_ENUM, type SportId } from "../sports";
import type { PGame, SportProvider } from "../providers/apiSports";
import { rateAndPredictLeague } from "./predict";
import { lockDue, refitCalibration, settle } from "./ledger";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** season games (1 call per league-season) → odds for games in the next 36h (capped) → rate → predict → lock → settle → calibrate. */
export async function ingest(db: PrismaClient, p: SportProvider, opts: { now?: Date; maxOddsCalls?: number } = {}) {
  const sport: SportId = p.sport, cfg = SPORTS[sport], now = opts.now ?? new Date();
  const S = SPORT_ENUM[sport];
  const log = await db.syncLog.create({ data: { sport: S, job: "ingest", ok: false } });
  const report: Record<string, unknown> = {};
  try {
    for (const L of cfg.leagues) {
      const season = cfg.season(now);
      let games: PGame[] = [];
      try { games = await p.seasonGames(L.id, season); } catch (e) { report[L.name] = `skip: ${(e as Error).message}`; continue; }
      if (games.filter((g) => g.status === "FINISHED").length < 150) {
        const prevSeason = /-/.test(season) ? season.split("-").map((y) => String(Number(y) - 1)).join("-") : String(Number(season) - 1);
        try { games = [...(await p.seasonGames(L.id, prevSeason)), ...games]; } catch { /* no previous season */ }
      }
      if (!games.length) { report[L.name] = "no games"; continue; }
      const league = await db.league.upsert({
        where: { source_sport_externalId_season: { source: "API_SPORTS", sport: S, externalId: L.id, season } },
        update: { name: L.name, focus: !!L.focus }, create: { source: "API_SPORTS", sport: S, externalId: L.id, season, name: L.name, focus: !!L.focus },
      });
      const team = async (t: PGame["home"]) => db.team.upsert({
        where: { source_sport_externalId_leagueId: { source: "API_SPORTS", sport: S, externalId: t.externalId, leagueId: league.id } },
        update: { name: t.name, logoUrl: t.logoUrl }, create: { source: "API_SPORTS", sport: S, externalId: t.externalId, leagueId: league.id, name: t.name, logoUrl: t.logoUrl },
      });
      for (const g of games) {
        const [h, a] = await Promise.all([team(g.home), team(g.away)]);
        const data = { leagueId: league.id, startUtc: g.startUtc, status: g.status, homeTeamId: h.id, awayTeamId: a.id,
          homeScore: g.homeScore, awayScore: g.awayScore, homeReg: g.homeReg, awayReg: g.awayReg, homeSeg: g.homeSeg, awaySeg: g.awaySeg, extraTime: g.extraTime,
          ...(g.homeFirst != null ? { homeFirst: g.homeFirst, awayFirst: g.awayFirst } : {}) };
        await db.game.upsert({ where: { source_sport_externalId: { source: "API_SPORTS", sport: S, externalId: g.externalId } }, update: data, create: { source: "API_SPORTS", sport: S, externalId: g.externalId, ...data } });
      }
      // Odds (best effort, capped to protect the daily quota)
      const soon = await db.game.findMany({ where: { leagueId: league.id, status: "SCHEDULED", startUtc: { gte: now, lte: new Date(now.getTime() + 36 * 3600_000) } }, take: opts.maxOddsCalls ?? 30 });
      let lines = 0;
      for (const g of soon) {
        try {
          const o = await p.odds(g.externalId);
          if (o.moneyline) { await db.marketLine.create({ data: { gameId: g.id, market: "moneyline", line: 0, priceA: o.moneyline[0], priceB: o.moneyline[1], bookmaker: o.bookmaker ?? "unknown" } }); lines++; }
          for (const [market, key] of [["total", "total"], ["spread", "spread"], ["seg_total", "seg"]] as const) {
            const v = o[key]; if (v == null) continue;
            const pr = o.prices?.[key];
            await db.marketLine.create({ data: { gameId: g.id, market, line: v, priceA: pr?.[0], priceB: pr?.[1], bookmaker: o.bookmaker ?? "unknown" } }); lines++;
          }
        } catch { /* odds unavailable on plan */ }
        await sleep(250);
      }
      await db.league.update({ where: { id: league.id }, data: { lastSyncAt: new Date() } });
      // API-Sports has no confirmed lineups / probable pitchers / starting goalies → news stays incomplete (max Medium).
      report[L.name] = { ...(await rateAndPredictLeague(db, sport, league.id, { now })), lines };
    }
    report.locked = await lockDue(db, now);
    report.settled = await settle(db, sport);
    report.calibrationRows = await refitCalibration(db, sport);
    await db.syncLog.update({ where: { id: log.id }, data: { ok: true, finishedAt: new Date(), message: JSON.stringify(report).slice(0, 2000) } });
    return report;
  } catch (e) {
    await db.syncLog.update({ where: { id: log.id }, data: { finishedAt: new Date(), message: (e as Error).message.slice(0, 2000) } });
    throw e;
  }
}
