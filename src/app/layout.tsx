import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { GeistSans } from "geist/font/sans";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { BottomTabs, LeftRail } from "@/components/Chrome";
import { Disclaimer } from "@/components/Disclaimer";
import { InstallPrompt } from "@/components/InstallPrompt";
import { isSport, type SportId } from "@/lib/sports";

const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });
export const metadata: Metadata = {
  title: { default: "EdgeBoard — basketball, baseball and ice hockey probabilities", template: "%s · EdgeBoard" },
  description: "Win probability, overs and unders, handicaps and first-segment totals from one calibrated model per sport, with a public accuracy ledger. Not a bookmaker.",
  applicationName: "EdgeBoard",
  appleWebApp: { capable: true, title: "EdgeBoard", statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};
export const viewport: Viewport = { themeColor: "#0B1220", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const c = (await cookies()).get("eb_sport")?.value ?? "";
  const fallback: SportId = isSport(c) ? c : "basketball";
  return (
    <html lang="en" className={`${GeistSans.variable} ${mono.variable}`}>
      <body className="min-h-dvh font-sans antialiased">
        <div className="flex">
          <LeftRail fallback={fallback} />
          <div className="min-w-0 flex-1">
            <main className="mx-auto max-w-5xl px-4 pt-5 md:px-8 md:pt-8">{children}</main>
            <Disclaimer />
          </div>
        </div>
        <BottomTabs fallback={fallback} />
        <InstallPrompt />
      </body>
    </html>
  );
}
