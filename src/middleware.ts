import { NextResponse, type NextRequest } from "next/server";
const SPORTS = ["basketball", "baseball", "hockey"];
/** Remember the last sport (so "/" opens it) and give each device an anonymous id for slips. */
export function middleware(req: NextRequest) {
  const first = req.nextUrl.pathname.split("/")[1];
  const res = NextResponse.next();
  if (SPORTS.includes(first) && req.cookies.get("eb_sport")?.value !== first) res.cookies.set("eb_sport", first, { path: "/", maxAge: 31536000, sameSite: "lax" });
  if (!req.cookies.get("eb_device")?.value) res.cookies.set("eb_device", crypto.randomUUID(), { httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:", path: "/", maxAge: 31536000 });
  return res;
}
export const config = { matcher: ["/((?!_next|api|icons|sw.js|manifest.webmanifest|favicon).*)"] };
