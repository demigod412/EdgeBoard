import Link from "next/link";
import type { Source } from "@prisma/client";
import { prisma } from "@/lib/db";
import { dataMode } from "@/lib/mode";
import { gameInclude } from "@/lib/queries";
import { marketsOf } from "@/lib/picks";
import { GROUP_LABEL, hitOf, type Group } from "@/lib/markets";
import { buildSlips, legHint, oneInN, SAFE_MAX_LEG_ODDS, type Candidate } from "@/lib/builder";
import { latestLines, oddsFor } from "@/lib/value";
import { SPORTS, SPORT_ENUM, SPORT_IDS, leagueLabel, type SportId } from "@/lib/sports";
import { dayKey, fmtWat } from "@/lib/time";
import { BuilderResult } from "@/components/BuilderResult";
import { FilterSelect } from "@/components/FilterSelect";
import { EmptyState } from "@/components/EmptyState";
import { Card, Chip, SectionTitle, cn, pct } from "@/components/ui";

export const metadata = { title: "Odds builder" };
export const dynamic = "force-dynamic";
const DAY = 86_400_000;
const TARGETS = [3, 5, 10, 30, 100];
const WINDOWS: [number, string][] = [[1, "Today"], [2, "Next 2 days"], [3, "Next 3 days"], [7, "This week"], [14, "Next 14 days"]];

