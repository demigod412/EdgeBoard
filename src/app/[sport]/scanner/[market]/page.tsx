import { notFound } from "next/navigation";
import Link from "next/link";
import { getBoard } from "@/lib/queries";
import { SCANNERS, scan, DEFAULT_FLOORS, type Floors, type Pick, type ScannerSlug } from "@/lib/picks";
import { getSetting } from "@/lib/secrets";
import { prisma } from "@/lib/db";
import { latestLines, valueTips } from "@/lib/value";
import { marketsOf } from "@/lib/picks";
import { BlendBuilder, type BlendCandidate } from "@/components/BlendBuilder";
import { fmtWat } from "@/lib/time";
import { SPORTS, type SportId } from "@/lib/sports";
import { GameList } from "@/components/GameList";
import { EmptyState } from "@/components/EmptyState";

export default async function Scanner({ params }: { params: Promise<{ sport: SportId; market: string }> }) {
  const { sport, market } = await params;
  const def = SCANNERS.find((s) => s.slug === market); if (!def) notFound();
  const cfg = SPORTS[sport];
  const floors = { ...DEFAULT_FLOORS, ...(await getSetting<Partial<Floors>>("floors", {})) };
  const now = new Date();
  const games = (await getBoard(sport, { from: now, to: new Date(now.getTime() + 7 * 86_400_000) })).filter((g) => g.predictions[0]);
  const focus = new Map<string, Pick | null>();
  if (def.slug === "blend") {
    const cands: BlendCandidate[] = games.map((g) => ({
      id: g.id, title: `${g.awayTeam.shortName ?? g.awayTeam.name} at ${g.homeTeam.shortName ?? g.homeTeam.name}`, when: fmtWat(g.startUtc, "EEE HH:mm"), band: g.predictions[0].band,
      markets: marketsOf(g.predictions[0]).filter((m) => m.p >= 0.05).map((m) => ({ key: m.key, label: m.short, p: m.p, group: m.group })),
    }));
    return (
      <>
        <header className="mb-4">
          <Link href={`/${sport}/scanner`} className="text-xs text-slate-400 hover:text-slate-200">Scanners</Link>
          <h1 className="text-2xl font-semibold tracking-tight">Blend <span className="num text-base text-slate-500">{cands.length}</span></h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">{def.blurb}</p>
        </header>
        {cands.length ? <BlendBuilder candidates={cands} /> : <EmptyState title="No upcoming games" body="Nothing is scheduled in the next 7 days for this sport." />}
      </>
    );
  }
  // Upset watch: underdog moneyline where the model gives ≥ 5% edge over the bookmaker price
  const upsetLines = def.slug === "upset" ? await prisma.marketLine.findMany({ where: { gameId: { in: games.map((g) => g.id) } }, orderBy: { fetchedAt: "desc" } }) : [];
  const upset = (g: (typeof games)[number]): Pick | null => {
    const v = valueTips(g.predictions[0], latestLines(upsetLines.filter((l) => l.gameId === g.id))).find((t) => t.kind === "win" && t.p < 0.5 && t.edge >= 0.05);
    return v ? { market: "win", side: v.side, line: null, p: v.p, label: `${v.label} @${v.odds.toFixed(2)} (+${Math.round(v.edge * 100)}%)` } : null;
  };
  const hits = games.filter((g) => { const k = def.slug === "upset" ? upset(g) : scan(def.slug as ScannerSlug, g.predictions[0], floors); focus.set(g.id, k); return !!k; })
    .sort((a, b) => focus.get(b.id)!.p - focus.get(a.id)!.p);
  const rename = (s: string) => s.replace("Handicap", cfg.handicapName).replace("Segment", cfg.segmentName).replace("segment", cfg.segmentName.toLowerCase());
  return (
    <>
      <header className="mb-4">
        <Link href={`/${sport}/scanner`} className="text-xs text-slate-400 hover:text-slate-200">Scanners</Link>
        <h1 className="text-2xl font-semibold tracking-tight">{rename(def.name)} <span className="num text-base text-slate-500">{hits.length}</span></h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">{rename(def.blurb)}{def.slug.startsWith("strong") ? ` Strong floor: ${Math.round(floors.strong * 100)}%.` : def.slug === "safe" ? ` Safe floor: ${Math.round(floors.safe * 100)}%.` : ""}</p>
      </header>
      {hits.length ? <GameList games={hits} sport={sport} focus={focus} />
        : <EmptyState title="Nothing qualifies in the next 7 days" body="No game clears this scanner right now. That is a valid answer; lowering a floor in Settings trades accuracy for volume." action={{ href: "/settings", label: "Adjust floors" }} />}
    </>
  );
}
