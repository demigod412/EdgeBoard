import { addDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { TZ } from "@/lib/time";
import { DateStrip, type DayChip } from "./DateStrip";

/** Yesterday → +7 days, in WAT. */
export function DateNav({ active, base, extra = "" }: { active: string; base: string; extra?: string }) {
  const now = new Date();
  const days: DayChip[] = Array.from({ length: 9 }, (_, i) => {
    const d = addDays(now, i - 1);
    return { key: formatInTimeZone(d, TZ, "yyyy-MM-dd"), top: i === 0 ? "Yest." : i === 1 ? "Today" : i === 2 ? "Tmrw" : formatInTimeZone(d, TZ, "EEE"), num: formatInTimeZone(d, TZ, "d MMM") };
  });
  return <DateStrip days={days} active={active} base={base} extra={extra} />;
}
