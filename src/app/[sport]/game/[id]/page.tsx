import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getGame } from "@/lib/queries";
import { SPORTS, type SportId } from "@/lib/sports";
import { picksOf, laddersOf, marketsOf } from "@/lib/picks";
import { GROUP_LABEL, hitOf, type Group } from "@/lib/markets";
import { bestTip } from "@/lib/top";
import { latestLines, oddsFor, valueTips, VALUE } from "@/lib/value";
import { AddToSlip } from "@/components/AddToSlip";
import { fmtUtc, fmtWat } from "@/lib/time";
import { WinBar } from "@/components/WinBar";
import { Ladder } from "@/components/Ladder";
import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { CountUp } from "@/components/CountUp";
import { Card, SectionTitle, cn, pct } from "@/components/ui";

const FLAG: Record<string, string> = {
  missing_lineups: "Lineups and injury news not confirmed", missing_pitchers: "Probable starting pitchers not confirmed",
  missing_goalies: "Starting goalies not confirmed", missing_rest: "Rest days unknown", thin_sample: "Few recent games for at least one team",
  new_team_home: "Home team has no history here; league average used", new_team_away: "Away team has no history here; league average used",
  no_book_lines: "No bookmaker lines; reference lines used", low_band_capped: "Low confidence: probabilities capped below 90%",
  no_empty_net_adjustment: "Empty-net effect not fitted yet (needs 150+ games); 2-goal wins may be understated",
};
const GROUPS: Group[] = ["win", "total", "spread", "seg", "team", "props"];

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const d = await getGame((await params).id);
  return { title: d ? `${d.g.awayTeam.name} at ${d.g.homeTeam.name}` : "Game" };
}

