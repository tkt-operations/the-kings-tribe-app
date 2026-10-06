/**
 * Pure aggregation for the dashboard and reports. Input rows come from the
 * database (numeric values as strings); all money sums use BigInt cents.
 */
import { numericToCents, type Cents } from "./money";
import { startOfMonth, startOfQuarter, startOfYear } from "./dates";

export interface ServiceTotalRow {
  service_date: string;
  service_name: string;
  kind: "attendance" | "finance";
  category_id: string;
  category_name: string;
  sort_order: number;
  total: string;
}

export interface ServiceSummary {
  date: string;
  name: string;
  attendance: Map<string, number>; // category_id -> count
  finance: Map<string, Cents>; // category_id -> cents
  attendanceTotal: number;
  financeTotal: Cents;
}

export interface CategoryInfo {
  id: string;
  name: string;
  sortOrder: number;
}

export function summarizeServices(rows: ServiceTotalRow[]): {
  services: ServiceSummary[];
  attendanceCategories: CategoryInfo[];
  financeCategories: CategoryInfo[];
} {
  const byKey = new Map<string, ServiceSummary>();
  const attCats = new Map<string, CategoryInfo>();
  const finCats = new Map<string, CategoryInfo>();
  for (const row of rows) {
    const key = `${row.service_date}|${row.service_name}`;
    let s = byKey.get(key);
    if (!s) {
      s = { date: row.service_date, name: row.service_name, attendance: new Map(), finance: new Map(), attendanceTotal: 0, financeTotal: 0n };
      byKey.set(key, s);
    }
    if (row.kind === "attendance") {
      const n = Number(row.total);
      s.attendance.set(row.category_id, (s.attendance.get(row.category_id) ?? 0) + n);
      s.attendanceTotal += n;
      attCats.set(row.category_id, { id: row.category_id, name: row.category_name, sortOrder: row.sort_order });
    } else {
      const c = numericToCents(row.total);
      s.finance.set(row.category_id, (s.finance.get(row.category_id) ?? 0n) + c);
      s.financeTotal += c;
      finCats.set(row.category_id, { id: row.category_id, name: row.category_name, sortOrder: row.sort_order });
    }
  }
  const sortCats = (m: Map<string, CategoryInfo>) =>
    [...m.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  return {
    services: [...byKey.values()].sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name) : a.date < b.date ? -1 : 1)),
    attendanceCategories: sortCats(attCats),
    financeCategories: sortCats(finCats),
  };
}

/** Merge services on the same date (e.g. two services on one Sunday) into one week point. */
export function byDate(services: ServiceSummary[]): ServiceSummary[] {
  const map = new Map<string, ServiceSummary>();
  for (const s of services) {
    const existing = map.get(s.date);
    if (!existing) {
      map.set(s.date, { ...s, name: s.name, attendance: new Map(s.attendance), finance: new Map(s.finance) });
      continue;
    }
    existing.name = `${existing.name} + ${s.name}`;
    for (const [k, v] of s.attendance) existing.attendance.set(k, (existing.attendance.get(k) ?? 0) + v);
    for (const [k, v] of s.finance) existing.finance.set(k, (existing.finance.get(k) ?? 0n) + v);
    existing.attendanceTotal += s.attendanceTotal;
    existing.financeTotal += s.financeTotal;
  }
  return [...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

export interface Comparison {
  latest: ServiceSummary | null;
  previous: ServiceSummary | null;
  fourWeekAvgAttendance: number | null;
  fourWeekAvgFinance: Cents | null;
  monthToDateFinance: Cents;
  yearToDateFinance: Cents;
  monthToDateAttendance: number;
  yearToDateAttendance: number;
  servicesThisMonth: number;
  servicesThisYear: number;
}

/**
 * Compare the latest service date against the previous one, the average of the
 * four before it, and month/year to date (relative to the latest date).
 * `points` must be per-date (see byDate) and sorted ascending.
 */
export function compare(points: ServiceSummary[]): Comparison {
  const latest = points.at(-1) ?? null;
  const previous = points.at(-2) ?? null;
  const prior4 = points.slice(-5, -1);
  const fourWeekAvgAttendance = prior4.length ? Math.round(prior4.reduce((s, p) => s + p.attendanceTotal, 0) / prior4.length) : null;
  const fourWeekAvgFinance = prior4.length
    ? divRound(prior4.reduce((s, p) => s + p.financeTotal, 0n), BigInt(prior4.length))
    : null;
  let mtd = 0n;
  let ytd = 0n;
  let mtdAtt = 0;
  let ytdAtt = 0;
  let mCount = 0;
  let yCount = 0;
  if (latest) {
    const m = startOfMonth(latest.date);
    const y = startOfYear(latest.date);
    for (const p of points) {
      if (p.date > latest.date) continue;
      if (p.date >= y) {
        ytd += p.financeTotal;
        ytdAtt += p.attendanceTotal;
        yCount += 1;
      }
      if (p.date >= m) {
        mtd += p.financeTotal;
        mtdAtt += p.attendanceTotal;
        mCount += 1;
      }
    }
  }
  return {
    latest,
    previous,
    fourWeekAvgAttendance,
    fourWeekAvgFinance,
    monthToDateFinance: mtd,
    yearToDateFinance: ytd,
    monthToDateAttendance: mtdAtt,
    yearToDateAttendance: ytdAtt,
    servicesThisMonth: mCount,
    servicesThisYear: yCount,
  };
}

function divRound(n: bigint, d: bigint): bigint {
  if (d === 0n) return 0n;
  const neg = n < 0n;
  const a = neg ? -n : n;
  const q = (a + d / 2n) / d;
  return neg ? -q : q;
}

export function percentChange(current: number | bigint, previous: number | bigint | null | undefined): number | null {
  if (previous === null || previous === undefined) return null;
  const c = Number(current);
  const p = Number(previous);
  if (p === 0) return null;
  return ((c - p) / Math.abs(p)) * 100;
}

export type Period = "week" | "month" | "quarter" | "year";

export function periodKey(date: string, period: Period): string {
  switch (period) {
    case "week":
      return date;
    case "month":
      return startOfMonth(date);
    case "quarter":
      return startOfQuarter(date);
    case "year":
      return startOfYear(date);
  }
}

export interface PeriodRow {
  period: string;
  services: number;
  attendance: Map<string, number>;
  attendanceTotal: number;
  finance: Map<string, Cents>;
  financeTotal: Cents;
}

export function groupByPeriod(points: ServiceSummary[], period: Period): PeriodRow[] {
  const map = new Map<string, PeriodRow>();
  for (const p of points) {
    const key = periodKey(p.date, period);
    let row = map.get(key);
    if (!row) {
      row = { period: key, services: 0, attendance: new Map(), attendanceTotal: 0, finance: new Map(), financeTotal: 0n };
      map.set(key, row);
    }
    row.services += 1;
    row.attendanceTotal += p.attendanceTotal;
    row.financeTotal += p.financeTotal;
    for (const [k, v] of p.attendance) row.attendance.set(k, (row.attendance.get(k) ?? 0) + v);
    for (const [k, v] of p.finance) row.finance.set(k, (row.finance.get(k) ?? 0n) + v);
  }
  return [...map.values()].sort((a, b) => (a.period < b.period ? -1 : 1));
}
