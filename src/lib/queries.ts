import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { dataMode } from "./mode";
import { SPORT_ENUM, type SportId } from "./sports";

export const gameInclude = {
  homeTeam: true, awayTeam: true, league: true,
  predictions: { orderBy: [{ lockedAt: { sort: "desc", nulls: "last" } }, { revision: "desc" }], take: 1 },
} satisfies Prisma.GameInclude;
export type BoardGame = Prisma.GameGetPayload<{ include: typeof gameInclude }>;

export async function getBoard(sport: SportId, o: { from: Date; to: Date; leagueId?: string }) {
  const { source } = await dataMode(sport);
  return prisma.game.findMany({
    where: { sport: SPORT_ENUM[sport], source, startUtc: { gte: o.from, lt: o.to }, ...(o.leagueId ? { leagueId: o.leagueId } : {}) },
    include: gameInclude, orderBy: { startUtc: "asc" },
  });
}
export async function getLeagues(sport: SportId) {
  const { source } = await dataMode(sport);
  return prisma.league.findMany({ where: { sport: SPORT_ENUM[sport], source }, orderBy: [{ focus: "desc" }, { name: "asc" }] });
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
