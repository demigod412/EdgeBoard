import "server-only";
import type { MarketLine, Prisma } from "@prisma/client";
import { prisma } from "./db";
import { dataMode } from "./mode";
import { SPORT_ENUM, type SportId } from "./sports";
import type { PredictionSource } from "./picks";

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
const latestPrediction = { orderBy: [{ lockedAt: { sort: "desc" as const, nulls: "last" as const } }, { revision: "desc" as const }], take: 1 };

/** Everything, for ONE game. Only the game page should use this — see attachLatestPredictions for why. */
export const gameInclude = {
  homeTeam: true, awayTeam: true, league: true,
  predictions: latestPrediction,
} satisfies Prisma.GameInclude;

/** A game's own relations. No predictions: those are attached separately, deliberately. */
export const gameBaseInclude = { homeTeam: true, awayTeam: true, league: true } satisfies Prisma.GameInclude;

/*
 * ── Why the latest prediction is fetched separately ────────────────────────────────────────────────
 *
 * The obvious way to write this is `include: { predictions: { orderBy: [...], take: 1 } }`, and that is
 * what every list here used to do. It is a trap at any scale where a game has more than a couple of
 * revisions.
 *
 * Prisma cannot express "the newest row per parent" in SQL through a nested take, so it does not try. It
 * issues `SELECT <every column> FROM "Prediction" WHERE "gameId" IN ($1..$323)` — no ORDER BY, no LIMIT —
 * pulls EVERY revision of EVERY game into its query engine, and performs the ordering and the take: 1
 * there, in memory.
 *
 * Measured on a scanner showing 323 games at 23 revisions each: the SQL took 2.0 seconds and the whole
 * request took 121. The other 119 seconds were the engine sorting and slicing ~7,400 rows it should never
 * have fetched. It is invisible from the JS side — the heap stayed at 73MB, because the rows were never in
 * V8 — and invisible in the query log, because the one statement looks cheap and is.
 *
 * Moving that same fetch into JS does NOT fix it, which was the first attempt here: the rows then cross
 * into V8 and `picks` (2.8KB each, ~21MB across 7,400 rows) gets parsed into objects, which traded 119
 * seconds of engine sorting for an out-of-memory kill. The cost was never where the sorting happened. It
 * was fetching 7,400 rows to use 323 of them.
 *
 * So this does it in two steps. First the winners, selecting only id/gameId/lockedAt/revision — every
 * revision is still scanned, because there is no way to know which is newest without looking, but at
 * about a hundred bytes a row that is under a megabyte and touches no Json. Then the full rows for
 * exactly those 323 ids.
 *
 * Two round trips instead of one, and two orders of magnitude less data.
 */
export async function attachLatestPredictions<T extends { id: string }>(games: T[]): Promise<(T & { predictions: PredictionSource[] })[]> {
  if (!games.length) return [];
  const gameIds = games.map((g) => g.id);

  /*
   * Step one picks the winners using four tiny columns. All ~7,400 revisions are still scanned — there is
   * no way to know which is newest without looking — but at roughly a hundred bytes a row that is under a
   * megabyte, and no Json is touched.
   */
  const keys = await prisma.prediction.findMany({
    where: { gameId: { in: gameIds } },
    select: { id: true, gameId: true, lockedAt: true, revision: true },
    orderBy: [{ lockedAt: { sort: "desc", nulls: "last" } }, { revision: "desc" }],
  });
  const winner = new Map<string, string>();
  for (const k of keys) if (!winner.has(k.gameId)) winner.set(k.gameId, k.id);

  /*
   * Step two fetches the full rows for exactly those ids — 323 rows, not 7,400. `omit` rather than a
   * select list, so a column added later is carried automatically.
   */
  const rows = winner.size
    ? await prisma.prediction.findMany({ where: { id: { in: [...winner.values()] } }, omit: HEAVY_JSON })
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));

  return games.map((g) => {
    const id = winner.get(g.id);
    const p = id ? byId.get(id) : undefined;
    return { ...g, predictions: p ? [p] : [] };
  });
}

export type BoardGame = Prisma.GameGetPayload<{ include: typeof gameBaseInclude }> & {
  predictions: PredictionSource[];
  /** Always present, empty unless the caller asked for prices. Uniform so no consumer needs a type guard. */
  lines: MarketLine[];
};

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
  const games = await prisma.game.findMany({
    where: { sport: SPORT_ENUM[sport], source, startUtc: { gte: o.from, lt: o.to }, ...(o.leagueId ? { leagueId: o.leagueId } : {}) },
    include: {
      ...gameBaseInclude,
      // Opt-in, and only the market that asked for it: the upset list needs a price, nothing else does.
      lines: o.moneyline
        ? { where: { market: "moneyline" }, orderBy: { fetchedAt: "desc" }, take: LINE_TAKE_LATEST }
        : { take: 0 },
    },
    orderBy: { startUtc: "asc" },
    take: o.take ?? BOARD_LIMIT,
  });
  return attachLatestPredictions(games);
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
