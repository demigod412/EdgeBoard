import Link from "next/link";
import type { Source } from "@prisma/client";
import { prisma } from "@/lib/db";
import { dataMode } from "@/lib/mode";
import { gameInclude } from "@/lib/queries";
import { selectTop, tipsFor, TOP_N, WINDOWS, type Tip } from "@/lib/top";
import { flatStakeRoi, latestLines, selectTopValue, valueTips, VALUE, type ValueTip } from "@/lib/value";
import { GROUP_LABEL, hitOf, TOP_CAPS, type Group } from "@/lib/markets";
import { SPORTS, SPORT_ENUM, SPORT_IDS, type SportId } from "@/lib/sports";
import { dayKey, fmtUtc, fmtWat, watDayStart } from "@/lib/time";
import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { FilterSelect } from "@/components/FilterSelect";
import { EmptyState } from "@/components/EmptyState";
import { PullToRefresh } from "@/components/PullToRefresh";
import { AddToSlip } from "@/components/AddToSlip";
import { Card, Chip, SectionTitle, cn, pct } from "@/components/ui";

export const metadata = { title: "Top 20 tips" };
export const dynamic = "force-dynamic";
const DAY = 86_400_000;
const GROUPS: Group[] = ["win", "total", "spread", "seg", "team", "props"];
const windowLabel = (d: number) => (d === 1 ? "Today" : `Next ${d} days`);

