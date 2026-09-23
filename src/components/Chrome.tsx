"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Radar, LineChart, Menu, BookOpen, Settings, Trophy, Ticket, Calculator } from "lucide-react";
import { SPORTS, SPORT_IDS, isSport, type SportId } from "@/lib/sports";
import { cn } from "./ui";

function useSport(fallback: SportId): { sport: SportId; rest: string } {
  const path = usePathname();
  const [, first, ...rest] = path.split("/");
  return isSport(first) ? { sport: first, rest: rest.length ? "/" + rest.join("/") : "" } : { sport: fallback, rest: "" };
}

/** Sport picker. Keeps you on the same kind of page (board → board, scanner → scanner). */
export function SportSwitcher({ fallback }: { fallback: SportId }) {
  const { sport, rest } = useSport(fallback);
  const keep = /^\/(scanner(\/[\w-]+)?|accuracy|top)$/.test(rest) ? rest : "";
  return (
    <nav aria-label="Sport" className="glass flex gap-1 !rounded-2xl p-1">
      {SPORT_IDS.map((s) => {
        const on = s === sport;
        return (
          <Link key={s} href={`/${s}${keep}`} aria-current={on ? "page" : undefined}
            onClick={() => { document.cookie = `eb_sport=${s}; path=/; max-age=31536000; samesite=lax`; }}
            className={cn("focus-ring flex-1 rounded-xl px-3 py-2 text-center text-sm transition-colors duration-200", on ? "text-ink-950" : "text-slate-300 hover:bg-white/[0.05]")}
            style={on ? { background: SPORTS[s].accent } : undefined}>
            {SPORTS[s].name}
          </Link>
        );
      })}
    </nav>
  );
}

export function BottomTabs({ fallback }: { fallback: SportId }) {
  const { sport, rest } = useSport(fallback);
  const path = usePathname();
  const tabs = [
    { href: `/${sport}`, label: "Board", icon: CalendarDays, on: rest === "" || rest.startsWith("/game") },
    { href: `/${sport}/top`, label: "Top 20", icon: Trophy, on: rest.startsWith("/top") },
    { href: `/${sport}/scanner`, label: "Scanners", icon: Radar, on: rest.startsWith("/scanner") },
    { href: `/${sport}/builder`, label: "Builder", icon: Calculator, on: rest.startsWith("/builder") },
    { href: "/more", label: "More", icon: Menu, on: ["/more", "/methodology", "/settings"].some((x) => path.startsWith(x)) || rest.startsWith("/accuracy") },
  ];
  return (
    <nav aria-label="Primary" className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t hairline bg-ink-950/90 backdrop-blur md:hidden">
      <ul className="grid grid-cols-5">
        {tabs.map((t) => (
          <li key={t.label}>
            <Link href={t.href} aria-current={t.on ? "page" : undefined} className={cn("focus-ring flex flex-col items-center gap-0.5 py-2.5 text-[10px]", t.on ? "text-edge" : "text-slate-400")}>
              <t.icon size={20} strokeWidth={t.on ? 2.2 : 1.7} />{t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function LeftRail({ fallback }: { fallback: SportId }) {
  const { sport, rest } = useSport(fallback);
  const path = usePathname();
  const item = (href: string, label: string, Icon: typeof CalendarDays, on: boolean) => (
    <Link key={href} href={href} aria-current={on ? "page" : undefined}
      className={cn("focus-ring flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors duration-200", on ? "bg-edge/10 text-edge" : "text-slate-300 hover:bg-white/[0.04]")}>
      <Icon size={16} />{label}
    </Link>
  );
  return (
    <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col gap-6 border-r hairline px-3 py-5 md:flex">
      <Link href={`/${sport}`} className="focus-ring px-2.5 text-lg font-semibold tracking-tight">Edge<span className="text-edge">Board</span></Link>
      <nav aria-label="Primary" className="space-y-0.5">
        {item(`/${sport}`, "Board", CalendarDays, rest === "" || rest.startsWith("/game"))}
        {item(`/${sport}/top`, "Top 20 tips", Trophy, rest.startsWith("/top"))}
        {item(`/${sport}/scanner`, "Scanners", Radar, rest.startsWith("/scanner"))}
        {item(`/${sport}/builder`, "Odds builder", Calculator, rest.startsWith("/builder"))}
        {item("/slips", "Slips", Ticket, path.startsWith("/slips"))}
        {item(`/${sport}/accuracy`, "Accuracy", LineChart, rest.startsWith("/accuracy"))}
        {item("/methodology", "Methodology", BookOpen, path.startsWith("/methodology"))}
        {item("/settings", "Settings", Settings, path.startsWith("/settings"))}
      </nav>
    </aside>
  );
}
