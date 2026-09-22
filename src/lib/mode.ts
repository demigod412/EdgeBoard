import "server-only";
import { cache } from "react";
import type { Source } from "@prisma/client";
import { prisma } from "./db";
import { getProvider } from "./providers";
import { SPORT_ENUM, type SportId } from "./sports";

/** Live when a key exists AND that sport has synced at least once; otherwise the demo set. */
export const dataMode = cache(async (sport: SportId): Promise<{ demo: boolean; source: Source; lastSync: Date | null }> => {
  if (await getProvider(sport)) {
    const l = await prisma.league.findFirst({ where: { sport: SPORT_ENUM[sport], source: "API_SPORTS" }, orderBy: { lastSyncAt: "desc" } });
    if (l?.lastSyncAt) return { demo: false, source: "API_SPORTS", lastSync: l.lastSyncAt };
  }
  const d = await prisma.league.findFirst({ where: { sport: SPORT_ENUM[sport], source: "DEMO" } });
  return { demo: true, source: "DEMO", lastSync: d?.lastSyncAt ?? null };
});
