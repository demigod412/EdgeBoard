import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import { GeistSans } from "geist/font/sans";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { BottomTabs, LeftRail } from "@/components/Chrome";
import { Disclaimer } from "@/components/Disclaimer";
import { InstallPrompt } from "@/components/InstallPrompt";
import { RouteProgress } from "@/components/RouteProgress";
import { Suspense } from "react";
import { isSport, type SportId } from "@/lib/sports";
import { ACCESS_COOKIE, IDLE_MINUTES, isOpenPath, readToken } from "@/lib/access";
import { secretFor } from "@/lib/accessSecret";
import { getSetting } from "@/lib/secrets";
import { UnlockScreen } from "@/components/UnlockScreen";

const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });
export const metadata: Metadata = {
  title: { default: "EdgeBoard — basketball, baseball and ice hockey probabilities", template: "%s · EdgeBoard" },
  description: "Win probability, overs and unders, handicaps and first-segment totals from one calibrated model per sport, with a public accuracy ledger. Not a bookmaker.",
  applicationName: "EdgeBoard",
  appleWebApp: { capable: true, title: "EdgeBoard", statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};
export const viewport: Viewport = { themeColor: "#0B1220", width: "device-width", initialScale: 1, viewportFit: "cover" };
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const c = (await cookies()).get("eb_sport")?.value ?? "";
  const fallback: SportId = isSport(c) ? c : "basketball";
  // Access gate: everything except Settings needs the code, if one is set.
  let locked = false;
  try {
    const stored = await getSetting<{ salt: string; hash: string } | null>("accessCode", null);
    if (stored) {
      const path = (await headers()).get("x-pathname") ?? "/";
      const t = await readToken((await cookies()).get(ACCESS_COOKIE)?.value, secretFor(stored));
      locked = !t.valid && !isOpenPath(path);
    }
  } catch { /* DB down: leave the app open rather than locking everyone out */ }
  return (
    <html lang="en" className={`${GeistSans.variable} ${mono.variable}`}>
      <body className="min-h-dvh font-sans antialiased">
        {/* Suspense because RouteProgress reads the query string. */}
        <Suspense fallback={null}><RouteProgress /></Suspense>
        {locked ? <UnlockScreen minutes={IDLE_MINUTES} /> : <>
        <div className="flex">
          <LeftRail fallback={fallback} />
          <div className="min-w-0 flex-1">
            <main className="mx-auto max-w-5xl px-4 pt-5 md:px-8 md:pt-8">{children}</main>
            <Disclaimer />
          </div>
        </div>
        <BottomTabs fallback={fallback} />
        <InstallPrompt />
        </>}
      </body>
    </html>
  );
}
