import { cookies } from "next/headers";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { marketsOf } from "@/lib/picks";
import { hitOf } from "@/lib/markets";
import type { Leg } from "@/lib/slips";
import { SlipWorkshop, type SlipView } from "@/components/SlipWorkshop";

export const metadata = { title: "Slips" };
export const dynamic = "force-dynamic";

export default async function Slips() {
  const jar = await cookies();
  const owner = jar.get("eb_device")?.value;
  const slips = owner ? await prisma.slip.findMany({ where: { ownerKey: owner }, orderBy: { updatedAt: "desc" } }) : [];
  const legsOf = (x: Prisma.JsonValue) => (Array.isArray(x) ? (x as unknown as Leg[]) : []);
  const ids = [...new Set(slips.flatMap((s) => legsOf(s.legs).map((l) => l.gameId)))];
  const games = await prisma.game.findMany({ where: { id: { in: ids } }, include: { predictions: { orderBy: [{ lockedAt: { sort: "desc", nulls: "last" } }, { revision: "desc" }], take: 1 } } });
  const views: SlipView[] = slips.map((s) => ({
    id: s.id, name: s.name, bookingCode: s.bookingCode, bookingUrl: s.bookingUrl, bookingNote: s.bookingNote,
    legs: legsOf(s.legs).map((l) => {
      const g = games.find((x) => x.id === l.gameId), p = g?.predictions[0];
      const m = p ? marketsOf(p).find((x) => x.key === l.market) : undefined;
      const done = g?.status === "FINISHED" && g.homeScore != null;
      const hit = done && m ? hitOf(m, { h: g!.homeScore!, a: g!.awayScore!, hSeg: g!.homeSeg, aSeg: g!.awaySeg, hReg: g!.homeReg, aReg: g!.awayReg, extra: g!.extraTime, hFirst: g!.homeFirst, aFirst: g!.awayFirst }) : null;
      return { ...l, p: m?.p ?? l.p, band: p?.band ?? l.band, started: !!g && g.startUtc <= new Date(), result: done ? `${g!.awayScore}–${g!.homeScore}` : null, hit };
    }),
  }));
  const active = jar.get("eb_slip")?.value;
  return <div><SlipWorkshop slips={views} activeId={views.some((v) => v.id === active) ? active! : views[0]?.id ?? null} /></div>;
}
