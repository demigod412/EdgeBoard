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
  /*
   * Nearest day that actually has games for this filter, looking forward first and then back.
   *
   * Looking only forward stranded any competition whose season has ended: the WNBA has 345 stored
   * games and not one in the future, so the board showed "no games" with nothing to click. Jumping
   * backwards also switches the tab to Finished, because every game on a past day is finished and
   * landing on an empty Upcoming tab would be the same dead end one date further on.
   */
  const { source: src } = await dataMode(sport);
  const nearest = games.length ? null : await (async () => {
    const where = { sport: SPORT_ENUM[sport], source: src, ...(sp.league ? { leagueId: sp.league } : {}) };
    const ahead = await prisma.game.findFirst({
      where: { ...where, startUtc: { gte: new Date(from.getTime() + 86_400_000) } },
      orderBy: { startUtc: "asc" }, select: { startUtc: true },
    });
    if (ahead) return { day: dayKey(ahead.startUtc), dir: "next" as const };
    const behind = await prisma.game.findFirst({
      where: { ...where, startUtc: { lt: from } },
      orderBy: { startUtc: "desc" }, select: { startUtc: true },
    });
    return behind ? { day: dayKey(behind.startUtc), dir: "prev" as const } : null;
  })();
  const jump = nearest
    ? { href: `/${sport}?date=${nearest.day}${sp.league ? `&league=${sp.league}` : ""}${nearest.dir === "prev" ? "&show=finished" : ""}`,
        label: nearest.dir === "next" ? "Go to next game day" : "Go to the last game day" }
    : undefined;
  const q = (o: Record<string, string | undefined>) => "?" + new URLSearchParams(Object.entries({ date, league: sp.league, view, show, ...o })
    .filter(([k, v]) => v && v !== "best" && !(k === "show" && v === "upcoming")) as [string, string][]).toString();
  /*
   * Which leagues still have games ahead, and when each last played. Two grouped queries for the whole
   * sport rather than one per league. Without this, choosing a competition whose season has ended kept
   * today's date and showed an empty board — the WNBA has 345 stored games and looked broken.
   */
  const [aheadRows, behindRows] = await Promise.all([
    prisma.game.groupBy({ by: ["leagueId"], where: { sport: SPORT_ENUM[sport], source: src, startUtc: { gte: now } }, _count: { _all: true } }),
    prisma.game.groupBy({ by: ["leagueId"], where: { sport: SPORT_ENUM[sport], source: src, startUtc: { lt: now } }, _max: { startUtc: true } }),
  ]);
  const hasAhead = new Set(aheadRows.map((r) => r.leagueId));
  const lastPlayed = new Map(behindRows.flatMap((r) => (r._max.startUtc ? [[r.leagueId, r._max.startUtc] as const] : [])));
  /** Where picking this league should take you: its own last game day once its season is over. */
  const leagueHref = (id: string) => {
    if (hasAhead.has(id)) return q({ league: id });                    // still playing: keep the date
    const last = lastPlayed.get(id);
    return last ? q({ league: id, date: dayKey(last), show: "finished" }) : q({ league: id });
  };

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
              ...leagues.map((l) => ({
                value: l.id,
                // Marked so a competition between seasons is obviously that, not obviously broken.
                label: hasAhead.has(l.id) ? leagueLabel(l) : `${leagueLabel(l)} · ended`,
                href: leagueHref(l.id),
              }))]} />
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
          : <EmptyState title="No games on this date"
              body={nearest?.dir === "next" ? `Next ${cfg.name.toLowerCase()} games: ${fmtWat(watDayStart(nearest.day), "EEEE d MMMM")}.`
                : nearest?.dir === "prev" ? `Nothing scheduled ahead for this selection — its season looks finished. The last games were on ${fmtWat(watDayStart(nearest.day), "EEEE d MMMM")}.`
                : `No ${cfg.name.toLowerCase()} games are stored for this selection yet. They appear after the next sync.`}
              action={jump} />}
    </PullToRefresh>
  );
}
