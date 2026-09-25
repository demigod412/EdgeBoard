import Link from "next/link";
import type { BoardGame } from "@/lib/queries";
import { picksOf, type Pick } from "@/lib/picks";
import { bestTip } from "@/lib/top";
import { fmtUtc, fmtWat } from "@/lib/time";
import { SPORTS, type SportId } from "@/lib/sports";
import { WinBar } from "./WinBar";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { PickChip } from "./PickChip";
import { pct } from "./ui";
import { gameView } from "@/lib/gameView";

export function GameRow({ g, sport, focus }: { g: BoardGame; sport: SportId; focus?: Pick | null }) {
  const p = g.predictions[0], cfg = SPORTS[sport];
  const k = p ? picksOf(p) : null;
  const tip = p ? bestTip(p) : null;
  const view = gameView(g, sport, new Date());
  // Show a score whenever one exists: a sync that caught a game in progress stores the running score.
  const hasScore = g.homeScore != null && g.awayScore != null;
  const done = view === "finished";
  const H = g.homeTeam.shortName ?? g.homeTeam.name, A = g.awayTeam.shortName ?? g.awayTeam.name;
  const proj = (x: number) => (sport === "basketball" ? Math.round(x) : x.toFixed(1));
  return (
    <Link href={`/${sport}/game/${g.id}`} className="focus-ring block rounded-xl px-3 py-3 transition-colors duration-200 ease-out hover:bg-white/[0.04]">
      <div className="grid grid-cols-[3.25rem_1fr_auto] items-center gap-3 md:grid-cols-[4rem_1fr_10rem_auto]">
        <div className="leading-tight">
          <div className="num text-sm text-slate-100">{fmtWat(g.startUtc)}</div>
          <div className="num text-[10px] text-slate-500">{fmtUtc(g.startUtc)} UTC</div>
        </div>
        <div className="min-w-0">
          {[[g.awayTeam.name, A, hasScore ? g.awayScore : p ? proj(p.muAway) : "–"], [g.homeTeam.name, H, hasScore ? g.homeScore : p ? proj(p.muHome) : "–"]].map(([full, short, sc], i) => (
            <div key={i} className="flex items-center justify-between gap-2">
              <span className={`truncate text-sm ${i === 1 ? "text-slate-100" : "text-slate-300"}`} title={String(full)}>{short}{i === 1 && <span className="ml-1 text-[10px] text-slate-500">home</span>}</span>
              <span className="num text-sm text-slate-300">{sc}</span>
            </div>
          ))}
        </div>
        <div className="hidden md:block">{p ? <WinBar home={p.calHomeWin} size="sm" /> : <span className="text-xs text-slate-500">No call yet</span>}</div>
        <div className="flex flex-col items-end gap-1">
          {p && <ConfidenceBadge band={p.band} />}
          {p && <span className="num text-[11px] text-slate-400">{(p.calHomeWin >= 0.5 ? H : A)} {pct(Math.max(p.calHomeWin, 1 - p.calHomeWin))}</span>}
          {view === "live"
            ? <span className="inline-flex items-center gap-1 text-[10px] font-medium text-miss">
                <span aria-hidden className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-miss" />LIVE
              </span>
            : view === "finished"
              // Started long enough ago to be over but no score yet: the results job runs every 15 minutes.
              ? <span className="text-[10px] text-slate-500">{hasScore
                  ? `Final${g.extraTime ? (sport === "baseball" ? " (extras)" : sport === "hockey" ? " (OT/SO)" : " (OT)") : ""}`
                  : "result pending"}</span>
              : null}
        </div>
      </div>
      {k && (
        <div className="mt-2 flex flex-wrap gap-1.5 pl-[3.25rem] md:pl-[4rem]">
          {focus ? <PickChip pick={focus} best /> : (<>
            {tip && <PickChip pick={{ market: "win", side: tip.side, line: tip.line ?? null, p: tip.p, label: tip.label }} best prefix="Best" />}
            <PickChip pick={k.total} prefix="O/U" />
            <PickChip pick={k.spread} prefix={cfg.handicapName} />
          </>)}
        </div>
      )}
    </Link>
  );
}
