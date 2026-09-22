import { notFound } from "next/navigation";
import { SportSwitcher } from "@/components/Chrome";
import { DemoBanner } from "@/components/DemoBanner";
import { dataMode } from "@/lib/mode";
import { isSport, SPORTS } from "@/lib/sports";

export const dynamic = "force-dynamic";
export default async function SportLayout({ children, params }: { children: React.ReactNode; params: Promise<{ sport: string }> }) {
  const { sport } = await params;
  if (!isSport(sport)) notFound();
  const mode = await dataMode(sport);
  return (
    <>
      <div className="mb-4"><SportSwitcher fallback={sport} /></div>
      <DemoBanner demo={mode.demo} sportName={SPORTS[sport].name} />
      {children}
    </>
  );
}