export default async function GamePage({ params }: { params: Promise<{ sport: SportId; id: string }> }) {
  const { sport, id } = await params;
  const d = await getGame(id); if (!d) notFound();
  const { g, homeLast, awayLast, h2h } = d;
  const cfg = SPORTS[sport], p = g.predictions[0];
  const H = g.homeTeam.shortName ?? g.homeTeam.name, A = g.awayTeam.shortName ?? g.awayTeam.name;
  const k = p ? picksOf(p) : null, lad = p ? laddersOf(p) : null;
  const proj = (x: number) => (sport === "basketball" ? String(Math.round(x)) : x.toFixed(1));
  const done = g.status === "FINISHED" && g.homeScore != null;
  const wl = (list: typeof homeLast, tid: string) => list.slice(0, 5).map((x) => ((x.homeTeamId === tid ? x.homeScore! - x.awayScore! : x.awayScore! - x.homeScore!) > 0 ? "W" : "L"));

  const result = done ? { h: g.homeScore!, a: g.awayScore!, hSeg: g.homeSeg, aSeg: g.awaySeg, hReg: g.homeReg, aReg: g.awayReg, extra: g.extraTime, hFirst: g.homeFirst, aFirst: g.awayFirst } : null;
  const markets = p ? marketsOf(p) : [];
  const tip = p ? bestTip(p) : null;
  const lines = latestLines(g.lines);
  const values = p ? valueTips(p, lines).slice(0, 3) : [];
  const open = g.status === "SCHEDULED" && g.startUtc > new Date();
  const hasOdds = g.lines.some((l) => l.priceA != null);
  const gname = (x: Group) => (x === "spread" ? cfg.handicapName : x === "seg" ? cfg.segmentName : GROUP_LABEL[x]);

  return (
    <article>
      <p className="text-xs text-slate-400">{g.league.name}</p>
      <header className="relative mt-2 overflow-hidden rounded-[20px] border hairline bg-[radial-gradient(120%_90%_at_50%_0%,#13203a_0%,#0B1220_55%,#070B14_100%)] px-4 pb-6 pt-5 md:px-8">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span className="num">{fmtWat(g.startUtc, "EEE d MMM, HH:mm")} WAT <span className="text-slate-600">/ {fmtUtc(g.startUtc)} UTC</span></span>
          {p && <ConfidenceBadge band={p.band} score={p.confidence} />}
        </div>
        <div className="mt-6 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <h1 className="text-right text-base font-medium leading-tight md:text-xl">{g.awayTeam.name}<span className="block text-[11px] font-normal text-slate-500">away</span></h1>
          <div className="text-center">
            {p ? <div className="num text-[54px] font-semibold leading-none tracking-tight md:text-[88px]">{proj(p.muAway)}<span className="mx-2 text-slate-600">–</span>{proj(p.muHome)}</div>
              : <div className="num text-5xl text-slate-600">– –</div>}
            <div className="mt-1 text-[11px] text-slate-500">projected {cfg.unit}</div>
          </div>
          <h1 className="text-base font-medium leading-tight md:text-xl">{g.homeTeam.name}<span className="block text-[11px] font-normal text-slate-500">home</span></h1>
        </div>
        {p && k && (
          <>
            <div className="mx-auto mt-7 max-w-xl"><WinBar home={p.calHomeWin} homeName={H} awayName={A} size="lg" /></div>
            {tip ? (
              <div className="mx-auto mt-5 max-w-md rounded-2xl border border-edge/40 bg-edge/[0.07] px-4 py-4 text-center">
                <div className="text-[11px] uppercase tracking-wide text-edge/80">Best pick · {gname(tip.group)}</div>
                <div className="mt-1 text-lg font-medium text-slate-50">{tip.label}</div>
                <CountUp value={tip.p} className="num mt-1 block text-5xl font-semibold leading-none text-edge" />
                <div className="num mt-2 flex items-center justify-center gap-3 text-[11px] text-slate-400">fair odds {(1 / tip.p).toFixed(2)}{open && <AddToSlip gameId={g.id} sport={sport} market={tip.key} />}</div>
              </div>
            ) : <p className="mx-auto mt-5 max-w-md text-center text-sm text-slate-400">No pick reaches 55% at Medium or High confidence for this game.</p>}
            <div className="mx-auto mt-3 max-w-md rounded-2xl border border-ice/30 bg-ice/[0.05] px-4 py-3">
              <div className="text-center text-[11px] uppercase tracking-wide text-ice/80">Best value</div>
              {values.length ? (
                <ul className="mt-2 divide-y divide-white/[0.06]">
                  {values.map((v) => (
                    <li key={v.key} className="flex items-center gap-2 py-2">
                      <div className="min-w-0 flex-1"><div className="truncate text-sm text-slate-100">{v.label}</div><div className="num text-[11px] text-slate-400">model {pct(v.p)} · odds {v.odds.toFixed(2)} · fair {v.fair.toFixed(2)}</div></div>
                      <span className="num text-sm text-edge">+{Math.round(v.edge * 100)}%</span>
                      {open && <AddToSlip gameId={g.id} sport={sport} market={v.key} />}
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-1 text-center text-xs text-slate-400">{hasOdds ? `No market is priced better than the model's fair odds (needs ${Math.round(VALUE.minEdge * 100)}%+ edge at odds ${VALUE.minOdds.toFixed(2)}–${VALUE.maxOdds.toFixed(2)}).` : "No bookmaker prices stored for this game yet."}</p>}
            </div>
            <div className="mx-auto mt-5 grid max-w-2xl gap-2 sm:grid-cols-3">
              {([["Total", k.total, k.strongTotal], [cfg.handicapName, k.spread, k.strongSpread], [cfg.segmentName, k.seg, k.strongSeg]] as const).map(([name, main, strong]) => (
                <div key={name} className={cn("rounded-xl border px-3 py-2.5", k.best.market === main.market ? "border-edge/50 bg-edge/[0.06]" : "hairline bg-white/[0.02]")}>
                  <div className="text-[10px] text-slate-500">{name} · {p.lineSource === "book" ? "book line" : "reference line"}</div>
                  <div className="mt-0.5 flex items-baseline justify-between gap-2"><span className="text-sm">{main.label}</span><CountUp value={main.p} className="num text-lg text-slate-50" /></div>
                  <div className="num mt-1 text-[11px] text-slate-400">{strong ? <>strong: <span className="text-edge">{strong.label} {pct(strong.p)}</span></> : "no line clears the strong floor"}</div>
                </div>
              ))}
            </div>
            <div className="num mt-4 text-center text-[11px] text-slate-500">fair total {p.fairTotal.toFixed(1)} · fair {cfg.handicapName.toLowerCase()} {H} {p.fairSpread > 0 ? "+" : ""}{p.fairSpread.toFixed(1)} · {cfg.segmentShort} {p.fairSegTotal.toFixed(1)} · {p.modelVersion} r{p.revision}{p.lockedAt ? " · locked" : ""}</div>
          </>
        )}
      </header>

      {done && p && (
        <Card className="mt-4">
          <SectionTitle aside={p.lockedAt ? `locked ${fmtWat(p.lockedAt, "d MMM HH:mm")} WAT` : "not locked (not scored)"}>Result vs call</SectionTitle>
          <div className="num text-xl">{A} {g.awayScore} – {g.homeScore} {H}<span className="ml-2 text-xs text-slate-500">{cfg.segmentShort} {g.awaySeg ?? "–"}–{g.homeSeg ?? "–"}{g.extraTime ? (sport === "baseball" ? " · extras" : " · OT") : ""}</span></div>
          {tip && result && (() => { const h = hitOf(tip, result); return <p className="mt-2 text-sm text-slate-300">Best pick {tip.label}: <span className={h == null ? "text-slate-500" : h ? "text-edge" : "text-miss"}>{h == null ? "push" : h ? "won" : "lost"}</span>. Every market is marked below.</p>; })()}
        </Card>
      )}

      {p && (
        <Card className="mt-4">
          <SectionTitle aside="model probability · specials not yet calibrated">All markets</SectionTitle>
          <div className="space-y-3">
            {GROUPS.map((grp) => {
              const rows = markets.filter((m) => m.group === grp);
              if (!rows.length) return null;
              return (
                <div key={grp}>
                  <div className="mb-1 text-[11px] text-slate-500">{gname(grp)}</div>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                    {rows.map((m) => {
                      const h = result ? hitOf(m, result) : null, o = oddsFor(m, lines);
                      return (
                        <div key={m.key} className={cn("rounded-lg border px-2.5 py-1.5", tip?.key === m.key ? "border-edge/50 bg-edge/10" : "hairline bg-white/[0.02]")}>
                          <div className="flex items-start justify-between gap-1">
                            <div className="truncate text-[11px] text-slate-400" title={m.label}>{m.short}{m.strong ? " ★" : ""}</div>
                            {open && <AddToSlip gameId={g.id} sport={sport} market={m.key} className="-mr-1 -mt-0.5 scale-90" />}
                          </div>
                          <div className="flex items-baseline justify-between">
                            <span className={cn("num text-sm", m.p >= 0.6 ? "text-edge" : "text-slate-100")}>{pct(m.p)}</span>
                            {h != null ? <span className={cn("text-[10px]", h ? "text-edge" : "text-miss")}>{h ? "hit" : "miss"}</span>
                              : o ? <span className={cn("num text-[10px]", m.p * o - 1 >= 0.03 ? "text-edge" : "text-slate-500")}>@{o.toFixed(2)}</span> : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[10px] text-slate-500">★ strong line: the most aggressive line still at or above your strong floor.</p>
        </Card>
      )}

      {p && lad && k && (
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <Card><SectionTitle aside={`main ${p.totalLine}`}>Total ladder</SectionTitle><Ladder rows={lad.total} kind="total" mainLine={p.totalLine} strongLine={k.strongTotal?.line} homeName={H} awayName={A} /></Card>
          <Card><SectionTitle aside={`main ${p.spreadLine > 0 ? "+" : ""}${p.spreadLine}`}>{cfg.handicapName} ladder</SectionTitle><Ladder rows={lad.spread} kind="spread" mainLine={p.spreadLine} strongLine={k.strongSpread ? (k.strongSpread.side === "home" ? k.strongSpread.line : -k.strongSpread.line!) : null} homeName={H} awayName={A} /></Card>
          <Card><SectionTitle aside={`main ${p.segLine}`}>{cfg.segmentName} ladder</SectionTitle><Ladder rows={lad.seg} kind="total" mainLine={p.segLine} strongLine={k.strongSeg?.line} homeName={H} awayName={A} /></Card>
        </div>
      )}

      {p && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card>
            <SectionTitle>Why this call</SectionTitle>
            <ul className="space-y-2.5 text-sm leading-relaxed text-slate-300">{(p.rationale as string[]).map((b, i) => <li key={i} className="flex gap-2.5"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-edge" />{b}</li>)}</ul>
            <ul className="mt-4 space-y-1 border-t hairline pt-3 text-xs text-slate-300">
              {p.dataFlags.length ? p.dataFlags.map((f) => <li key={f} className="flex gap-2"><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ice" />{FLAG[f] ?? f}</li>) : <li className="text-slate-400">All inputs present.</li>}
            </ul>
          </Card>
          <Card>
            <SectionTitle>Form and head to head</SectionTitle>
            <dl className="space-y-2 text-sm">
              {[[H, homeLast, g.homeTeamId], [A, awayLast, g.awayTeamId]].map(([n, l, tid]) => (
                <div key={tid as string} className="flex items-center justify-between"><dt className="text-slate-300">{n as string}</dt>
                  <dd className="flex gap-1">{wl(l as typeof homeLast, tid as string).map((r, i) => <span key={i} className={cn("num grid h-5 w-5 place-items-center rounded text-[10px] font-semibold", r === "W" ? "bg-edge/20 text-edge" : "bg-miss/15 text-miss")}>{r}</span>)}</dd></div>
              ))}
            </dl>
            <ul className="mt-4 divide-y divide-white/[0.05] border-t hairline text-sm">
              {h2h.length ? h2h.map((x) => (
                <li key={x.id} className="flex justify-between py-1.5"><span className="num text-xs text-slate-500">{fmtWat(x.startUtc, "d MMM yy")}</span><span className="text-slate-300">{x.awayTeam.shortName ?? x.awayTeam.name} <span className="num text-slate-100">{x.awayScore}–{x.homeScore}</span> {x.homeTeam.shortName ?? x.homeTeam.name}</span></li>
              )) : <li className="py-2 text-slate-400">No previous meetings stored.</li>}
            </ul>
          </Card>
        </div>
      )}
    </article>
  );
}
