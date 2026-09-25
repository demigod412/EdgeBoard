import type { PrismaClient } from "@prisma/client";
import { SPORT_ENUM, leagueLabel, type SportId } from "../sports";
import type { PGame, SportProvider } from "../providers/types";
import { rateAndPredictLeague } from "./predict";
import { lockDue, refitCalibration, settle } from "./ledger";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** season games (1 call per league-season) → odds for games in the next 36h (capped) → rate → predict → lock → settle → calibrate. */
export async function ingest(db: PrismaClient, p: SportProvider, opts: { now?: Date; maxOddsCalls?: number } = {}) {
  const sport: SportId = p.sport, now = opts.now ?? new Date(), SRC = p.source;
  const S = SPORT_ENUM[sport];
  const log = await db.syncLog.create({ data: { sport: S, job: "ingest", ok: false } });
  const report: Record<string, unknown> = {};
  try {
    let leagues = p.leagues;
    if (p.discoverLeagues) { try { const d = await p.discoverLeagues(); if (d.length) leagues = d; } catch (e) { report.discovery = `using default leagues: ${(e as Error).message}`; } }
    // Several countries run a league called "Super League", "NBL" or "Premier League". The report is
    // keyed by this label, so a bare name would let a failing league hide behind a healthy namesake.
    // The country settles almost every clash ("Israel · Super League"); the provider id is the last
    // resort for the rare case where even that repeats.
    const labelCount = new Map<string, number>();
    for (const L of leagues) { const k = leagueLabel(L); labelCount.set(k, (labelCount.get(k) ?? 0) + 1); }
    const label = (L: (typeof leagues)[number]) => {
      const k = leagueLabel(L);
      return labelCount.get(k)! > 1 ? `${k} #${L.id}` : k;
    };
    for (const L of leagues) {
      const season = L.season ?? p.season(now);
      let games: PGame[] = [];
      try { games = await p.seasonGames(L.id, season); } catch (e) { report[label(L)] = `skip: ${(e as Error).message}`; continue; }
      if (games.filter((g) => g.status === "FINISHED").length < 150) {
        try { games = [...(await p.seasonGames(L.id, L.prevSeason ?? p.prevSeason(season))), ...games]; } catch (e) { report[`${label(L)} previous season`] = `not loaded: ${(e as Error).message}`; }
      }
      if (!games.length) { report[label(L)] = "no games"; continue; }
      const league = await db.league.upsert({
        where: { source_sport_externalId_season: { source: SRC, sport: S, externalId: L.id, season } },
        update: { name: L.name, country: L.country ?? "", focus: !!L.focus },
        create: { source: SRC, sport: S, externalId: L.id, season, name: L.name, country: L.country ?? "", focus: !!L.focus },
      });
      const team = async (t: PGame["home"]) => db.team.upsert({
        where: { source_sport_externalId_leagueId: { source: SRC, sport: S, externalId: t.externalId, leagueId: league.id } },
        update: { name: t.name, logoUrl: t.logoUrl }, create: { source: SRC, sport: S, externalId: t.externalId, leagueId: league.id, name: t.name, logoUrl: t.logoUrl },
      });
      for (const g of games) {
        const [h, a] = await Promise.all([team(g.home), team(g.away)]);
        const data = { leagueId: league.id, startUtc: g.startUtc, status: g.status, homeTeamId: h.id, awayTeamId: a.id,
          homeScore: g.homeScore, awayScore: g.awayScore, homeReg: g.homeReg, awayReg: g.awayReg, extraTime: g.extraTime,
          ...(g.homeFirst != null ? { homeFirst: g.homeFirst, awayFirst: g.awayFirst } : {}),
          ...(g.homeSeg == null ? {} : { homeSeg: g.homeSeg, awaySeg: g.awaySeg }), newsReady: !!g.newsReady };
        await db.game.upsert({ where: { source_sport_externalId: { source: SRC, sport: S, externalId: g.externalId } }, update: data, create: { source: SRC, sport: S, externalId: g.externalId, ...data } });
      }
      // First-segment scores the season list lacks (NHL 1st period): back-fill a few dates per run
      let segFilled = 0;
      if (p.segmentScores) {
        const need = await db.game.findMany({ where: { leagueId: league.id, status: "FINISHED", homeSeg: null, startUtc: { gte: new Date(now.getTime() - 400 * 864e5) } }, select: { id: true, externalId: true, startUtc: true }, orderBy: { startUtc: "desc" } });
        const dates = [...new Set(need.map((g) => g.startUtc.toISOString().slice(0, 10)))].slice(0, Number(process.env.MAX_SEGMENT_DATES ?? 25));
        if (dates.length) {
          try {
            const m = await p.segmentScores(dates);
            for (const g of need) { const v = m.get(g.externalId); if (v) { await db.game.update({ where: { id: g.id }, data: { homeSeg: v[0], awaySeg: v[1] } }); segFilled++; } }
          } catch { /* try again next run */ }
        }
      }
      // Odds (API-Sports only; best effort, capped to protect the daily quota)
      const soon = !p.odds ? [] : await db.game.findMany({ where: { leagueId: league.id, status: "SCHEDULED", startUtc: { gte: now, lte: new Date(now.getTime() + 36 * 3600_000) } }, take: opts.maxOddsCalls ?? (Number(process.env.MAX_ODDS_CALLS) || 30) });
      let lines = 0;
      for (const g of soon) {
        try {
          const o = await p.odds!(g.externalId);
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
      report[label(L)] = { source: p.name, ...(await rateAndPredictLeague(db, sport, league.id, { now, newsComplete: (g) => g.newsReady })), lines, ...(segFilled ? { segFilled } : {}) };
    }
    report.locked = await lockDue(db, now);
    report.settled = await settle(db, sport);
    report.calibrationRows = await refitCalibration(db, sport, SRC);
    await db.syncLog.update({ where: { id: log.id }, data: { ok: true, finishedAt: new Date(), message: JSON.stringify(report).slice(0, 2000) } });
    return report;
  } catch (e) {
    await db.syncLog.update({ where: { id: log.id }, data: { finishedAt: new Date(), message: (e as Error).message.slice(0, 2000) } });
    throw e;
  }
}
