import Link from "next/link";
import type { SportId } from "@/lib/sports";
import { SPORTS } from "@/lib/sports";
import { getBoard, getLeagues } from "@/lib/queries";
import { dayKey, fmtWat, isDayKey, watDayStart } from "@/lib/time";
import { prisma } from "@/lib/db";
import { dataMode } from "@/lib/mode";
import { SPORT_ENUM } from "@/lib/sports";
import { picksOf, type Pick } from "@/lib/picks";
import { DateNav } from "@/components/DateNav";
import { GameList } from "@/components/GameList";
import { FilterSelect } from "@/components/FilterSelect";
import { EmptyState } from "@/components/EmptyState";
import { PullToRefresh } from "@/components/PullToRefresh";
import { Chip } from "@/components/ui";

const VIEWS = ["best", "win", "total", "spread", "seg"] as const;
type View = (typeof VIEWS)[number];

export default async function Board({ params, searchParams }: { params: Promise<{ sport: SportId }>; searchParams: Promise<{ date?: string; league?: string; view?: string }> }) {
  const { sport } = await params; const sp = await searchParams;
  const cfg = SPORTS[sport];
  const date = isDayKey(sp.date) ? sp.date : dayKey(new Date());
  const view: View = (VIEWS as readonly string[]).includes(sp.view ?? "") ? (sp.view as View) : "best";
  const from = watDayStart(date);
  const [leagues, games] = await Promise.all([getLeagues(sport), getBoard(sport, { from, to: new Date(from.getTime() + 86_400_000), leagueId: sp.league })]);
  const label: Record<View, string> = { best: "All markets", win: "Win", total: "Overs / unders", spread: cfg.handicapName, seg: `${cfg.segmentName} O/U` };
  const focus = new Map<string, Pick | null>();
  let shown = games;
  if (view !== "best") {
    games.forEach((g) => { const p = g.predictions[0]; if (!p) return; const k = picksOf(p); focus.set(g.id, view === "win" ? k.win : view === "total" ? k.total : view === "spread" ? k.spread : k.seg); });
    shown = [...games].sort((a, b) => (focus.get(b.id)?.p ?? 0) - (focus.get(a.id)?.p ?? 0));
  }
  const nextDay = games.length ? null : await (async () => {
    const { source } = await dataMode(sport);
    const g = await prisma.game.findFirst({ where: { sport: SPORT_ENUM[sport], source, startUtc: { gte: new Date(from.getTime() + 86_400_000) }, ...(sp.league ? { leagueId: sp.league } : {}) }, orderBy: { startUtc: "asc" }, select: { startUtc: true } });
    return g ? dayKey(g.startUtc) : null;
  })();
  const q = (o: Record<string, string | undefined>) => "?" + new URLSearchParams(Object.entries({ date, league: sp.league, view, ...o }).filter(([, v]) => v && v !== "best") as [string, string][]).toString();

  return (
    <PullToRefresh>
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">{cfg.name} board</h1>
        <p className="mt-1 text-sm text-slate-400">Win probability, main-line over/under, {cfg.handicapName.toLowerCase()} and {cfg.segmentName.toLowerCase()} total for every game. The strongest main-line pick per game is highlighted.</p>
      </header>
      <Link href={`/${sport}/top`} className="focus-ring glass mb-4 flex items-center justify-between !rounded-xl px-3 py-2 text-sm hover:border-edge/40">
        <span><span className="text-edge">Top 20 tips</span> <span className="text-slate-400">strongest tip per game, today → next 7 days</span></span><span className="text-slate-500">→</span>
      </Link>
      <DateNav active={date} base={`/${sport}`} extra={`${sp.league ? `&league=${sp.league}` : ""}${view !== "best" ? `&view=${view}` : ""}`} />
      {leagues.length > 1 && (
        <div data-no-ptr className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
          <FilterSelect label="League" value={sp.league ?? "all"}
            options={[{ value: "all", label: `All leagues (${leagues.length})`, href: q({ league: undefined }) },
              ...leagues.map((l) => ({ value: l.id, label: l.name, group: l.country ?? undefined, href: q({ league: l.id }) }))]} />
        </div>
      )}
      <div data-no-ptr className="mb-5 flex gap-1.5 overflow-x-auto pb-1">
        {VIEWS.map((v) => <Link key={v} href={q({ view: v })}><Chip active={view === v}>{label[v]}</Chip></Link>)}
      </div>
      {shown.length ? <GameList games={shown} sport={sport} focus={view === "best" ? undefined : focus} />
        : <EmptyState title="No games on this date" body={nextDay ? `Next ${cfg.name.toLowerCase()} games: ${fmtWat(watDayStart(nextDay), "EEEE d MMMM")}.` : `No upcoming ${cfg.name.toLowerCase()} games are stored. The league may be in its off-season.`}
            action={nextDay ? { href: `/${sport}?date=${nextDay}${sp.league ? `&league=${sp.league}` : ""}`, label: "Go to next game day" } : undefined} />}
    </PullToRefresh>
  );
}
