import Link from "next/link";
export function DemoBanner({ demo, sportName }: { demo: boolean; sportName: string }) {
  if (!demo) return null;
  return (
    <div className="mb-4 rounded-xl border border-ice/20 bg-ice/10 px-3 py-2 text-xs text-ice">
      {sportName} is in demo mode: fictional teams, simulated results and simulated book lines, rated by the real model.{" "}
      {sportName === "Basketball"
        ? <>Live NBA data needs a free <Link href="/settings" className="underline underline-offset-2">balldontlie key</Link>, then a sync.</>
        : <>Live data comes from a free official source after the first sync (<Link href="/settings" className="underline underline-offset-2">Settings → Data source</Link>).</>}
    </div>
  );
}
