import Link from "next/link";
import { cookies } from "next/headers";
import { isSport } from "@/lib/sports";
export const metadata = { title: "More" };
export default async function More() {
  const c = (await cookies()).get("eb_sport")?.value ?? "", s = isSport(c) ? c : "basketball";
  const links = [[`/${s}/accuracy`, "Accuracy", "Locked calls scored vs the home base rate and the bookmaker"], ["/slips", "Slips", "Your saved slips, optimise, split, merge, Sportybet code"],
    ["/methodology", "Methodology", "Formulas for each sport, specials, value, ledger"], ["/settings", "Settings", "API key, sports to sync, floors"]];
  return (
    <ul className="space-y-2">
      {links.map(([h, t, d]) => <li key={h}><Link href={h} className="focus-ring glass block p-4"><div className="text-sm font-medium">{t}</div><div className="text-xs text-slate-400">{d}</div></Link></li>)}
    </ul>
  );
}
