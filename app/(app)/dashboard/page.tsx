import Link from "next/link";
import { redirect } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { visibleNav } from "@/components/shell/nav-config";
import { requireUser } from "@/lib/auth";
import { byDate, compare, percentChange, summarizeServices, type ServiceTotalRow } from "@/lib/analytics";
import { getChurchSettings } from "@/lib/data/settings";
import { addDays, formatDate, isIsoDate, startOfMonth, startOfYear, todayInTimezone } from "@/lib/dates";
import { centsToChartNumber, formatCents, numericToCents } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { STATUS_LABELS, isRequisitionStatus, type RequisitionStatus } from "@/lib/workflow/status";
import { NeedsAttention } from "@/components/dashboard/needs-attention";
import { getNeedsAttention } from "@/lib/notifications/queries";
import { DashboardCharts } from "./dashboard-charts";
import { DateRangeFilter } from "./date-range-filter";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const user = await requireUser();
  if (!user.permissions.has("dashboard.view")) {
    const first = visibleNav(user.permissions)[0];
    redirect(first?.href ?? "/forbidden");
  }
  const settings = await getChurchSettings();
  const timezone = settings?.timezone ?? "UTC";
  const currency = settings?.currency_code ?? "USD";
  const today = todayInTimezone(timezone);
  const params = await searchParams;

  const to = typeof params.to === "string" && isIsoDate(params.to) ? params.to : today;
  const from = typeof params.from === "string" && isIsoDate(params.from) && params.from <= to ? params.from : addDays(to, -83);
  // YTD and MTD comparisons need data from the start of the year regardless of the chart range.
  const queryFrom = [from, startOfYear(to), addDays(to, -70)].sort()[0];

  const canAttendance = user.permissions.has("attendance.view");
  const canFinance = user.permissions.has("finance.view");
  const canRequisitions = user.permissions.has("requisitions.view");

  const supabase = await createSupabaseServerClient();
  const [totals, reqs, attention] = await Promise.all([
    canAttendance || canFinance
      ? supabase.rpc("service_category_totals", { p_from: queryFrom, p_to: to })
      : Promise.resolve({ data: [] as ServiceTotalRow[] }),
    canRequisitions
      ? supabase
          .from("requisitions")
          .select("status, estimated_total, approved_total, actual_total, submitted_at, departments(name)")
          .gte("submitted_at", `${from}T00:00:00Z`)
          .lte("submitted_at", `${addDays(to, 1)}T00:00:00Z`)
      : Promise.resolve({ data: [] }),
    getNeedsAttention(),
  ]);

  const summary = summarizeServices((totals.data ?? []) as ServiceTotalRow[]);
  const points = byDate(summary.services);
  const cmp = compare(points);
  const inRange = points.filter((p) => p.date >= from && p.date <= to);
  const latest = cmp.latest;

  // ---- Chart data (display numbers only) ----
  const label = (d: string) => formatDate(d, "short");
  const attendanceTrend = inRange.map((p) => ({ date: label(p.date), total: p.attendanceTotal }));
  const attendanceByCategory = inRange.map((p) => {
    const row: Record<string, string | number> = { date: label(p.date) };
    for (const c of summary.attendanceCategories) row[c.id] = p.attendance.get(c.id) ?? 0;
    return row;
  });
  const givingTrend = inRange.map((p) => ({ date: label(p.date), total: centsToChartNumber(p.financeTotal) }));
  const givingByCategoryCents = new Map<string, bigint>();
  for (const p of inRange) for (const [k, v] of p.finance) givingByCategoryCents.set(k, (givingByCategoryCents.get(k) ?? 0n) + v);
  const givingByCategory = summary.financeCategories
    .map((c) => ({ name: c.name, value: givingByCategoryCents.get(c.id) ?? 0n }))
    .filter((c) => c.value !== 0n);
  const monthStart = latest ? startOfMonth(latest.date) : startOfMonth(to);
  const monthPoints = points.filter((p) => p.date >= monthStart && p.date <= to);
  const mtdCumulative = cumulative(monthPoints).map((p) => ({ date: label(p.date), total: centsToChartNumber(p.running) }));

  type ReqRow = { status: string; estimated_total: string; approved_total: string; actual_total: string; departments: { name: string } | null };
  const reqRows = (reqs.data ?? []) as unknown as ReqRow[];
  const statusCounts = new Map<RequisitionStatus, number>();
  const deptSpend = new Map<string, { approved: bigint; actual: bigint }>();
  for (const r of reqRows) {
    if (isRequisitionStatus(r.status)) statusCounts.set(r.status, (statusCounts.get(r.status) ?? 0) + 1);
    const name = r.departments?.name ?? "Unknown";
    const d = deptSpend.get(name) ?? { approved: 0n, actual: 0n };
    d.approved += numericToCents(r.approved_total);
    d.actual += numericToCents(r.actual_total);
    deptSpend.set(name, d);
  }
  const openCount = reqRows.filter((r) => !["closed", "rejected"].includes(r.status)).length;
  const awaitingReview = (statusCounts.get("submitted") ?? 0) + (statusCounts.get("under_review") ?? 0);

  const latestAttendance = (id: string) => latest?.attendance.get(id) ?? 0;
  const previousAttendance = (id: string) => cmp.previous?.attendance.get(id) ?? null;
  const latestFinance = (id: string) => latest?.finance.get(id) ?? 0n;
  const previousFinance = (id: string) => cmp.previous?.finance.get(id) ?? null;
  const vsPrev = cmp.previous ? `vs ${formatDate(cmp.previous.date, "short")}` : undefined;

  return (
    <>
      <PageHeader
        eyebrow={latest ? `Latest service · ${formatDate(latest.date, "long")}` : "Welcome"}
        title={`Good ${greeting(timezone)}, ${user.fullName.split(" ")[0]}`}
        actions={
          user.permissions.has("attendance.enter") || user.permissions.has("finance.enter") ? (
            <ButtonLink href="/sunday" variant="gold">Enter this Sunday</ButtonLink>
          ) : null
        }
      />

      <NeedsAttention cards={attention} />

      <DateRangeFilter from={from} to={to} today={today} />

      {!latest && (canAttendance || canFinance) ? (
        <div className="mb-8 rounded-[var(--radius-card)] border border-dashed border-navy/20 bg-white/60 p-6 text-sm text-navy/70">
          No Sunday data has been recorded in this period yet.{" "}
          {user.permissions.has("finance.enter") || user.permissions.has("attendance.enter") ? (
            <Link href="/sunday" className="font-bold underline decoration-gold decoration-2 underline-offset-4">Record a Sunday</Link>
          ) : null}
        </div>
      ) : null}

      {latest && (canAttendance || canFinance) ? (
        <section aria-label="Latest Sunday" className="mb-8 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          {canFinance ? (
            <StatTile
              emphasis
              label="Total finance received"
              value={formatCents(latest.financeTotal, currency)}
              delta={percentChange(latest.financeTotal, cmp.previous?.financeTotal)}
              deltaLabel={vsPrev}
              className="col-span-2"
              sub={
                <span className="tabular">
                  4-wk avg {cmp.fourWeekAvgFinance !== null ? formatCents(cmp.fourWeekAvgFinance, currency) : "—"} · MTD{" "}
                  {formatCents(cmp.monthToDateFinance, currency)} · YTD {formatCents(cmp.yearToDateFinance, currency)}
                </span>
              }
            />
          ) : null}
          {canAttendance ? (
            <StatTile
              label="Total attendance"
              value={latest.attendanceTotal.toLocaleString()}
              delta={percentChange(latest.attendanceTotal, cmp.previous?.attendanceTotal)}
              deltaLabel={vsPrev}
              className="col-span-2"
              sub={<span className="tabular">4-wk avg {cmp.fourWeekAvgAttendance?.toLocaleString() ?? "—"} · {cmp.servicesThisYear} services this year</span>}
            />
          ) : null}
          {canAttendance
            ? summary.attendanceCategories.map((c) => (
                <StatTile
                  key={c.id}
                  label={c.name}
                  value={latestAttendance(c.id).toLocaleString()}
                  delta={percentChange(latestAttendance(c.id), previousAttendance(c.id))}
                  deltaLabel={vsPrev}
                />
              ))
            : null}
          {canFinance
            ? summary.financeCategories.map((c) => (
                <StatTile
                  key={c.id}
                  label={c.name}
                  value={formatCents(latestFinance(c.id), currency)}
                  delta={percentChange(latestFinance(c.id), previousFinance(c.id))}
                  deltaLabel={vsPrev}
                />
              ))
            : null}
        </section>
      ) : null}

      {canRequisitions ? (
        <section aria-label="Requisitions" className="mb-8 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          <StatTile label="Awaiting review" value={String(awaitingReview)} sub={<Link href="/requisitions?status=submitted" className="underline decoration-gold underline-offset-4">Review queue</Link>} />
          <StatTile label="Open requisitions" value={String(openCount)} sub="Submitted in this period" />
          <StatTile
            label="Approved"
            value={formatCents([...deptSpend.values()].reduce((s, d) => s + d.approved, 0n), currency)}
            sub="Approved amount, this period"
          />
          <StatTile
            label="Purchased"
            value={formatCents([...deptSpend.values()].reduce((s, d) => s + d.actual, 0n), currency)}
            sub="Actual cost reconciled"
          />
        </section>
      ) : null}

      <DashboardCharts
        currency={currency}
        canAttendance={canAttendance}
        canFinance={canFinance}
        canRequisitions={canRequisitions}
        attendanceTrend={attendanceTrend}
        attendanceByCategory={attendanceByCategory}
        attendanceSeries={summary.attendanceCategories.map((c) => ({ key: c.id, label: c.name }))}
        givingTrend={givingTrend}
        givingByCategory={givingByCategory.map((g) => ({ name: g.name, value: centsToChartNumber(g.value), formatted: formatCents(g.value, currency) }))}
        mtdCumulative={mtdCumulative}
        monthLabel={new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${monthStart}T00:00:00Z`))}
        statusCounts={[...statusCounts.entries()].map(([s, n]) => ({ name: STATUS_LABELS[s], value: n }))}
        deptSpend={[...deptSpend.entries()].map(([name, d]) => ({
          name,
          approved: centsToChartNumber(d.approved),
          actual: centsToChartNumber(d.actual),
          approvedText: formatCents(d.approved, currency),
          actualText: formatCents(d.actual, currency),
        }))}
      />
    </>
  );
}

function cumulative<T extends { financeTotal: bigint }>(points: T[]): (T & { running: bigint })[] {
  const out: (T & { running: bigint })[] = [];
  let running = 0n;
  for (const p of points) {
    running += p.financeTotal;
    out.push({ ...p, running });
  }
  return out;
}

function greeting(timezone: string): string {
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: timezone }).format(new Date()));
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}
