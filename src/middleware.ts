import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, IDLE_MINUTES } from "@/lib/access";
const SPORTS = ["basketball", "baseball", "hockey"];
/** Remember the last sport (so "/" opens it) and give each device an anonymous id for slips. */
export function middleware(req: NextRequest) {
  const first = req.nextUrl.pathname.split("/")[1];
  const res = NextResponse.next({ request: { headers: new Headers([...req.headers, ["x-pathname", req.nextUrl.pathname]]) } });
  res.headers.set("x-pathname", req.nextUrl.pathname);
  // Re-set the unlock cookie on every page view: the 30-minute window measures inactivity, not session length.
  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  if (token) res.cookies.set(ACCESS_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:", path: "/", maxAge: IDLE_MINUTES * 60 });
  if (SPORTS.includes(first) && req.cookies.get("eb_sport")?.value !== first) res.cookies.set("eb_sport", first, { path: "/", maxAge: 31536000, sameSite: "lax" });
  if (!req.cookies.get("eb_device")?.value) res.cookies.set("eb_device", crypto.randomUUID(), { httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:", path: "/", maxAge: 31536000 });
  return res;
}
export const config = { matcher: ["/((?!_next|api|icons|sw.js|manifest.webmanifest|favicon).*)"] };