export default async function Top({ params, searchParams }: { params: Promise<{ sport: SportId }>; searchParams: Promise<{ days?: string; scope?: string; market?: string; list?: string }> }) {
  const { sport } = await params; const sp = await searchParams;
  const days = WINDOWS.includes(Number(sp.days) as never) ? Number(sp.days) : 1;
  const all = sp.scope === "all";
  const group = GROUPS.includes(sp.market as Group) ? (sp.market as Group) : undefined;
  const list: "likely" | "value" = sp.list === "value" ? "value" : "likely";
  const sports = all ? SPORT_IDS : [sport];
  const sources = Object.fromEntries(await Promise.all(sports.map(async (s) => [s, (await dataMode(s)).source] as const))) as Record<SportId, Source>;
  const now = new Date(), todayStart = watDayStart(dayKey(now)), end = new Date(todayStart.getTime() + days * DAY);
  const sportOf = (e: string) => SPORT_IDS.find((s) => SPORT_ENUM[s] === e)!;
  const gname = (g: Group, s: SportId) => (g === "spread" ? SPORTS[s].handicapName : g === "seg" ? SPORTS[s].segmentName : GROUP_LABEL[g]);
  const href = (o: { days?: number; scope?: string | null; market?: string | null; list?: string }) => {
    const q = new URLSearchParams({ days: String(o.days ?? days) });
    const sc = o.scope === null ? undefined : o.scope ?? (all ? "all" : undefined); if (sc) q.set("scope", sc);
    const m = o.market === null ? undefined : o.market ?? group; if (m) q.set("market", m);
    if ((o.list ?? list) === "value") q.set("list", "value");
    return `/${sport}/top?${q}`;
  };

  const games = (await Promise.all(sports.map((s) => prisma.game.findMany({
    where: { sport: SPORT_ENUM[s], source: sources[s], status: "SCHEDULED", startUtc: { gt: now, lt: end } },
    include: { ...gameInclude, lines: { orderBy: { fetchedAt: "desc" }, take: 20 } },
  })))).flat();

  let likely: { g: (typeof games)[number]; t: Tip }[] = [], value: { g: (typeof games)[number]; t: ValueTip }[] = [];
  if (list === "likely") {
    likely = selectTop(games.flatMap((g) => g.predictions[0] ? [{ item: g, id: g.id, startMs: g.startUtc.getTime(), tips: tipsFor(g.predictions[0], group) }] : []), group).map(({ item, tip }) => ({ g: item, t: tip }));
  } else {
    value = selectTopValue(games.flatMap((g) => g.predictions[0] ? [{ item: g, startMs: g.startUtc.getTime(), tips: valueTips(g.predictions[0], latestLines(g.lines)).filter((t) => !group || t.group === group) }] : []))
      .map(({ item, tip }) => ({ g: item, t: tip }));
  }
  const hasOdds = games.some((g) => g.lines.some((l) => l.priceA != null));
  const shown = list === "likely" ? likely.length : value.length;

  // Track record from LOCKED calls only (the call as it stood 15 minutes before start).
  const locked = (await Promise.all(sports.map((s) => prisma.prediction.findMany({
    where: { sport: SPORT_ENUM[s], lockedAt: { not: null }, game: { source: sources[s], startUtc: { gte: new Date(todayStart.getTime() - 7 * DAY), lt: todayStart }, results: { some: {} } } },
    include: { game: { include: { results: { orderBy: { settledAt: "desc" }, take: 1 }, lines: { orderBy: { fetchedAt: "desc" } } } } },
  })))).flat();
  const byDay = new Map<string, typeof locked>();
  locked.forEach((p) => { const k = dayKey(p.game.startUtc); byDay.set(k, [...(byDay.get(k) ?? []), p]); });
  const res = (p: (typeof locked)[number]) => { const r = p.game.results[0]; return { h: r.homeScore, a: r.awayScore, hSeg: r.homeSeg, aSeg: r.awaySeg, hReg: r.hReg, aReg: r.aReg, extra: r.extraTime ?? undefined, hFirst: r.hFirst, aFirst: r.aFirst }; };
  const record = [...byDay.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([day, ps]) => {
    if (list === "likely") {
      const sc = selectTop(ps.map((p) => ({ item: p, id: p.gameId, startMs: p.game.startUtc.getTime(), tips: tipsFor(p, group) })), group)
        .map(({ item, tip }) => ({ tip, hit: hitOf(tip, res(item)) })).filter((x) => x.hit != null);
      return { day, n: sc.length, hits: sc.filter((x) => x.hit).length, avgP: sc.reduce((s, x) => s + x.tip.p, 0) / (sc.length || 1), profit: 0 };
    }
    const sc = selectTopValue(ps.map((p) => ({ item: p, startMs: p.game.startUtc.getTime(), tips: valueTips(p, latestLines(p.game.lines, p.lockedAt!)).filter((t) => !group || t.group === group) })))
      .map(({ item, tip }) => ({ tip, hit: hitOf(tip, res(item)) })).filter((x) => x.hit != null);
    const r = flatStakeRoi(sc.map((x) => ({ odds: x.tip.odds, hit: !!x.hit })));
    return { day, n: r.n, hits: r.hits, avgP: sc.reduce((s, x) => s + x.tip.p, 0) / (sc.length || 1), profit: r.profit };
  }).filter((r) => r.n);
  const tot = record.reduce((s, r) => ({ n: s.n + r.n, h: s.h + r.hits, p: s.p + r.avgP * r.n, profit: s.profit + r.profit }), { n: 0, h: 0, p: 0, profit: 0 });

  const row = (g: (typeof games)[number], i: number, label: string, grp: string, p: number, right: React.ReactNode, key: string) => {
    const s = sportOf(g.sport);
    return (
      <li key={g.id} className="flex items-center">
        <Link href={`/${s}/game/${g.id}`} className="focus-ring grid min-w-0 flex-1 grid-cols-[2rem_1fr_auto] items-center gap-3 rounded-xl px-3 py-3 transition-colors duration-200 hover:bg-white/[0.04] md:grid-cols-[2.5rem_7rem_1fr_auto]">
          <span className={cn("num text-lg font-semibold", i < 3 ? "text-edge" : "text-slate-500")}>{i + 1}</span>
          <span className="hidden leading-tight md:block"><span className="num block text-sm text-slate-200">{fmtWat(g.startUtc, "EEE HH:mm")}</span><span className="num block text-[10px] text-slate-500">{fmtUtc(g.startUtc)} UTC</span></span>
          <span className="min-w-0">
            <span className="block truncate text-sm text-slate-100">{g.awayTeam.shortName ?? g.awayTeam.name} at {g.homeTeam.shortName ?? g.homeTeam.name}</span>
            <span className="block truncate text-[11px] text-slate-500"><span className="num md:hidden">{fmtWat(g.startUtc, "EEE HH:mm")} · </span>{all && <span style={{ color: SPORTS[s].accent }}>{SPORTS[s].name} · </span>}{g.league.name}</span>
            <span className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-edge/40 bg-edge/10 px-1.5 py-0.5 text-xs text-edge"><span className="text-[10px] text-edge/70">{grp}</span>{label}</span>
          </span>
          <span className="flex flex-col items-end gap-1"><span className="num text-xl font-semibold text-slate-50">{pct(p)}</span>{right}</span>
        </Link>
        <AddToSlip gameId={g.id} market={key} className="mr-3" />
      </li>
    );
  };

  return (
    <PullToRefresh>
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Top 20 tips</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">
          {list === "likely"
            ? <>The strongest single tip per game across win, totals, handicaps, first-segment totals, team totals and specials, ranked by probability with a small boost for confidence. Medium/High only. Mixed list limits: {TOP_CAPS.filter((c) => c.max > 0).map((c) => `≤ ${c.max} ${c.name}`).join(", ")}; never &ldquo;no overtime&rdquo;. A 75% tip still loses one time in four.</>
            : <>Tips where the model rates the outcome more likely than the bookmaker&apos;s price implies (edge = probability × odds − 1). Odds {VALUE.minOdds.toFixed(2)}–{VALUE.maxOdds.toFixed(2)}, probability ≥ {Math.round(VALUE.minP * 100)}%, edge ≥ {Math.round(VALUE.minEdge * 100)}%. Value tips lose more often; the point is the price.</>}
        </p>
      </header>
      <div data-no-ptr className="mb-3 inline-flex rounded-xl border hairline p-1">
        {(["likely", "value"] as const).map((l) => <Link key={l} href={href({ list: l })} className={cn("rounded-lg px-3 py-1.5 text-sm", list === l ? "bg-edge text-ink-950" : "text-slate-300")}>{l === "likely" ? "Most likely" : "Best value"}</Link>)}
      </div>
      <div data-no-ptr className="mb-3 flex gap-1.5">
        <Link href={href({ scope: null })}><Chip active={!all}>{SPORTS[sport].name} only</Chip></Link>
        <Link href={href({ scope: "all" })}><Chip active={all}>All sports</Chip></Link>
      </div>
      <nav data-no-ptr aria-label="Time window" className="-mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
        {WINDOWS.map((d) => <Link key={d} href={href({ days: d })}><Chip active={d === days}>{windowLabel(d)}</Chip></Link>)}
      </nav>
      <div data-no-ptr className="mb-5 max-w-xs">
        <FilterSelect label="Market" value={group ?? "all"}
          options={[{ value: "all", label: "All markets", href: href({ market: null }) }, ...GROUPS.map((g) => ({ value: g, label: all ? GROUP_LABEL[g] : gname(g, sport), href: href({ market: g }) }))]} />
      </div>

      {shown === 0 ? (
        <EmptyState title={list === "value" && !hasOdds ? "No bookmaker prices yet" : `No qualifying tips ${days === 1 ? "left today" : "in this window"}`}
          body={list === "value" && !hasOdds ? "The value list needs bookmaker odds. They are fetched for games in the next 36 hours; check back closer to the games." : "No upcoming game in this window qualifies. Try a longer window or All sports."}
          action={days < 7 ? { href: href({ days: Math.min(7, days + 1) }), label: `Show ${windowLabel(Math.min(7, days + 1)).toLowerCase()}` } : undefined} />
      ) : (
        <ol className="glass divide-y divide-white/[0.05] px-1 py-1">
          {list === "likely"
            ? likely.map(({ g, t }, i) => row(g, i, t.label, gname(t.group, sportOf(g.sport)), t.p, <><ConfidenceBadge band={g.predictions[0].band} /><span className="num text-[10px] text-slate-500">fair odds {(1 / t.p).toFixed(2)}</span></>, t.key))
            : value.map(({ g, t }, i) => row(g, i, t.label, gname(t.group, sportOf(g.sport)), t.p, <><span className="num text-xs text-edge">edge +{Math.round(t.edge * 100)}%</span><span className="num text-[10px] text-slate-500">odds {t.odds.toFixed(2)} · fair {t.fair.toFixed(2)}</span></>, t.key))}
        </ol>
      )}

      <Card className="mt-6">
        <SectionTitle aside="last 7 days · locked calls only">{list === "likely" ? "Top 20 track record" : "Value list track record"}</SectionTitle>
        {record.length === 0 ? <p className="text-sm text-slate-400">Fills in as locked calls are settled. Each day&apos;s list is rebuilt from the calls locked 15 minutes before start.</p> : (
          <>
            <p className="mb-3 text-sm text-slate-300"><span className="num text-slate-50">{tot.h}/{tot.n}</span> won ({pct(tot.h / tot.n)}) against an average model probability of <span className="num">{pct(tot.p / tot.n)}</span>.
              {list === "value" && <> Flat 1-unit stakes at the pre-lock odds: <span className={cn("num", tot.profit >= 0 ? "text-edge" : "text-miss")}>{tot.profit >= 0 ? "+" : ""}{tot.profit.toFixed(2)} units</span> (ROI {pct(tot.profit / tot.n)}).</>}</p>
            <table className="num w-full text-xs">
              <thead className="text-slate-500"><tr><th className="text-left font-normal">Day</th><th className="font-normal">Tips</th><th className="font-normal">Won</th><th className="font-normal">Rate</th><th className="font-normal">Avg p</th>{list === "value" && <th className="font-normal">Profit</th>}</tr></thead>
              <tbody>{record.map((r) => (
                <tr key={r.day} className="border-t hairline"><td className="py-1.5">{r.day}</td><td className="text-center">{r.n}</td><td className="text-center">{r.hits}</td>
                  <td className={cn("text-center", r.hits / r.n >= r.avgP - 0.05 ? "text-edge" : "text-miss")}>{pct(r.hits / r.n)}</td><td className="text-center text-slate-400">{pct(r.avgP)}</td>
                  {list === "value" && <td className={cn("text-center", r.profit >= 0 ? "text-edge" : "text-miss")}>{r.profit.toFixed(2)}</td>}</tr>
              ))}</tbody>
            </table>
            <p className="mt-2 text-[11px] text-slate-500">Up to {TOP_N} per day. Full history: <Link href={`/${sport}/accuracy`} className="underline underline-offset-2">Accuracy</Link>.</p>
          </>
        )}
      </Card>
    </PullToRefresh>
  );
}
