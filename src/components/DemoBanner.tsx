import Link from "next/link";
export function DemoBanner({ demo, sportName }: { demo: boolean; sportName: string }) {
  if (!demo) return null;
  return (
    <div className="mb-4 rounded-xl border border-ice/20 bg-ice/10 px-3 py-2 text-xs text-ice">
      {sportName} is in demo mode: fictional teams, simulated results and simulated book lines, rated by the real model.{" "}
      <Link href="/settings" className="underline underline-offset-2">Add an API-Sports key</Link> for live games.
    </div>
  );
}
