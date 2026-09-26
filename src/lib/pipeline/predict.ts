import type { Prisma, PrismaClient, Game } from "@prisma/client";
import { fitNormal } from "../model/normalModel";
import { fitCount } from "../model/countModel";
import { predictGame, IDENTITY_CAL, type Calibrators, type Fit } from "../model/predict";
import { MODEL_VERSION } from "../model/constants";
import { DAY, type HistGame } from "../model/common";
import { SPORT_ENUM, type SportId } from "../sports";
import type { Calibrator } from "../model/calibration";

const LOCK_MIN = Number(process.env.PREDICTION_LOCK_MINUTES ?? 15);

export async function loadCalibrators(db: PrismaClient, sport: SportId): Promise<{ cal: Calibrators; residual: number }> {
  const rows = await db.calibrationModel.findMany({ where: { sport: SPORT_ENUM[sport], modelVersion: MODEL_VERSION, active: true } });
  const by = (m: string): Calibrator => { const r = rows.find((x) => x.market === m); return r ? { method: r.method as Calibrator["method"], n: r.n, knots: r.knots as [number, number][] } : IDENTITY_CAL.win; };
  const cal = { win: by("win"), total: by("total"), spread: by("spread"), seg: by("seg_total") };
  const ks = Object.values(cal).flatMap((c) => c.knots);
  return { cal, residual: ks.reduce((s, [x, y]) => s + Math.abs(y - x), 0) / (ks.length || 1) };
}

export const toHist = (g: Game): HistGame => ({
  homeId: g.homeTeamId, awayId: g.awayTeamId, date: g.startUtc, homeScore: g.homeScore!, awayScore: g.awayScore!,
  homeReg: g.homeReg, awayReg: g.awayReg, homeSeg: g.homeSeg, awaySeg: g.awaySeg, extraTime: g.extraTime,
});

export function fitFor(sport: SportId, hist: HistGame[], asOf: Date): Fit {
  return sport === "basketball" ? fitNormal(hist, asOf) : fitCount(sport, hist, asOf);
}

/** Prediction row data (shared by the live pipeline and the demo seeder). */
export async function writePrediction(db: PrismaClient, sport: SportId, game: Game & { homeTeam: { name: string; shortName: string | null }; awayTeam: { name: string; shortName: string | null } },
  fit: Fit, hist: Game[], opts: { now: Date; newsComplete: boolean; cal: Calibrators; residual: number; strongFloor: number; lockAt?: Date }) {
  const prev = await db.prediction.findFirst({ where: { gameId: game.id }, orderBy: { revision: "desc" } });
  if (prev?.lockedAt) return null;
  const line = async (m: string) => (await db.marketLine.findFirst({ where: { gameId: game.id, market: m }, orderBy: { fetchedAt: "desc" } }))?.line;
  const last = (tid: string) => hist.filter((g) => (g.homeTeamId === tid || g.awayTeamId === tid) && g.startUtc < game.startUtc).sort((a, b) => b.startUtc.getTime() - a.startUtc.getTime());
  const form = (tid: string) => last(tid).slice(0, 5).map((g) => { const me = g.homeTeamId === tid ? g.homeScore! : g.awayScore!, op = g.homeTeamId === tid ? g.awayScore! : g.homeScore!; return me > op ? "W" : "L"; }).join("");
  const rest = (tid: string) => { const l = last(tid)[0]; return l ? Math.round((game.startUtc.getTime() - l.startUtc.getTime()) / DAY) : null; };
  const out = predictGame({
    sport, fit, homeId: game.homeTeamId, awayId: game.awayTeamId,
    homeName: game.homeTeam.shortName ?? game.homeTeam.name, awayName: game.awayTeam.shortName ?? game.awayTeam.name, start: game.startUtc,
    restHomeDays: rest(game.homeTeamId), restAwayDays: rest(game.awayTeamId), newsComplete: opts.newsComplete,
    book: { total: await line("total"), spread: await line("spread"), seg: await line("seg_total") },
    cal: opts.cal, calResidual: opts.residual, strongFloor: opts.strongFloor, formHome: form(game.homeTeamId), formAway: form(game.awayTeamId),
  });
  if (prev && prev.inputsHash === out.inputsHash) return null;
  const { picks, ladders, features, rationale, dataFlags, ...rest_ } = out;
  return db.prediction.create({ data: {
    ...rest_, gameId: game.id, sport: SPORT_ENUM[sport], revision: (prev?.revision ?? 0) + 1, generatedAt: opts.now,
    lockedAt: opts.lockAt ?? null, dataFlags,
    picks: picks as unknown as Prisma.InputJsonValue, ladders: ladders as unknown as Prisma.InputJsonValue,
    features: features as Prisma.InputJsonValue, rationale,
  } });
}

export async function rateAndPredictLeague(db: PrismaClient, sport: SportId, leagueId: string, opts: { now?: Date; newsComplete?: (g: Game) => boolean; strongFloor?: number } = {}) {
  const now = opts.now ?? new Date();
  const hist = await db.game.findMany({ where: { leagueId, status: "FINISHED", homeScore: { not: null }, startUtc: { gte: new Date(now.getTime() - 400 * DAY), lt: now } } });
  const fit = fitFor(sport, hist.map(toHist), now);
  const params = fit.kind === "normal"
    ? { mu: fit.mu, home: fit.home, sigmaM: fit.sigmaM, sigmaT: fit.sigmaT, segShare: fit.segShare, segSigmaRatio: fit.segSigmaRatio, volatility: fit.volatility, n: fit.n }
    : { base: fit.base, home: fit.home, dispersion: fit.dispersion, segShare: fit.segShare, tieHomeWin: fit.tieHomeWin, extraRate: fit.extraRate, enTransfer: fit.enTransfer, volatility: fit.volatility, n: fit.n };
  await db.league.update({ where: { id: leagueId }, data: { params } });
  if (fit.teams.size) await db.teamRating.createMany({ data: [...fit.teams].map(([teamId, t]) => ({
    teamId, asOf: now, modelVersion: MODEL_VERSION,
    offense: "o" in t ? t.o : t.attack, defense: "d" in t ? t.d : t.defence, sampleWeight: t.sampleWeight, games: t.games })) });
  const { cal, residual } = await loadCalibrators(db, sport);
  // Nothing is (re)predicted inside the lock window: from start − 15 min the locked call is final.
  const upcoming = await db.game.findMany({ where: { leagueId, status: "SCHEDULED", startUtc: { gt: new Date(now.getTime() + LOCK_MIN * 60_000), lte: new Date(now.getTime() + 8 * DAY) } }, include: { homeTeam: true, awayTeam: true } });
  let written = 0;
  for (const g of upcoming) if (await writePrediction(db, sport, g, fit, hist, { now, newsComplete: opts.newsComplete?.(g) ?? false, cal, residual, strongFloor: opts.strongFloor ?? 0.65 })) written++;
  // `games` is FINISHED history used for the fit; `upcoming` is what is stored ahead. Reporting only
  // the first two made "no fixtures from the provider" indistinguishable from "stored but not
  // predicted", which cost a round of guessing on the WNBA playoffs.
  return { games: hist.length, upcoming: upcoming.length, predictions: written };
}
