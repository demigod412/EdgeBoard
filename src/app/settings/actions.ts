"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createHmac } from "node:crypto";
import { checkPin, setSecret, setSetting, SECRET_NAMES, type SecretName } from "@/lib/secrets";
import { getProvider } from "@/lib/providers";
import { DEFAULT_FLOORS, type Floors } from "@/lib/picks";
import { isSport, SPORT_IDS } from "@/lib/sports";

const sig = () => createHmac("sha256", (process.env.SETTINGS_ENCRYPTION_KEY ?? "") + (process.env.SETTINGS_PIN ?? "")).update("eb-admin").digest("hex");
async function isAdmin() { return (await cookies()).get("eb_admin")?.value === sig() && !!process.env.SETTINGS_PIN; }

export type ActionState = { ok: boolean; message: string } | null;

export async function unlock(_: ActionState, fd: FormData): Promise<ActionState> {
  if (!process.env.SETTINGS_PIN) return { ok: false, message: "Set SETTINGS_PIN in the server environment first." };
  if (!checkPin(String(fd.get("pin") ?? ""))) return { ok: false, message: "PIN not recognised." };
  (await cookies()).set("eb_admin", sig(), { httpOnly: true, secure: true, sameSite: "strict", path: "/settings", maxAge: 3600 });
  revalidatePath("/settings");
  return { ok: true, message: "Unlocked for one hour." };
}

export async function saveKeys(_: ActionState, fd: FormData): Promise<ActionState> {
  if (!(await isAdmin())) return { ok: false, message: "Unlock with your PIN first." };
  try {
    for (const n of SECRET_NAMES) {
      const v = fd.get(n);
      if (typeof v === "string" && v.length) await setSecret(n as SecretName, v === "__clear__" ? "" : v);
    }
    const enabled = Object.fromEntries(SPORT_IDS.map((sp) => [sp, fd.get(`enable_${sp}`) === "on"]));
    await setSetting("sportsEnabled", enabled);
    const choice = Object.fromEntries(SPORT_IDS.map((sp) => [sp, fd.get(`source_${sp}`) === "api-sports" ? "api-sports" : "open"]));
    await setSetting("sources", choice);
    revalidatePath("/", "layout");
    return { ok: true, message: "Saved. Keys are encrypted server-side and never sent back to the browser." };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
}

export async function testConnection(_: ActionState, fd: FormData): Promise<ActionState> {
  if (!(await isAdmin())) return { ok: false, message: "Unlock with your PIN first." };
  const sport = String(fd.get("sport"));
  if (!isSport(sport)) return { ok: false, message: "Unknown sport." };
  const p = await getProvider(sport);
  if (!p) return { ok: false, message: "No API-Sports key saved, or this sport is switched off." };
  const r = await p.testConnection();
  return { ok: r.ok, message: r.message };
}

export async function saveFloors(_: ActionState, fd: FormData): Promise<ActionState> {
  if (!(await isAdmin())) return { ok: false, message: "Unlock with your PIN first." };
  const f: Floors = { ...DEFAULT_FLOORS };
  for (const k of Object.keys(DEFAULT_FLOORS) as (keyof Floors)[]) { const v = Number(fd.get(k)); if (Number.isFinite(v) && v >= 0.55 && v < 0.99) f[k] = v; }
  await setSetting("floors", f);
  revalidatePath("/", "layout");
  return { ok: true, message: "Floors saved." };
}

export { isAdmin };