export default async function Builder({ params, searchParams }: {
  params: Promise<{ sport: SportId }>;
  searchParams: Promise<{ target?: string; days?: string; mode?: string; legs?: string; scope?: string }>;
}) {
  const { sport } = await params; const sp = await searchParams;
  const target = Math.min(1000, Math.max(1.2, Number(sp.target) || 5));
  const days = WINDOWS.some(([d]) => d === Number(sp.days)) ? Number(sp.days) : 2;
  const mode: "value" | "safe" = sp.mode === "safe" ? "safe" : "value";
  const maxLegs = Math.min(15, Math.max(2, Number(sp.legs) || 12));
  const all = sp.scope === "all";
  const sports = all ? SPORT_IDS : [sport];
  const href = (o: Partial<{ target: number; days: number; mode: string; legs: number; scope: string | null }>) => {
    const q = new URLSearchParams({ target: String(o.target ?? target), days: String(o.days ?? days), mode: o.mode ?? mode, legs: String(o.legs ?? maxLegs) });
    const sc = o.scope === null ? undefined : o.scope ?? (all ? "all" : undefined); if (sc) q.set("scope", sc);
    return `/${sport}/builder?${q}`;
  };

  const now = new Date(), end = new Date(now.getTime() + days * DAY);
  const sources = Object.fromEntries(await Promise.all(sports.map(async (s) => [s, (await dataMode(s)).source] as const))) as Record<SportId, Source>;
  const games = (await Promise.all(sports.map((s) => prisma.game.findMany({
    where: { sport: SPORT_ENUM[s], source: sources[s], status: "SCHEDULED", startUtc: { gt: now, lt: end } },
    include: { ...gameInclude, lines: { orderBy: { fetchedAt: "desc" }, take: 20 } },
  })))).flat();

  const candidates: Candidate[] = games.flatMap((g) => {
    const p = g.predictions[0];
    if (!p) return [];
    const lines = latestLines(g.lines);
    const A = g.awayTeam.shortName ?? g.awayTeam.name, H = g.homeTeam.shortName ?? g.homeTeam.name;
    return marketsOf(p).map((m) => {
      const price = oddsFor(m, lines);
      return {
        matchId: g.id, league: leagueLabel(g.league), startMs: +g.startUtc, match: `${A} at ${H}`, label: m.label, market: m.key,
        group: m.group, p: m.p, odds: price && price > 1.01 ? price : 1 / m.p, real: !!price, band: p.band,
      };
    });
  });
  const withOdds = candidates.some((c) => c.real);
  // Only when Safest was actually chosen: with no stored odds the toggle is hidden and the search
  // already runs in safe mode, so capping there would silently change that view.
  const legCap = mode === "safe" ? SAFE_MAX_LEG_ODDS : undefined;
  const slips = buildSlips(candidates, { target, maxLegs, mode: withOdds ? mode : "safe", band: "LOW", maxLegOdds: legCap }, 3);
  const hint = legHint(target);
  const sportOf = (e: string) => SPORT_IDS.find((s) => SPORT_ENUM[s] === e)!;

  // Track record: rebuild the same target from locked calls on each of the last 14 days and score it.
  const since = new Date(now.getTime() - 14 * DAY);
  const locked = (await Promise.all(sports.map((s) => prisma.prediction.findMany({
    where: { sport: SPORT_ENUM[s], lockedAt: { not: null }, game: { source: sources[s], startUtc: { gte: since, lt: new Date(`${dayKey(now)}T00:00:00Z`) }, results: { some: {} } } },
    include: { game: { include: { homeTeam: true, awayTeam: true, league: true, results: { orderBy: { settledAt: "desc" }, take: 1 } } } },
  })))).flat();
  const byDay = new Map<string, typeof locked>();
  for (const l of locked) { const k = dayKey(l.game.startUtc); byDay.set(k, [...(byDay.get(k) ?? []), l]); }
  const record = [...byDay.entries()].sort(([a], [b]) => b.localeCompare(a)).flatMap(([day, ps]) => {
    const cands: Candidate[] = ps.flatMap((x) => marketsOf(x).map((m) => ({
      matchId: x.gameId, league: leagueLabel(x.game.league), startMs: +x.game.startUtc, match: `${x.game.awayTeam.name} at ${x.game.homeTeam.name}`,
      label: m.label, market: m.key, group: m.group, p: m.p, odds: 1 / m.p, real: false, band: x.band })));
    const [built] = buildSlips(cands, { target, maxLegs, mode: "safe", band: "LOW", maxLegOdds: legCap }, 1);
    if (!built) return [];
    const legs = built.legs.map((l) => {
      const x = ps.find((q) => q.gameId === l.matchId)!, r = x.game.results[0];
      const m = marketsOf(x).find((y) => y.key === l.market)!;
      return hitOf(m, { h: r.homeScore, a: r.awayScore, hSeg: r.homeSeg, aSeg: r.awaySeg, hReg: r.hReg, aReg: r.aReg, extra: r.extraTime ?? undefined, hFirst: r.hFirst, aFirst: r.aFirst });
    });
    if (legs.some((h) => h == null)) return [];
    return [{ day, legs: built.legs.length, odds: built.odds, won: legs.every(Boolean), hits: legs.filter(Boolean).length }];
  });
  const won = record.filter((r) => r.won).length;

  return (
    <>
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Odds builder</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">
          Pick a target price and a window; the builder assembles the combination that reaches it with the best chance —
          one leg per game, at most 2 per competition and 2 of the same market type.
          {withOdds ? " Bookmaker prices are used where they exist, so value legs are preferred." : " No bookmaker prices are stored for these games, so the model's fair odds are used: the target itself sets the chance."}
          {legCap ? ` Safest never uses a leg priced above ${legCap.toFixed(2)}, so the target is reached with more, shorter picks.` : ""}
        </p>
      </header>

      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div data-no-ptr className="flex flex-wrap gap-1.5">
          {TARGETS.map((t) => <Link key={t} href={href({ target: t })}><Chip active={target === t}>{t} odds</Chip></Link>)}
        </div>
        <form action={`/${sport}/builder`} className="flex items-center gap-2">
          <input type="hidden" name="days" value={days} /><input type="hidden" name="mode" value={mode} /><input type="hidden" name="legs" value={maxLegs} />
          {all && <input type="hidden" name="scope" value="all" />}
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border hairline bg-white/[0.02] px-3 py-2">
            <span className="shrink-0 text-[11px] uppercase tracking-wide text-slate-500">Custom</span>
            <input name="target" type="number" step="0.1" min="1.2" max="1000" defaultValue={target} className="focus-ring num w-full min-w-0 bg-transparent text-sm text-slate-100 outline-none" />
          </label>
          <button className="focus-ring rounded-xl border border-edge/40 px-3 py-2 text-sm text-edge hover:bg-edge/10">Go</button>
        </form>
        <FilterSelect label="Window" value={String(days)} options={WINDOWS.map(([d, l]) => ({ value: String(d), label: l, href: href({ days: d }) }))} />
        <FilterSelect label="Max legs" value={String(maxLegs)} options={[4, 6, 8, 10, 12, 15].map((n) => ({ value: String(n), label: `${n} legs`, href: href({ legs: n }) }))} />
      </div>
      <div data-no-ptr className="mb-5 flex flex-wrap items-center gap-1.5">
        <Link href={href({ scope: null })}><Chip active={!all}>{SPORTS[sport].name} only</Chip></Link>
        <Link href={href({ scope: "all" })}><Chip active={all}>All sports</Chip></Link>
        {withOdds && (
          <span className="ml-2 inline-flex rounded-xl border hairline p-1">
            {(["value", "safe"] as const).map((m) => (
              <Link key={m} href={href({ mode: m })} className={cn("rounded-lg px-3 py-1 text-sm", mode === m ? "bg-edge text-ink-950" : "text-slate-300")}>{m === "value" ? "Best value" : "Safest"}</Link>
            ))}
          </span>
        )}
      </div>

      {slips.length === 0 ? (
        <EmptyState title="No combination reaches that target"
          body={legCap
            ? `Safest only uses legs priced ${legCap.toFixed(2)} or shorter, and nothing in this window reaches ${target.toFixed(2)} that way within ${maxLegs} legs. Try a longer window, all sports, a lower target, more legs, or switch to Best value.`
            : `Nothing in this window adds up to ${target.toFixed(2)} within the leg limit. Try a longer window, all sports, a lower target or more legs.`}
          action={{ href: href({ days: Math.min(14, days * 2), scope: "all" }), label: "Widen the search" }} />
      ) : (
        <div className="space-y-4">
          {slips.map((s, i) => (
            <BuilderResult key={i} index={i} target={target}
              slip={{ odds: s.odds, p: s.p, adjusted: s.adjusted, real: s.real, edge: s.edge,
                legs: s.legs.map((l) => ({ gameId: l.matchId, market: l.market, label: l.label, match: l.match, league: l.league, p: l.p, odds: l.odds, real: l.real,
                  group: GROUP_LABEL[l.group as Group] ?? l.group, when: fmtWat(new Date(l.startMs), "EEE HH:mm") })) }} />
          ))}
        </div>
      )}

      <Card className="mt-6">
        <SectionTitle aside="locked calls only · last 14 days">Track record at this target</SectionTitle>
        {record.length === 0 ? <p className="text-sm text-slate-400">Fills in as locked calls are settled: each past day is rebuilt at this target and scored.</p> : (
          <>
            <p className="mb-3 text-sm text-slate-300">
              A <span className="num">{target.toFixed(2)}</span> slip built on each of the last {record.length} day{record.length === 1 ? "" : "s"} would have won{" "}
              <span className={cn("num", won ? "text-edge" : "text-miss")}>{won}</span>. Expected at this price: about 1 in {oneInN(hint.chance)}.
            </p>
            <table className="num w-full text-xs">
              <thead className="text-slate-500"><tr><th className="text-left font-normal">Day</th><th className="font-normal">Legs</th><th className="font-normal">Odds</th><th className="font-normal">Legs won</th><th className="font-normal">Slip</th></tr></thead>
              <tbody>{record.map((r) => (
                <tr key={r.day} className="border-t hairline"><td className="py-1.5">{r.day}</td><td className="text-center">{r.legs}</td><td className="text-center">{r.odds.toFixed(2)}</td>
                  <td className="text-center text-slate-400">{r.hits}/{r.legs}</td><td className={cn("text-center", r.won ? "text-edge" : "text-miss")}>{r.won ? "won" : "lost"}</td></tr>
              ))}</tbody>
            </table>
          </>
        )}
        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
          Long accumulators lose most of the time by design: at {target.toFixed(2)} the chance is about {pct(hint.chance)}, roughly 1 in {oneInN(hint.chance)}.
          Combined chances assume the legs are independent; a small haircut is applied because they are not. Never stake more than you can lose. 18+.
          {games.length > 0 && <> {games.length} game{games.length === 1 ? "" : "s"} in this window{all ? ` across ${sports.map((s) => SPORTS[sportOf(SPORT_ENUM[s])].name).join(", ")}` : ""}.</>}
        </p>
      </Card>
    </>
  );
}
