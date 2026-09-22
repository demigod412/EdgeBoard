"use client";
import { lockNow, saveAccessCode } from "@/app/unlock/actions";
import { useActionState, useState, useTransition } from "react";
import { saveFloors, saveKeys, testConnection, unlock, type ActionState } from "./actions";
import { cn } from "@/components/ui";

const input = "focus-ring w-full rounded-lg border hairline bg-black/30 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600";
const btn = "focus-ring rounded-lg border border-edge/40 px-3 py-1.5 text-sm text-edge hover:bg-edge/10 disabled:opacity-50";
const Status = ({ s }: { s: ActionState }) => (s ? <p role="status" className={cn("mt-2 text-xs", s.ok ? "text-edge" : "text-miss")}>{s.message}</p> : null);

export function UnlockForm() {
  const [s, act, pending] = useActionState(unlock, null);
  return (
    <form action={act} className="flex flex-wrap items-end gap-2">
      <label className="flex-1 text-xs text-slate-400">Settings PIN<input name="pin" type="password" inputMode="numeric" autoComplete="off" className={input} /></label>
      <button className={btn} disabled={pending}>Unlock</button><div className="w-full"><Status s={s} /></div>
    </form>
  );
}

export function KeysForm({ sources, enabled, choice }: { sources: Record<string, string>; enabled: Record<string, boolean>; choice: Record<string, string> }) {
  const [s, act, pending] = useActionState(saveKeys, null);
  const [t, test, testing] = useActionState(testConnection, null);
  const keys = [["BALLDONTLIE_API_KEY", "balldontlie key (free NBA data — app.balldontlie.io)"], ["API_SPORTS_KEY", "API-Sports key (paid plan for current seasons)"], ["RAPIDAPI_KEY", "Or: RapidAPI key for API-Sports"], ["OPENAI_API_KEY", "OpenAI key (rationale wording only)"]];
  return (
    <div className="space-y-4">
      <form action={act} className="space-y-3">
        {keys.map(([k, label]) => (
          <label key={k} className="block text-xs text-slate-400">
            <span className="flex justify-between">{label}<span className={sources[k] === "none" ? "text-slate-600" : "text-edge"}>{sources[k] === "env" ? "set in env (wins)" : sources[k] === "settings" ? "saved" : "not set"}</span></span>
            <input name={k} type="password" autoComplete="off" disabled={sources[k] === "env"} placeholder={sources[k] !== "none" ? "•••••••• (leave blank to keep)" : "Paste key"} className={input} />
          </label>
        ))}
        <fieldset className="space-y-2 text-sm"><legend className="mb-1 text-xs text-slate-400">Data source per sport</legend>
          {[["basketball", "Basketball", "Free: balldontlie (NBA)"], ["baseball", "Baseball", "Free: MLB Stats API (MLB, probable pitchers)"], ["hockey", "Ice hockey", "Free: NHL API (NHL)"]].map(([sp, label, free]) => (
            <label key={sp} className="flex flex-wrap items-center justify-between gap-2"><span>{label}</span>
              <select name={`source_${sp}`} defaultValue={choice[sp] ?? "open"} className="focus-ring rounded-lg border hairline bg-black/30 px-2 py-1.5 text-xs text-slate-100">
                <option value="open">{free}</option><option value="api-sports">API-Sports (paid: odds + more leagues)</option>
              </select>
            </label>
          ))}
        </fieldset>
        <fieldset className="flex flex-wrap gap-4 text-sm"><legend className="mb-1 text-xs text-slate-400">Sports to sync</legend>
          {["basketball", "baseball", "hockey"].map((sp) => <label key={sp} className="flex items-center gap-2 capitalize"><input type="checkbox" name={`enable_${sp}`} defaultChecked={enabled[sp] !== false} className="accent-[#C8F542]" />{sp === "hockey" ? "Ice hockey" : sp}</label>)}
        </fieldset>
        <button className={btn} disabled={pending}>Save</button><Status s={s} />
      </form>
      <form action={test} className="flex flex-wrap items-end gap-2 border-t hairline pt-4">
        <label className="flex-1 text-xs text-slate-400">Test connection
          <select name="sport" className={input}><option value="basketball">Basketball</option><option value="baseball">Baseball</option><option value="hockey">Ice hockey</option></select>
        </label>
        <button className={btn} disabled={testing}>{testing ? "Testing…" : "Test connection"}</button><div className="w-full"><Status s={t} /></div>
      </form>
    </div>
  );
}

export function FloorsForm({ floors }: { floors: { strong: number; safe: number } }) {
  const [s, act, pending] = useActionState(saveFloors, null);
  return (
    <form action={act} className="grid gap-3 sm:grid-cols-2">
      <label className="text-xs text-slate-400">Strong line floor<input name="strong" type="number" step="0.01" min="0.55" max="0.95" defaultValue={floors.strong} className={cn(input, "num")} /></label>
      <label className="text-xs text-slate-400">Safe floor (High confidence only)<input name="safe" type="number" step="0.01" min="0.6" max="0.95" defaultValue={floors.safe} className={cn(input, "num")} /></label>
      <div className="sm:col-span-2"><button className={btn} disabled={pending}>Save floors</button><Status s={s} /></div>
    </form>
  );
}

export function AccessCodeForm({ isSet }: { isSet: boolean }) {
  const [code, setCode] = useState("");
  const [s, setS] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; message: string }>) => start(async () => { setS(await fn()); setCode(""); });
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">
        {isSet ? "An access code is set: everyone is asked for it before seeing predictions, and the app locks again after 30 minutes of inactivity. Settings always stays reachable with your PIN."
          : "No access code: anyone with the link can see the app. Set one to keep it private."}
      </p>
      <div className="flex flex-wrap gap-2">
        <input value={code} onChange={(e) => setCode(e.target.value)} type="text" autoComplete="off" placeholder={isSet ? "New code (4–32 characters)" : "Access code (4–32 characters)"}
          className="focus-ring min-w-0 flex-1 rounded-lg border hairline bg-black/30 px-3 py-2 text-sm text-slate-100" />
        <button className={btn} disabled={pending || code.trim().length < 4} onClick={() => run(() => saveAccessCode(code))}>{isSet ? "Change code" : "Set code"}</button>
        {isSet && <button className={btn} disabled={pending} onClick={() => run(() => saveAccessCode(null))}>Remove code</button>}
        {isSet && <button className={btn} disabled={pending} onClick={() => run(lockNow)}>Lock this device now</button>}
      </div>
      <Status s={s} />
    </div>
  );
}
