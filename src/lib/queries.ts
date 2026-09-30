import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { dataMode } from "./mode";
import { SPORT_ENUM, type SportId } from "./sports";

/*
 * ── What a list query must not load ────────────────────────────────────────────────────────────────
 *
 * A Prediction carries four Json blobs. `picks` is read everywhere, through marketsOf(). The other
 * three are not: `ladders` and `rationale` only on a single game page, and `features` nowhere in the UI
 * at all. So lists drop them.
 *
 * `omit` rather than an explicit `select`, so a scalar added later is included automatically instead of
 * going silently missing from every list.
 */
export const HEAVY_JSON = { ladders: true, rationale: true, features: true } as const;
// Not `as const`: that makes orderBy a readonly tuple, which Prisma's mutable OrderByInput[] rejects
// the moment this is spread into an inline include.
const latestPrediction = { orderBy: [{ lockedAt: { sort: "desc" as const, nulls: "last" as const } }, { revision: "desc" as const }], take: 1 };

/** Everything, for one game. Only the game page should use this. */
export const gameInclude = {
  homeTeam: true, awayTeam: true, league: true,
  predictions: latestPrediction,
} satisfies Prisma.GameInclude;

/** The same without the three unread blobs. What every list and board should use. */
export const gameIncludeLean = {
  homeTeam: true, awayTeam: true, league: true,
  predictions: { ...latestPrediction, omit: HEAVY_JSON },
} satisfies Prisma.GameInclude;

export type BoardGame = Prisma.GameGetPayload<{ include: typeof gameIncludeLean }>;

/*
 * ── Why every line query carries a take ────────────────────────────────────────────────────────────
 *
 * MarketLine is append-only: ingest CREATES a row per market per game every run, whether the price moved
 * or not. On an hourly sync a game sitting in the seven-day window accumulates on the order of a hundred
 * rows per market before it is even played, and nothing prunes them.
 *
 * Three pages joined across all of them with no limit — the accuracy page over every locked call ever
 * recorded. That is how one request came to allocate 1.6GB and take the whole machine down with it.
 *
 * What the pages actually want is the newest row before the lock, so a bounded slice of the NEWEST rows
 * is enough: rows arrive in time order, so a suffix of the timeline always contains the lock boundary.
 * The margin here is deliberate — an hourly sync puts at most a row or two after a lock, and these take
 * two orders of magnitude more than that.
 */
/*
 * Two different needs, and they want very different numbers.
 *
 * An UPCOMING game wants the newest price per market — latestLines() with no cutoff returns the first row
 * it sees per market, and rows arrive newest-first. Four markets means four useful rows. Fetching eighty
 * was ~20x waste on the largest queries in the app, and at a 384MB heap ceiling that waste does not show
 * up as an OOM any more; it shows up as ninety seconds of garbage collection.
 *
 * A SETTLED game wants the newest price BEFORE the lock, so it has to reach back past whatever was
 * written after it. An ingest every three hours puts a row or two after a lock, so a dozen per market is
 * already generous.
 */
export const LINE_TAKE_LATEST = Number(process.env.LINE_TAKE_LATEST) || 6;
/** Pre-lock, moneyline only. */
export const LINE_TAKE_PRELOCK = Number(process.env.LINE_TAKE_PRELOCK) || 12;
/** Pre-lock across all four markets, so each still gets a slice. */
export const LINE_TAKE_PRELOCK_ALL = Number(process.env.LINE_TAKE_PRELOCK_ALL) || 40;

/*
 * Games a request may carry, across every sport it covers rather than per sport: "all sports" tripled the
 * three biggest queries at a stroke, which is not what a scope toggle should cost.
 */
export const BOARD_LIMIT = Number(process.env.BOARD_LIMIT) || 600;
/**
 * Games the slip builder searches over.
 *
 * Lower, because the builder multiplies: each game becomes seven-odd candidate legs and the slip search
 * then runs over the lot, three times. Two hundred games is already 1,400 legs, far more than any target
 * the page offers needs.
 */
export const BUILDER_LIMIT = Number(process.env.BUILDER_LIMIT) || 200;
/** Split a whole-request ceiling across the sports in scope. */
export const perSport = (limit: number, sports: number) => Math.max(1, Math.ceil(limit / Math.max(1, sports)));

export async function getBoard(sport: SportId, o: {
  from: Date; to: Date; leagueId?: string; take?: number; moneyline?: boolean;
}) {
  const { source } = await dataMode(sport);
  return prisma.game.findMany({
    where: { sport: SPORT_ENUM[sport], source, startUtc: { gte: o.from, lt: o.to }, ...(o.leagueId ? { leagueId: o.leagueId } : {}) },
    include: {
      ...gameIncludeLean,
      // Opt-in, and only the market that asked for it: the upset list needs a price, nothing else does.
      ...(o.moneyline ? { lines: { where: { market: "moneyline" }, orderBy: { fetchedAt: "desc" }, take: LINE_TAKE_LATEST } } : {}),
    },
    orderBy: { startUtc: "asc" },
    take: o.take ?? BOARD_LIMIT,
  });
}
export async function getLeagues(sport: SportId) {
  const { source } = await dataMode(sport);
  return prisma.league.findMany({ where: { sport: SPORT_ENUM[sport], source }, orderBy: [{ focus: "desc" }, { country: "asc" }, { name: "asc" }] });
}
export async function getGame(id: string) {
  const g = await prisma.game.findUnique({ where: { id }, include: { ...gameInclude, lines: { orderBy: { fetchedAt: "desc" }, take: 40 } } });
  if (!g) return null;
  const last = (tid: string) => prisma.game.findMany({ where: { status: "FINISHED", startUtc: { lt: g.startUtc }, OR: [{ homeTeamId: tid }, { awayTeamId: tid }] }, include: { homeTeam: true, awayTeam: true }, orderBy: { startUtc: "desc" }, take: 10 });
  const [homeLast, awayLast, h2h] = await Promise.all([last(g.homeTeamId), last(g.awayTeamId), prisma.game.findMany({
    where: { status: "FINISHED", startUtc: { lt: g.startUtc }, OR: [{ homeTeamId: g.homeTeamId, awayTeamId: g.awayTeamId }, { homeTeamId: g.awayTeamId, awayTeamId: g.homeTeamId }] },
    include: { homeTeam: true, awayTeam: true }, orderBy: { startUtc: "desc" }, take: 6 })]);
  return { g, homeLast, awayLast, h2h };
}
