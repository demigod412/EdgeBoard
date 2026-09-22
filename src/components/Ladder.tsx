import type { LadderRow } from "@/lib/model/common";
import { cn, pct } from "./ui";

/** Line ladder: probability for each side at every line. Main line and strong line are marked. */
export function Ladder({ rows, kind, mainLine, strongLine, homeName, awayName }: {
  rows: LadderRow[]; kind: "total" | "spread"; mainLine: number; strongLine?: number | null; homeName: string; awayName: string;
}) {
  const [colA, colB] = kind === "total" ? ["Over", "Under"] : [homeName, awayName];
  return (
    <div className="max-h-80 overflow-auto">
      <table className="num w-full text-xs">
        <thead className="sticky top-0 bg-ink-900 text-slate-500">
          <tr><th className="py-1 text-left font-normal">Line</th><th className="text-right font-normal">{colA}</th><th className="text-right font-normal">{colB}</th><th className="w-20" /></tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const b = 1 - r.a - r.push;
            const isMain = r.line === mainLine, isStrong = strongLine != null && (kind === "total" ? r.line === strongLine : r.line === strongLine || -r.line === strongLine);
            return (
              <tr key={r.line} className={cn("border-t hairline", isMain && "bg-white/[0.04]")}>
                <td className="py-1.5 text-slate-300">{kind === "spread" ? (r.line > 0 ? `+${r.line}` : r.line) : r.line}</td>
                <td className={cn("text-right", r.a >= 0.6 ? "text-edge" : "text-slate-200")}>{pct(r.a)}</td>
                <td className={cn("text-right", b >= 0.6 ? "text-edge" : "text-slate-200")}>{pct(b)}</td>
                <td className="pl-2 text-right text-[10px] text-slate-500">{isMain ? "main" : ""}{isMain && isStrong ? " · " : ""}{isStrong ? <span className="text-edge">strong</span> : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {kind === "spread" && <p className="mt-2 text-[10px] text-slate-500">Lines are from {homeName}’s side; {awayName} gets the opposite number.</p>}
    </div>
  );
}
