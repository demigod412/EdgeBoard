import { cn, pct } from "./ui";
/** Two-way win bar (no draw: overtime / extra innings / shootout decide every game). */
export function WinBar({ home, homeName, awayName, size = "md" }: { home: number; homeName?: string; awayName?: string; size?: "sm" | "md" | "lg" }) {
  const fav = home >= 0.5;
  const h = size === "lg" ? "h-3" : size === "md" ? "h-2" : "h-1.5";
  return (
    <div role="img" aria-label={`Win probability: home ${pct(home)}, away ${pct(1 - home)}`}>
      <div className={cn("flex gap-[2px] overflow-hidden rounded-full", h)}>
        <div style={{ width: `${home * 100}%` }} className={fav ? "bg-edge" : "bg-ice/40"} />
        <div style={{ width: `${(1 - home) * 100}%` }} className={!fav ? "bg-edge" : "bg-ice/40"} />
      </div>
      {homeName && (
        <div className="num mt-1.5 flex justify-between text-[11px] text-slate-400">
          <span className={fav ? "text-edge" : ""}>{homeName} {pct(home)}</span>
          <span className={!fav ? "text-edge" : ""}>{pct(1 - home)} {awayName}</span>
        </div>
      )}
    </div>
  );
}
