/**
 * Date helpers. Calendar dates ("YYYY-MM-DD") are handled as plain dates —
 * never converted through local time — so a Sunday stays a Sunday regardless
 * of the server's or the viewer's timezone. "Today" is always computed in the
 * church's configured timezone.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Today's calendar date in the given IANA timezone. */
export function todayInTimezone(timezone: string, now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    return parts; // en-CA formats as YYYY-MM-DD
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function dayOfWeek(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}

/** The most recent Sunday on or before the given date. */
export function mostRecentSunday(isoDate: string): string {
  return addDays(isoDate, -dayOfWeek(isoDate));
}

export function startOfMonth(isoDate: string): string {
  return `${isoDate.slice(0, 7)}-01`;
}

export function startOfYear(isoDate: string): string {
  return `${isoDate.slice(0, 4)}-01-01`;
}

export function startOfQuarter(isoDate: string): string {
  const month = Number(isoDate.slice(5, 7));
  const qMonth = Math.floor((month - 1) / 3) * 3 + 1;
  return `${isoDate.slice(0, 4)}-${String(qMonth).padStart(2, "0")}-01`;
}

export function formatDate(isoDate: string | null | undefined, style: "short" | "medium" | "long" = "medium"): string {
  if (!isoDate) return "—";
  const date = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "—";
  const options: Intl.DateTimeFormatOptions =
    style === "short"
      ? { month: "short", day: "numeric", timeZone: "UTC" }
      : style === "long"
        ? { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }
        : { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" };
  return new Intl.DateTimeFormat("en-US", options).format(date);
}

/** Format a timestamp in the church timezone. */
export function formatDateTime(timestamp: string | null | undefined, timezone: string): string {
  if (!timestamp) return "—";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: timezone,
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

/** Calendar date of a timestamp in the church timezone. */
export function dateInTimezone(timestamp: string, timezone: string): string {
  return todayInTimezone(timezone, new Date(timestamp));
}
