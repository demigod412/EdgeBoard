import { prisma } from "@/lib/db";
import { dataMode } from "@/lib/mode";
import { marketsOf } from "@/lib/picks";
import { latestLines } from "@/lib/value";
import { computeAccuracy, dailySeries, devig2, type Metrics, type ScoredCall } from "@/lib/accuracy";
import { SPORTS, SPORT_ENUM, type SportId } from "@/lib/sports";
import { MODEL_VERSION } from "@/lib/model/constants";
import { Card, SectionTitle, cn, pct } from "@/components/ui";
import { EmptyState } from "@/components/EmptyState";
import { BrierChart } from "@/components/BrierChart";

export const dynamic = "force-dynamic";
const f3 = (x: number) => x.toFixed(3);

export default async function Accuracy({ params }: { params: Promise<{ sport: SportId }> }) {
  const { sport } = await params; const cfg = SPORTS[sport];
  const { source, demo } = await dataMode(sport);
  const rows = await prisma.prediction.findMany({
    where: { sport: SPORT_ENUM[sport], lockedAt: { not: null }, game: { source, results: { some: {} } } },
    include: { game: { include: { results: { orderBy: { settledAt: "desc" }, take: 1 }, lines: { where: { market: "moneyline" }, orderBy: { fetchedAt: "desc" } } } } },
  });
  const cal = await prisma.calibrationModel.findMany({ where: { sport: SPORT_ENUM[sport], modelVersion: MODEL_VERSION, active: true }, orderBy: { market: "asc" } });
  const header = (
    <header className="mb-5">
      <h1 className="text-2xl font-semibold tracking-tight">{cfg.name} accuracy</h1>
      <p className="mt-1 max-w-2xl text-sm text-slate-400">Only calls <b className="text-slate-200">locked 15 minutes before start</b> are scored against the final. Locked calls are never edited; score corrections are appended.{demo ? " Demo ledger: simulated games." : ""}</p>
    </header>
  );
  if (!rows.length) return <>{header}<EmptyState title="No settled locked calls yet" body="Calls lock 15 minutes before start and are scored after the final. The ledger fills as games finish." /></>;

  const calls: ScoredCall[] = rows.map((p) => {
    const r = p.game.results[0], ml = latestLines(p.game.lines, p.lockedAt!).get("moneyline");
    return { start: p.game.startUtc, band: p.band, pHome: p.calHomeWin, markets: marketsOf(p),
      result: { h: r.homeScore, a: r.awayScore, hSeg: r.homeSeg, aSeg: r.awaySeg, hReg: r.hReg, aReg: r.aReg, extra: r.extraTime ?? undefined, hFirst: r.hFirst, aFirst: r.aFirst },
      market: ml?.a && ml?.b ? devig2(ml.a, ml.b) : null };
  });
  const r = computeAccuracy(calls);
  const row = (name: string, m: Metrics | null | undefined, note?: string, best?: boolean) => m && (
    <tr className="border-t hairline"><td className="py-2 font-sans text-slate-300">{name}{note && <span className="block text-[10px] text-slate-500">{note}</span>}</td>
      <td className={cn("text-center", best && "text-edge")}>{f3(m.brier)}</td><td className="text-center">{f3(m.logloss)}</td><td className="text-center">{pct(m.hit)}</td><td className="text-center text-slate-500">{m.n}</td></tr>
  );
  return (
    <>
      {header}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle aside={`${r.n} locked calls`}>Win probability quality</SectionTitle>
          <table className="num w-full text-xs">
            <thead className="text-slate-500"><tr><th className="text-left font-normal">Forecaster</th><th className="font-normal">Brier</th><th className="font-normal">Log loss</th><th className="font-normal">Hit</th><th className="font-normal">n</th></tr></thead>
            <tbody>
              {row("EdgeBoard model", r.model, MODEL_VERSION, r.model.brier <= r.alwaysHome.brier)}
              {row("Home base rate", r.alwaysHome, "home-win rate for every game")}
              {r.market && row("Model (same games)", r.market.model, "games with moneyline odds")}
              {r.market && row("Bookmaker moneyline", r.market.market, "margin removed, before the lock")}
            </tbody>
          </table>
          <p className="mt-3 text-[11px] text-slate-500">Brier: 0 is perfect, 0.25 is a coin flip. Beating the bookmaker is the hardest test.</p>
        </Card>
        <Card><SectionTitle aside="daily, lower is better">Brier over time</SectionTitle><BrierChart data={dailySeries(calls)} /></Card>
        <Card>
          <SectionTitle aside="favourite's probability vs how often it won">Calibration</SectionTitle>
          <table className="num w-full text-xs">
            <thead className="text-slate-500"><tr><th className="text-left font-normal">Model said</th><th className="font-normal">Games</th><th className="font-normal">Avg said</th><th className="font-normal">Happened</th></tr></thead>
            <tbody>{r.calibration.map((b) => <tr key={b.lo} className="border-t hairline"><td className="py-1.5">{Math.round(b.lo * 100)}–{Math.round(b.lo * 100) + 10}%</td><td className="text-center">{b.n}</td><td className="text-center">{pct(b.avgP)}</td><td className={cn("text-center", Math.abs(b.rate - b.avgP) <= 0.07 ? "text-edge" : "text-amber")}>{pct(b.rate)}</td></tr>)}</tbody>
          </table>
          <p className="mt-3 text-[11px] text-slate-500">Calibration maps: {cal.length ? cal.map((c) => `${c.market} ${c.method}(${c.n})`).join(" · ") : "none yet (identity until 50 settled calls)"}.</p>
        </Card>
        <Card>
          <SectionTitle>By confidence band</SectionTitle>
          <table className="num w-full text-xs"><thead className="text-slate-500"><tr><th className="text-left font-normal">Band</th><th className="font-normal">Games</th><th className="font-normal">Brier</th><th className="font-normal">Win pick hit</th></tr></thead>
            <tbody>{Object.entries(r.byBand).map(([b, m]) => <tr key={b} className="border-t hairline"><td className="py-1.5 font-sans">{b[0] + b.slice(1).toLowerCase()}</td><td className="text-center">{m.n}</td><td className="text-center">{f3(m.brier)}</td><td className="text-center">{pct(m.hit)}</td></tr>)}</tbody></table>
        </Card>
        <Card className="lg:col-span-2">
          <SectionTitle aside="every market the model backed at 50%+">Markets</SectionTitle>
          <div className="overflow-x-auto"><table className="num w-full text-xs"><thead className="text-slate-500"><tr><th className="text-left font-normal">Market</th><th className="font-normal">Calls</th><th className="font-normal">Hit</th><th className="font-normal">Avg model p</th></tr></thead>
            <tbody>{r.markets.map((m) => <tr key={m.label} className="border-t hairline"><td className="py-1.5 font-sans text-slate-300">{m.label.replace("Segment", cfg.segmentName).replace("Handicap", cfg.handicapName)}</td><td className="text-center">{m.n}</td><td className={cn("text-center", m.hit >= m.avgP - 0.05 ? "text-edge" : "text-miss")}>{pct(m.hit)}</td><td className="text-center text-slate-400">{pct(m.avgP)}</td></tr>)}</tbody></table></div>
          <p className="mt-3 text-[11px] text-slate-500">Trustworthy when Hit stays close to Avg model p (green: within 5 points or better).</p>
        </Card>
      </div>
    </>
  );
}
