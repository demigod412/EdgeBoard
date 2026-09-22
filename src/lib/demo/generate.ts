import type { PrismaClient, Game } from "@prisma/client";
import { makeTruth, simulateSeason, withPrices } from "./simulate";
import { makeRng } from "./rng";
import { SPORT_ENUM, type SportId } from "../sports";
import { fitFor, rateAndPredictLeague, toHist, writePrediction } from "../pipeline/predict";
import { IDENTITY_CAL } from "../model/predict";
import { settle } from "../pipeline/ledger";
import { DAY } from "../model/common";

const TEAMS: Record<SportId, string[]> = {
  basketball: ["Harbor Herons", "Mesa Comets", "Northgate Kings", "Riverside Lynx", "Summit Owls", "Bayou Rays", "Canyon Drift", "Delta Forge", "Ember City", "Frontier Elk", "Granite Bay", "Lakeside Pilots", "Maple Rush", "Oakridge Storm"],
  baseball: ["Harbor Gulls", "Mesa Miners", "Northgate Pilots", "Riverside Barons", "Summit Pines", "Bayou Cranes", "Canyon Rattlers", "Delta Stingers", "Ember Foxes", "Frontier Mules", "Granite Hawks", "Lakeside Anchors", "Maple Grays", "Oakridge Clippers"],
  hockey: ["Harbor Icebreakers", "Mesa Coyotes FC", "Northgate Wolves", "Riverside Bruins", "Summit Blizzard", "Bayou Gators", "Canyon Blades", "Delta Freeze", "Ember Wings", "Frontier Moose", "Granite Rock", "Lakeside Loons", "Maple Frost", "Oakridge Ravens"],
};
const LEAGUE: Record<SportId, string> = { basketball: "Demo Basketball League", baseball: "Demo Baseball League", hockey: "Demo Hockey League" };

/** Fictional clubs, simulated seasons, 30 days of locked + settled demo predictions, and 7 days ahead. */
export async function seedDemo(db: PrismaClient, sport: SportId, now = new Date()) {
  const S = SPORT_ENUM[sport];
  const where = { sport: S, source: "DEMO" as const };
  await db.result.deleteMany({ where: { game: where } });
  await db.prediction.deleteMany({ where: { game: where } });
  await db.marketLine.deleteMany({ where: { game: where } });
  await db.game.deleteMany({ where });
  await db.teamRating.deleteMany({ where: { team: where } });
  await db.team.deleteMany({ where });
  await db.league.deleteMany({ where });

  const league = await db.league.create({ data: { ...where, externalId: "DEMO", name: LEAGUE[sport], country: "Demo", season: String(now.getUTCFullYear()), focus: true, lastSyncAt: now } });
  const names = TEAMS[sport];
  const teams = [];
  for (const [i, name] of names.entries()) teams.push(await db.team.create({ data: { ...where, externalId: `D${i}`, leagueId: league.id, name, shortName: name.split(" ").slice(-1)[0] } }));
  const start = now.getTime() - 170 * DAY;
  const { games } = simulateSeason(sport, names.length, Math.floor(start / DAY) * DAY, 177, { basketball: 11, baseball: 22, hockey: 33 }[sport]);

  const rows: Game[] = [];
  const truth = makeTruth(sport, names.length, { basketball: 11, baseball: 22, hockey: 33 }[sport]), pr = makeRng(5);
  for (const [k, g0] of games.entries()) {
    const g = g0.date.getTime() > now.getTime() - 32 * DAY ? withPrices(sport, pr, truth, g0) : g0;
    const past = g.date.getTime() < now.getTime() - 3 * 3600_000;
    const row = await db.game.create({ data: {
      ...where, externalId: `${sport}-${k}`, leagueId: league.id, startUtc: g.date, status: past ? "FINISHED" : "SCHEDULED",
      homeTeamId: teams[g.home].id, awayTeamId: teams[g.away].id,
      ...(past ? { homeScore: g.homeScore, awayScore: g.awayScore, homeReg: g.homeReg, awayReg: g.awayReg, homeSeg: g.homeSeg, awaySeg: g.awaySeg, extraTime: g.extraTime,
        ...(g.homeFirst != null ? { homeFirst: g.homeFirst, awayFirst: g.awayFirst } : {}) } : {}),
    } });
    await db.marketLine.createMany({ data: [
      { gameId: row.id, market: "total", line: g.book.total, priceA: g.prices?.total[0], priceB: g.prices?.total[1], bookmaker: "Demo book", fetchedAt: new Date(g.date.getTime() - DAY) },
      { gameId: row.id, market: "spread", line: g.book.spread, priceA: g.prices?.spread[0], priceB: g.prices?.spread[1], bookmaker: "Demo book", fetchedAt: new Date(g.date.getTime() - DAY) },
      { gameId: row.id, market: "seg_total", line: g.book.seg, priceA: g.prices?.seg[0], priceB: g.prices?.seg[1], bookmaker: "Demo book", fetchedAt: new Date(g.date.getTime() - DAY) },
      ...(g.prices ? [{ gameId: row.id, market: "moneyline", line: 0, priceA: g.prices.ml[0], priceB: g.prices.ml[1], bookmaker: "Demo book", fetchedAt: new Date(g.date.getTime() - DAY) }] : []),
    ] });
    rows.push(row);
  }

  // Walk-forward demo ledger: last 30 days predicted from data available at the time, locked at T-15.
  const ledgerFrom = now.getTime() - 30 * DAY;
  const finished = rows.filter((r) => r.status === "FINISHED");
  let week = -1, fit = null as ReturnType<typeof fitFor> | null;
  for (const r of finished.filter((x) => x.startUtc.getTime() >= ledgerFrom)) {
    const wk = Math.floor(r.startUtc.getTime() / (7 * DAY));
    const histBefore = finished.filter((x) => x.startUtc < new Date(wk * 7 * DAY));
    if (wk !== week) { fit = fitFor(sport, histBefore.map(toHist), new Date(wk * 7 * DAY)); week = wk; }
    const g = await db.game.findUniqueOrThrow({ where: { id: r.id }, include: { homeTeam: true, awayTeam: true } });
    await writePrediction(db, sport, g, fit!, histBefore, { now: new Date(r.startUtc.getTime() - 3600_000), newsComplete: true, cal: IDENTITY_CAL, residual: 0, strongFloor: 0.65, lockAt: new Date(r.startUtc.getTime() - 15 * 60_000) });
  }
  await settle(db);
  // Upcoming: demo pretends team news is confirmed inside 24h (flag-free), so every band can appear.
  await rateAndPredictLeague(db, sport, league.id, { now, newsComplete: (g) => g.startUtc.getTime() - now.getTime() < DAY });
}
