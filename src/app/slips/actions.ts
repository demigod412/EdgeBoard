"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { marketsOf } from "@/lib/picks";
import { addLeg, dropLowConfidence, dropWeakest, mergeSlips, removeLeg, splitInTwo, trimToTarget, type Leg } from "@/lib/slips";
import { sportybetBook } from "@/lib/booking/sportybet";
import { SPORT_IDS, SPORT_ENUM } from "@/lib/sports";

export type SlipResult = { ok: boolean; message: string };
const legsOf = (x: Prisma.JsonValue) => (Array.isArray(x) ? (x as unknown as Leg[]) : []);
const asJson = (legs: Leg[]) => legs as unknown as Prisma.InputJsonValue;
const sportOf = (e: string) => SPORT_IDS.find((s) => SPORT_ENUM[s] === e)!;

async function device() {
  const jar = await cookies();
  let d = jar.get("eb_device")?.value;
  if (!d) { d = crypto.randomUUID(); jar.set("eb_device", d, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 31536000 }); }
  return d;
}
async function ownSlip(id: string) {
  const s = await prisma.slip.findUnique({ where: { id } });
  if (!s || s.ownerKey !== (await device())) throw new Error("Slip not found.");
  return s;
}
async function activeSlip() {
  const owner = await device(), jar = await cookies(), id = jar.get("eb_slip")?.value;
  const cur = id ? await prisma.slip.findFirst({ where: { id, ownerKey: owner } }) : null;
  if (cur) return cur;
  const n = await prisma.slip.count({ where: { ownerKey: owner } });
  const s = await prisma.slip.create({ data: { ownerKey: owner, name: `Slip ${n + 1}`, legs: [] } });
  jar.set("eb_slip", s.id, { sameSite: "lax", path: "/", maxAge: 31536000 });
  return s;
}
const done = (message: string, ok = true): SlipResult => { revalidatePath("/slips"); return { ok, message }; };
const reset = { bookingCode: null, bookingUrl: null, bookingNote: null };

/** One leg per game; a new market on the same game replaces the old one. Legs can mix sports. */
export async function addToSlip(gameId: string, market: string): Promise<SlipResult> {
  try {
    const g = await prisma.game.findUnique({ where: { id: gameId }, include: { homeTeam: true, awayTeam: true, predictions: { orderBy: { revision: "desc" }, take: 1 } } });
    const p = g?.predictions[0];
    if (!g || !p) return { ok: false, message: "No prediction for this game yet." };
    if (g.status !== "SCHEDULED" || g.startUtc <= new Date()) return { ok: false, message: "This game has already started." };
    const m = marketsOf(p).find((x) => x.key === market);
    if (!m) return { ok: false, message: "That market isn't available for this game." };
    const slip = await activeSlip();
    const r = addLeg(legsOf(slip.legs), { gameId, sport: sportOf(g.sport), market, label: m.label, match: `${g.awayTeam.shortName ?? g.awayTeam.name} at ${g.homeTeam.shortName ?? g.homeTeam.name}`, start: g.startUtc.toISOString(), p: m.p, band: p.band, addedAt: new Date().toISOString() });
    if (r.full) return { ok: false, message: "Slip is full (30 legs)." };
    await prisma.slip.update({ where: { id: slip.id }, data: { legs: asJson(r.legs), ...reset } });
    return done(r.replaced ? `Replaced the pick for this game in ${slip.name}` : `Added to ${slip.name}`);
  } catch (e) { return { ok: false, message: (e as Error).message }; }
}
export async function newSlip(): Promise<SlipResult> {
  const owner = await device(), n = await prisma.slip.count({ where: { ownerKey: owner } });
  const s = await prisma.slip.create({ data: { ownerKey: owner, name: `Slip ${n + 1}`, legs: [] } });
  (await cookies()).set("eb_slip", s.id, { sameSite: "lax", path: "/", maxAge: 31536000 });
  return done(`Created ${s.name}`);
}
export async function selectSlip(id: string): Promise<SlipResult> { const s = await ownSlip(id); (await cookies()).set("eb_slip", s.id, { sameSite: "lax", path: "/", maxAge: 31536000 }); return done(`${s.name} is now active`); }
export async function renameSlip(id: string, name: string): Promise<SlipResult> { await ownSlip(id); await prisma.slip.update({ where: { id }, data: { name: name.trim().slice(0, 40) || "Slip" } }); return done("Renamed"); }
export async function deleteSlip(id: string): Promise<SlipResult> { await ownSlip(id); await prisma.slip.delete({ where: { id } }); return done("Slip deleted"); }
export async function removeFromSlip(id: string, gameId: string): Promise<SlipResult> {
  const s = await ownSlip(id); await prisma.slip.update({ where: { id }, data: { legs: asJson(removeLeg(legsOf(s.legs), gameId)), ...reset } }); return done("Leg removed");
}
export async function optimiseSlip(id: string, mode: "weakest" | "low" | "target", target = 0.25): Promise<SlipResult> {
  const s = await ownSlip(id), legs = legsOf(s.legs);
  const r = mode === "weakest" ? dropWeakest(legs) : mode === "low" ? dropLowConfidence(legs) : trimToTarget(legs, target);
  await prisma.slip.update({ where: { id }, data: { legs: asJson(r.legs), ...reset } });
  return done(r.dropped.length ? `Dropped ${r.dropped.length}: ${r.dropped.map((l) => l.match).join(", ")}` : "Nothing to drop");
}
export async function splitSlip(id: string): Promise<SlipResult> {
  const s = await ownSlip(id), legs = legsOf(s.legs);
  if (legs.length < 2) return { ok: false, message: "Need at least 2 legs to split." };
  const [a, b] = splitInTwo(legs);
  await prisma.slip.update({ where: { id }, data: { legs: asJson(a), name: `${s.name} (A)`, ...reset } });
  await prisma.slip.create({ data: { ownerKey: s.ownerKey, name: `${s.name} (B)`, legs: asJson(b) } });
  return done("Split into two slips of similar strength");
}
export async function mergeInto(targetId: string, sourceId: string): Promise<SlipResult> {
  if (targetId === sourceId) return { ok: false, message: "Pick a different slip to merge." };
  const t = await ownSlip(targetId), s = await ownSlip(sourceId);
  const r = mergeSlips(legsOf(t.legs), legsOf(s.legs));
  await prisma.slip.update({ where: { id: t.id }, data: { legs: asJson(r.legs), ...reset } });
  await prisma.slip.delete({ where: { id: s.id } });
  return done(r.duplicates.length ? `Merged. Same game in both (kept the stronger pick): ${r.duplicates.join(", ")}` : `Merged ${s.name} into ${t.name}`);
}
/** Resolve games + markets and ask Sportybet for a code. Shared by slips and the Blend builder. */
async function bookLegs(legs: { gameId: string; market: string; label: string }[]) {
  const games = await prisma.game.findMany({ where: { id: { in: legs.map((l) => l.gameId) } }, include: { homeTeam: true, awayTeam: true, predictions: { orderBy: { revision: "desc" }, take: 1 } } });
  const r = await sportybetBook(legs.flatMap((l) => {
    const g = games.find((x) => x.id === l.gameId), m = g?.predictions[0] ? marketsOf(g.predictions[0]).find((x) => x.key === l.market) : null, sp = g ? sportOf(g.sport) : null;
    return g && m && sp && g.startUtc > new Date() ? [{ gameId: g.id, sport: sp, mkt: m, home: g.homeTeam.name, away: g.awayTeam.name, start: g.startUtc, label: l.label }] : [];
  }));
  const note = r.unbookable.length ? `Not booked: ${r.unbookable.map((u) => `${u.label} (${u.reason})`).join("; ")}` : null;
  return { ...r, note };
}

