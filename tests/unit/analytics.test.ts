import { describe, expect, it } from "vitest";
import { byDate, compare, groupByPeriod, percentChange, summarizeServices, type ServiceTotalRow } from "@/lib/analytics";
import { centsToDecimal } from "@/lib/money";

function rows(date: string, adults: number, kids: number, tithe: string, offering: string, name = "Sunday Service"): ServiceTotalRow[] {
  return [
    { service_date: date, service_name: name, kind: "attendance", category_id: "a", category_name: "Adult Church", sort_order: 10, total: String(adults) },
    { service_date: date, service_name: name, kind: "attendance", category_id: "c", category_name: "Children's Church", sort_order: 20, total: String(kids) },
    { service_date: date, service_name: name, kind: "finance", category_id: "t", category_name: "Tithe", sort_order: 20, total: tithe },
    { service_date: date, service_name: name, kind: "finance", category_id: "o", category_name: "Offering", sort_order: 10, total: offering },
  ];
}

const data = [
  ...rows("2026-08-30", 100, 20, "1000.10", "200.20"),
  ...rows("2026-09-06", 110, 22, "1100.00", "210.00"),
  ...rows("2026-09-13", 120, 24, "1200.00", "220.00"),
  ...rows("2026-09-20", 130, 26, "1300.00", "230.00"),
  ...rows("2026-09-27", 140, 28, "1400.00", "240.00"),
  ...rows("2026-10-04", 150, 30, "1500.05", "250.05"),
];

describe("analytics", () => {
  it("summarizes services and orders categories", () => {
    const s = summarizeServices(data);
    expect(s.services).toHaveLength(6);
    expect(s.financeCategories.map((c) => c.name)).toEqual(["Offering", "Tithe"]);
    expect(s.services[0].attendanceTotal).toBe(120);
    expect(centsToDecimal(s.services[0].financeTotal)).toBe("1200.30");
  });

  it("compares latest vs previous, 4-week average, MTD and YTD", () => {
    const points = byDate(summarizeServices(data).services);
    const c = compare(points);
    expect(c.latest?.date).toBe("2026-10-04");
    expect(c.latest?.attendanceTotal).toBe(180);
    expect(c.previous?.attendanceTotal).toBe(168);
    // average of 09-06..09-27 totals: 132,144,156,168 → 150
    expect(c.fourWeekAvgAttendance).toBe(150);
    expect(centsToDecimal(c.fourWeekAvgFinance!)).toBe("1475.00");
    expect(centsToDecimal(c.monthToDateFinance)).toBe("1750.10");
    expect(c.servicesThisMonth).toBe(1);
    expect(centsToDecimal(c.yearToDateFinance)).toBe(
      centsToDecimal(points.reduce((s, p) => s + p.financeTotal, 0n)),
    );
    expect(percentChange(180, 168)?.toFixed(2)).toBe("7.14");
    expect(percentChange(5, 0)).toBeNull();
  });

  it("merges two services on the same date", () => {
    const merged = byDate(summarizeServices([...rows("2026-10-04", 10, 1, "1", "1"), ...rows("2026-10-04", 5, 1, "2", "2", "Evening")]).services);
    expect(merged).toHaveLength(1);
    expect(merged[0].attendanceTotal).toBe(17);
    expect(centsToDecimal(merged[0].financeTotal)).toBe("6.00");
  });

  it("groups by month and quarter", () => {
    const points = byDate(summarizeServices(data).services);
    const months = groupByPeriod(points, "month");
    expect(months.map((m) => [m.period, m.services])).toEqual([["2026-08-01", 1], ["2026-09-01", 4], ["2026-10-01", 1]]);
    const quarters = groupByPeriod(points, "quarter");
    expect(quarters.map((q) => q.period)).toEqual(["2026-07-01", "2026-10-01"]);
    expect(centsToDecimal(months[1].finance.get("t")!)).toBe("5000.00");
  });
});
