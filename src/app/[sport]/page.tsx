import Link from "next/link";
import type { SportId } from "@/lib/sports";
import { SPORTS, leagueLabel } from "@/lib/sports";
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
import { Chip, cn } from "@/components/ui";
import { countViews, gameView, isGameView, GAME_VIEWS, VIEW_LABEL } from "@/lib/gameView";

const VIEWS = ["best", "win", "total", "spread", "seg"] as const;
type View = (typeof VIEWS)[number];

export default async function Board({ params, searchParams }: { params: Promise<{ sport: SportId }>; searchParams: Promise<{ date?: string; league?: string; view?: string; show?: string }> }) {
  const { sport } = await params; const sp = await searchParams;
  const cfg = SPORTS[sport];
  const now = new Date();
  // Upcoming by default: the board's job is the games you can still bet on.
  const show = isGameView(sp.show) ? sp.show : "upcoming";
  const date = isDayKey(sp.date) ? sp.date : dayKey(now);
  const view: View = (VIEWS as readonly string[]).includes(sp.view ?? "") ? (sp.view as View) : "best";
  const from = watDayStart(date);
  const [leagues, games] = await Promise.all([getLeagues(sport), getBoard(sport, { from, to: new Date(from.getTime() + 86_400_000), leagueId: sp.league })]);
  const label: Record<View, string> = { best: "All markets", win: "Win", total: "Overs / unders", spread: cfg.handicapName, seg: `${cfg.segmentName} O/U` };
  // Counted before the market view is applied, so the tab numbers describe the day, not the filter.
  const counts = countViews(games, sport, now);
  const inView = games.filter((g) => gameView(g, sport, now) === show);
  const focus = new Map<string, Pick | null>();
  let shown = inView;
  if (view !== "best") {
    inView.forEach((g) => { const p = g.predictions[0]; if (!p) return; const k = picksOf(p); focus.set(g.id, view === "win" ? k.win : view === "total" ? k.total : view === "spread" ? k.spread : k.seg); });
    shown = [...inView].sort((a, b) => (focus.get(b.id)?.p ?? 0) - (focus.get(a.id)?.p ?? 0));
  }
  const nextDay = games.length ? null : await (async () => {
    const { source } = await dataMode(sport);
    const g = await prisma.game.findFirst({ where: { sport: SPORT_ENUM[sport], source, startUtc: { gte: new Date(from.getTime() + 86_400_000) }, ...(sp.league ? { leagueId: sp.league } : {}) }, orderBy: { startUtc: "asc" }, select: { startUtc: true } });
    return g ? dayKey(g.startUtc) : null;
  })();
  const q = (o: Record<string, string | undefined>) => "?" + new URLSearchParams(Object.entries({ date, league: sp.league, view, show, ...o })
    .filter(([k, v]) => v && v !== "best" && !(k === "show" && v === "upcoming")) as [string, string][]).toString();

  return (
    <PullToRefresh>
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">{cfg.name} board</h1>
        <p className="mt-1 text-sm text-slate-400">Win probability, main-line over/under, {cfg.handicapName.toLowerCase()} and {cfg.segmentName.toLowerCase()} total for every game. The strongest main-line pick per game is highlighted.</p>
      </header>
      <Link href={`/${sport}/top`} className="focus-ring glass mb-4 flex items-center justify-between !rounded-xl px-3 py-2 text-sm hover:border-edge/40">
        <span><span className="text-edge">Top 20 tips</span> <span className="text-slate-400">strongest tip per game, today → next 7 days</span></span><span className="text-slate-500">→</span>
      </Link>
      <DateNav active={date} base={`/${sport}`} extra={`${sp.league ? `&league=${sp.league}` : ""}${view !== "best" ? `&view=${view}` : ""}${show !== "upcoming" ? `&show=${show}` : ""}`} />
      <div data-no-ptr className="mb-3 inline-flex rounded-xl border hairline p-1">
        {GAME_VIEWS.map((v) => (
          <Link key={v} href={q({ show: v })} aria-current={show === v ? "page" : undefined}
            className={cn("focus-ring rounded-lg px-3 py-1.5 text-sm transition-colors duration-200", show === v ? "bg-edge text-ink-950" : "text-slate-300 hover:text-slate-100")}>
            {VIEW_LABEL[v]}
            <span className={cn("num ml-1.5 text-[11px]", show === v ? "text-ink-950/60" : "text-slate-500")}>{counts[v]}</span>
            {v === "live" && counts.live > 0 && <span aria-hidden className="ml-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-miss align-middle" />}
          </Link>
        ))}
      </div>
      {counts.off > 0 && (
        <p className="mb-3 text-[11px] text-slate-500">{counts.off} postponed or cancelled on this date, not shown in any tab.</p>
      )}
      {leagues.length > 1 && (
        <div data-no-ptr className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
          <FilterSelect label="League" value={sp.league ?? "all"}
            options={[{ value: "all", label: `All leagues (${leagues.length})`, href: q({ league: undefined }) },
              ...leagues.map((l) => ({ value: l.id, label: leagueLabel(l), href: q({ league: l.id }) }))]} />
        </div>
      )}
      <div data-no-ptr className="mb-5 flex gap-1.5 overflow-x-auto pb-1">
        {VIEWS.map((v) => <Link key={v} href={q({ view: v })}><Chip active={view === v}>{label[v]}</Chip></Link>)}
      </div>
      {shown.length ? <GameList games={shown} sport={sport} focus={view === "best" ? undefined : focus} />
        : games.length
          // The day has games, just none in this tab — say what it does have and link straight there.
          ? <EmptyState title={`No ${VIEW_LABEL[show].toLowerCase()} ${cfg.name.toLowerCase()} games on this date`}
              body={`This date has ${GAME_VIEWS.filter((v) => counts[v] > 0).map((v) => `${counts[v]} ${VIEW_LABEL[v].toLowerCase()}`).join(" and ") || "nothing playable"}.`}
              action={(() => { const other = GAME_VIEWS.find((v) => v !== show && counts[v] > 0); return other ? { href: q({ show: other }), label: `Show ${VIEW_LABEL[other].toLowerCase()}` } : undefined; })()} />
          : <EmptyState title="No games on this date" body={nextDay ? `Next ${cfg.name.toLowerCase()} games: ${fmtWat(watDayStart(nextDay), "EEEE d MMMM")}.` : `No upcoming ${cfg.name.toLowerCase()} games are stored. The league may be in its off-season.`}
              action={nextDay ? { href: `/${sport}?date=${nextDay}${sp.league ? `&league=${sp.league}` : ""}`, label: "Go to next game day" } : undefined} />}
    </PullToRefresh>
  );
}
