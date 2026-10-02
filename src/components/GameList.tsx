import type { BoardGame } from "@/lib/queries";
import type { Pick } from "@/lib/picks";
import { leagueLabel, type SportId } from "@/lib/sports";
import { GameRow } from "./GameRow";
export function GameList({ games, sport, focus }: { games: BoardGame[]; sport: SportId; focus?: Map<string, Pick | null> }) {
  // Push into the existing array rather than rebuilding it per game: the spread form copies the whole
  // bucket on every insert, which is O(n^2) allocations for no reason.
  const groups = new Map<string, BoardGame[]>();
  for (const g of games) {
    const bucket = groups.get(g.leagueId);
    if (bucket) bucket.push(g); else groups.set(g.leagueId, [g]);
  }
  return (
    <div className="space-y-4">
      {[...groups.values()].map((gs) => (
        <section key={gs[0].leagueId} className="glass px-1 py-2">
          <h3 className="px-3 pb-1 pt-1 text-xs text-slate-400">{leagueLabel(gs[0].league)}</h3>
          <div className="divide-y divide-white/[0.05]">{gs.map((g) => <GameRow key={g.id} g={g} sport={sport} focus={focus?.get(g.id)} />)}</div>
        </section>
      ))}
    </div>
  );
}
