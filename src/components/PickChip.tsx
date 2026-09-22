import type { Pick } from "@/lib/picks";
import { cn, pct } from "./ui";
export function PickChip({ pick, best, muted, prefix }: { pick: Pick | null; best?: boolean; muted?: boolean; prefix?: string }) {
  if (!pick) return <span className="text-[11px] text-slate-600">–</span>;
  return (
    <span className={cn("num inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px]",
      best ? "border-edge/60 bg-edge/10 text-edge" : muted ? "hairline text-slate-400" : "hairline text-slate-200")}>
      {prefix && <span className="font-sans text-slate-500">{prefix}</span>}{pick.label.replace(/^.*? (to win)$/, "Win")} <span className="opacity-80">{pct(pick.p)}</span>
    </span>
  );
}
