import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getProvider } from "@/lib/providers";
import { ingest } from "@/lib/pipeline/ingest";
import { lockDue, settle, syncResults } from "@/lib/pipeline/ledger";
import { SPORT_IDS, isSport } from "@/lib/sports";

export const maxDuration = 300;
export const dynamic = "force-dynamic";
/**
 * Protected by CRON_SECRET.  On a server the 3-hourly full sync runs as its own process (npm run ingest -- <sport>);
 * this route handles the light jobs:  ?job=lock (every 5 min)  ·  ?job=results (every 15 min, provider called only when a game should have ended).
 * ?sport=… without a job still runs a full sync in-process (for hosts without a separate process).
 */
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url), job = url.searchParams.get("job"), s = url.searchParams.get("sport") ?? "";
  const sports = isSport(s) ? [s] : SPORT_IDS;
  if (job === "lock") return NextResponse.json({ ok: true, locked: await lockDue(prisma) });
  const out: Record<string, unknown> = {};
  for (const sp of sports) {
    const p = await getProvider(sp);
    if (!p) { out[sp] = "demo"; continue; }
    try {
      out[sp] = job === "results" ? { results: await syncResults(prisma, p), settled: await settle(prisma, sp) } : await ingest(prisma, p);
    } catch (e) { out[sp] = { error: (e as Error).message }; }
  }
  return NextResponse.json({ ok: true, ...out });
}