export type BookResult = { ok: boolean; message: string; code: string | null; url: string | null; note: string | null };
/** Blend builder: book the selected legs directly (nothing is saved). */
export async function bookBlend(legs: { gameId: string; market: string; label: string }[]): Promise<BookResult> {
  if (process.env.SPORTYBET_ENABLED === "false") return { ok: false, message: "Sportybet export is switched off on this server.", code: null, url: null, note: null };
  if (!legs.length) return { ok: false, message: "Pick at least one leg.", code: null, url: null, note: null };
  try {
    const r = await bookLegs(legs.slice(0, 30));
    return r.code ? { ok: true, message: r.note ? "Code created — some legs could not be booked." : "Code created.", code: r.code, url: r.url, note: r.note }
      : { ok: false, message: r.note ?? "No legs could be booked.", code: null, url: null, note: r.note };
  } catch (e) {
    return { ok: false, message: `Sportybet export failed: ${(e as Error).message}. Sportybet may block servers outside Nigeria; the text can still be copied.`, code: null, url: null, note: null };
  }
}

export async function bookSportybet(id: string): Promise<SlipResult> {
  if (process.env.SPORTYBET_ENABLED === "false") return { ok: false, message: "Sportybet export is switched off on this server." };
  const s = await ownSlip(id), legs = legsOf(s.legs).filter((l) => new Date(l.start) > new Date());
  if (!legs.length) return { ok: false, message: "No upcoming legs to book." };
  try {
    const r = await bookLegs(legs);
    const note = r.note;
    await prisma.slip.update({ where: { id }, data: { bookingCode: r.code, bookingUrl: r.url, bookingAt: new Date(), bookingNote: note } });
    return done(r.code ? `Sportybet code ${r.code}${note ? " (some legs could not be booked)" : ""}` : note ?? "No legs could be booked.", !!r.code);
  } catch (e) {
    const msg = `Sportybet export failed: ${(e as Error).message}. Sportybet may block servers outside Nigeria; the slip text can still be copied.`;
    await prisma.slip.update({ where: { id }, data: { bookingNote: msg, bookingAt: new Date() } });
    return done(msg, false);
  }
}
