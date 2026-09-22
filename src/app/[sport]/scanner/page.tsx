import Link from "next/link";
import { SCANNERS } from "@/lib/picks";
import { SPORTS, type SportId } from "@/lib/sports";
export default async function Scanners({ params }: { params: Promise<{ sport: SportId }> }) {
  const { sport } = await params; const cfg = SPORTS[sport];
  const rename = (s: string) => s.replace("Handicap", cfg.handicapName).replace("Segment", cfg.segmentName).replace("segment", cfg.segmentName.toLowerCase());
  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">{cfg.name} scanners</h1>
      <p className="mb-5 text-sm text-slate-400">Next 7 days, sorted by probability. Floors are editable in Settings.</p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {SCANNERS.map((s) => (
          <li key={s.slug}><Link href={`/${sport}/scanner/${s.slug}`} className="focus-ring glass block h-full p-4 transition-colors duration-200 hover:border-edge/30">
            <div className="text-sm font-medium">{rename(s.name)}</div><p className="mt-1 text-xs leading-relaxed text-slate-400">{rename(s.blurb)}</p>
          </Link></li>
        ))}
      </ul>
    </>
  );
}
