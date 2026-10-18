import { useMemo } from "react";
import { useStore } from "./queries";

/**
 * One way to write dates and counts across the app. Words follow the device
 * language (the UI is in that language); clock times follow the store's time
 * zone, so a manager abroad sees when a sale happened in the shop.
 */
export function createFormat(timeZone?: string) {
  const tz = timeZone && timeZone !== "UTC" ? { timeZone } : timeZone === "UTC" ? { timeZone: "UTC" } : {};
  const d = (v: string | Date) => (typeof v === "string" ? new Date(v.length === 10 ? `${v}T12:00:00Z` : v) : v);
  const ok = (v: string | Date | null | undefined): v is string | Date => !!v && !Number.isNaN(d(v).getTime());
  const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, { ...tz, ...o });
  const day = fmt({ day: "numeric", month: "short", year: "numeric" });
  const dayShort = fmt({ day: "numeric", month: "short" });
  const time = fmt({ hour: "2-digit", minute: "2-digit" });
  const weekday = fmt({ weekday: "short", day: "numeric" });
  const sameDay = (a: Date, b: Date) => dayShort.format(a) === dayShort.format(b) && a.getFullYear() === b.getFullYear();

  return {
    /** 18 Oct 2026 */
    date: (v: string | Date | null | undefined, fallback = "—") => (ok(v) ? day.format(d(v)) : fallback),
    /** Today 14:05 · Yesterday 09:12 · 12 Oct 16:40 */
    dateTime: (v: string | Date | null | undefined, fallback = "—") => {
      if (!ok(v)) return fallback;
      const at = d(v);
      const now = new Date();
      const yesterday = new Date(now.getTime() - 86_400_000);
      const prefix = sameDay(at, now) ? "Today" : sameDay(at, yesterday) ? "Yesterday" : at.getFullYear() === now.getFullYear() ? dayShort.format(at) : day.format(at);
      return `${prefix} ${time.format(at)}`;
    },
    time: (v: string | Date) => time.format(d(v)),
    /** Axis label for a day in a chart: "Mon 12". */
    tick: (v: string | Date) => weekday.format(d(v)),
    /** 12 – 18 Oct 2026, or 28 Sept – 4 Oct 2026 */
    range: (from: string, to: string) => {
      if (from === to) return day.format(d(from));
      const range = (Intl.DateTimeFormat.prototype as { formatRange?: (a: Date, b: Date) => string }).formatRange;
      return range ? range.call(day, d(from), d(to)) : `${dayShort.format(d(from))} – ${day.format(d(to))}`;
    },
    count: (n: number) => n.toLocaleString(),
  };
}

export type Format = ReturnType<typeof createFormat>;

export function useFormat(): Format {
  const tz = useStore()?.timezone;
  return useMemo(() => createFormat(tz), [tz]);
}
