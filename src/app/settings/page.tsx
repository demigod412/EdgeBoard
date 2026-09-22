import { Card, SectionTitle } from "@/components/ui";
import { getSetting, secretSource, SECRET_NAMES } from "@/lib/secrets";
import { DEFAULT_FLOORS, type Floors } from "@/lib/picks";
import { TZ } from "@/lib/time";
import { isAdmin } from "./actions";
import { FloorsForm, KeysForm, UnlockForm } from "./forms";
export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";
export default async function Settings() {
  const admin = await isAdmin();
  const sources = Object.fromEntries(await Promise.all(SECRET_NAMES.map(async (n) => [n, await secretSource(n)] as const)));
  const floors = { ...DEFAULT_FLOORS, ...(await getSetting<Partial<Floors>>("floors", {})) };
  const choice = await getSetting<Record<string, string>>("sources", {});
  const enabled = await getSetting<Record<string, boolean>>("sportsEnabled", { basketball: true, baseball: true, hockey: true });
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <Card><SectionTitle>Data source</SectionTitle>
        <p className="mb-4 text-xs text-slate-400">Free sources by default: MLB Stats API and NHL API need no key; NBA needs a free balldontlie key. API-Sports (paid) adds bookmaker odds and more leagues. Keys stay on the server; pages read only the database.</p>
        {admin ? <KeysForm sources={sources} enabled={enabled} choice={choice} /> : <UnlockForm />}</Card>
      <Card><SectionTitle>Floors</SectionTitle>
        {admin ? <FloorsForm floors={floors} /> : <p className="text-sm text-slate-400">Strong floor <span className="num">{floors.strong}</span>, safe floor <span className="num">{floors.safe}</span>. Unlock to edit.</p>}
        <p className="mt-3 text-xs text-slate-500">New floors apply to scanners immediately and to strong-line picks from the next prediction run.</p></Card>
      <Card><SectionTitle>Display</SectionTitle><p className="text-sm text-slate-400">Start times in <span className="text-slate-200">{TZ}</span> with UTC underneath.</p></Card>
    </div>
  );
}
