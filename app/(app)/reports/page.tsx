import Link from "next/link";
import { Download } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { requirePagePermission } from "@/lib/auth";
import { groupByPeriod, type Period } from "@/lib/analytics";
import { cn } from "@/lib/cn";
import { loadRequisitionItemRows, loadRequisitionRows, loadServiceData } from "@/lib/data/reports";
import { getChurchSettings } from "@/lib/data/settings";
import { addDays, formatDate, isIsoDate, startOfYear, todayInTimezone } from "@/lib/dates";
import { formatCents, formatMoney } from "@/lib/money";
import { summarizeItemPriorities, summarizeRequisitions, type Bucket } from "@/lib/reports";
import { PriorityBadge } from "@/components/ui/priority-badge";
import { STATUS_LABELS, isRequisitionStatus } from "@/lib/workflow/status";

export const metadata = { title: "Reports" };

const PERIODS: { key: Period; label: string }[] = [
  { key: "week", label: "Weekly" },
  { key: "month", label: "Monthly" },
  { key: "quarter", label: "Quarterly" },
  { key: "year", label: "Yearly" },
];

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const user = await requirePagePermission("reports.view");
  const settings = await getChurchSettings();
  const tz = settings?.timezone ?? "UTC";
  const currency = settings?.currency_code ?? "USD";
  const today = todayInTimezone(tz);
  const params = await searchParams;
  const str = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : "");

  const tabs = [
    user.permissions.has("attendance.view") && { key: "attendance", label: "Attendance" },
    user.permissions.has("finance.view") && { key: "finance", label: "Finance" },
    user.permissions.has("requisitions.view") && { key: "requisitions", label: "Requisitions & purchasing" },
  ].filter(Boolean) as { key: string; label: string }[];
  const tab = tabs.find((t) => t.key === str("tab"))?.key ?? tabs[0]?.key;
  const to = isIsoDate(str("to")) ? str("to") : today;
  const from = isIsoDate(str("from")) && str("from") <= to ? str("from") : startOfYear(to);
  const period = (PERIODS.find((p) => p.key === str("period"))?.key ?? "month") as Period;
  const exportHref = `/reports/export?type=${tab}&from=${from}&to=${to}&period=${period}`;

  let body: React.ReactNode = <p className="text-sm text-navy/60">You do not have access to any reports yet.</p>;

  if (tab === "attendance" || tab === "finance") {
    const data = await loadServiceData(from, to);
    const rows = groupByPeriod(data.points, period);
    const isAttendance = tab === "attendance";
    const cats = isAttendance ? data.attendanceCategories : data.financeCategories;
    const grand = rows.reduce(
      (acc, r) => ({ services: acc.services + r.services, attendance: acc.attendance + r.attendanceTotal, finance: acc.finance + r.financeTotal }),
      { services: 0, attendance: 0, finance: 0n },
    );
    const categoryTotals = cats.map((c) => ({
      name: c.name,
      attendance: rows.reduce((s, r) => s + (r.attendance.get(c.id) ?? 0), 0),
      finance: rows.reduce((s, r) => s + (r.finance.get(c.id) ?? 0n), 0n),
    }));
    body = (
      <>
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Services" value={String(grand.services)} sub={`${formatDate(from)} – ${formatDate(to)}`} />
          {isAttendance ? (
            <>
              <StatTile label="Total attendance" value={grand.attendance.toLocaleString()} sub="All categories" />
              <StatTile label="Average per service" value={grand.services ? Math.round(grand.attendance / grand.services).toLocaleString() : "—"} sub="Attendance" />
            </>
          ) : (
            <>
              <StatTile emphasis label="Total giving" value={formatCents(grand.finance, currency)} sub="All categories" />
              <StatTile label="Average per service" value={grand.services ? formatCents(grand.finance / BigInt(grand.services), currency) : "—"} sub="Giving" />
            </>
          )}
          <StatTile label="Categories" value={String(cats.length)} sub={isAttendance ? "Attendance categories with data" : "Finance categories with data"} />
        </div>
        <Card className="mb-6">
          <CardHeader title={`${PERIODS.find((p) => p.key === period)?.label} ${isAttendance ? "attendance" : "giving"}`} />
          <CardBody className="px-0 sm:px-0">
            <div className="overflow-x-auto">
              <table className="tabular w-full min-w-[560px] text-sm">
                <thead className="text-left text-[12px] text-navy/55">
                  <tr className="border-y border-navy/10">
                    <th className="py-2 pl-5 pr-2 font-medium sm:pl-6">Period starting</th>
                    <th className="px-2 py-2 text-right font-medium">Services</th>
                    {cats.map((c) => <th key={c.id} className="px-2 py-2 text-right font-medium">{c.name}</th>)}
                    <th className="px-2 py-2 pr-5 text-right font-medium sm:pr-6">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy/[0.07]">
                  {rows.length === 0 ? (
                    <tr><td colSpan={cats.length + 3} className="py-8 text-center text-navy/55">No data in this range.</td></tr>
                  ) : rows.map((r) => (
                    <tr key={r.period}>
                      <td className="py-2.5 pl-5 pr-2 sm:pl-6">{formatDate(r.period)}</td>
                      <td className="px-2 py-2.5 text-right">{r.services}</td>
                      {cats.map((c) => (
                        <td key={c.id} className="px-2 py-2.5 text-right">
                          {isAttendance ? (r.attendance.get(c.id) ?? 0).toLocaleString() : formatCents(r.finance.get(c.id) ?? 0n, currency)}
                        </td>
                      ))}
                      <td className="px-2 py-2.5 pr-5 text-right font-bold sm:pr-6">{isAttendance ? r.attendanceTotal.toLocaleString() : formatCents(r.financeTotal, currency)}</td>
                    </tr>
                  ))}
                </tbody>
                {rows.length ? (
                  <tfoot>
                    <tr className="border-t-2 border-navy/20 font-bold">
                      <td className="py-2.5 pl-5 pr-2 sm:pl-6">Total</td>
                      <td className="px-2 py-2.5 text-right">{grand.services}</td>
                      {categoryTotals.map((c) => (
                        <td key={c.name} className="px-2 py-2.5 text-right">{isAttendance ? c.attendance.toLocaleString() : formatCents(c.finance, currency)}</td>
                      ))}
                      <td className="px-2 py-2.5 pr-5 text-right sm:pr-6">{isAttendance ? grand.attendance.toLocaleString() : formatCents(grand.finance, currency)}</td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          </CardBody>
        </Card>
      </>
    );
  } else if (tab === "requisitions") {
    const [rows, itemRows] = await Promise.all([loadRequisitionRows(from, to), loadRequisitionItemRows(from, to)]);
    const s = summarizeRequisitions(rows);
    const byPriority = summarizeItemPriorities(itemRows);
    body = (
      <>
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Requests" value={String(s.totals.count)} sub={`${s.openCount} open`} />
          <StatTile label="Requested" value={formatCents(s.totals.requested, currency)} sub="Estimated totals" />
          <StatTile label="Approved" value={formatCents(s.totals.approved, currency)} sub={`${s.approvedCount} approved · ${s.rejectedCount} rejected`} />
          <StatTile emphasis label="Actual purchased" value={formatCents(s.totals.actual, currency)} sub="Reconciled receipts" />
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <BucketTable title="Spending by department" buckets={s.byDepartment} currency={currency} />
          <BucketTable title="Requests by request type" buckets={s.byRequestType} currency={currency} />
          <BucketTable title="Spending by subcategory" buckets={s.bySubcategory} currency={currency} />
          <BucketTable title="Spending by expense category" buckets={s.byExpenseCategory} currency={currency} />
          <BucketTable title="By status" buckets={s.byStatus.map((b) => ({ ...b, key: isRequisitionStatus(b.key) ? STATUS_LABELS[b.key] : b.key }))} currency={currency} />
          <Card>
            <CardHeader
              title="Line items by priority"
              description="Counts and spend per line item, by the priority the requester chose. Requisition totals above are unaffected."
              action={<a href={`/reports/export?type=requisition-items&from=${from}&to=${to}`} className="inline-flex items-center gap-1.5 text-sm font-medium underline decoration-gold decoration-2 underline-offset-4"><Download className="size-4" aria-hidden /> Line items CSV</a>}
            />
            <CardBody className="px-0 sm:px-0">
              <div className="overflow-x-auto">
                <table className="tabular w-full min-w-[520px] text-sm">
                  <thead className="text-left text-[12px] text-navy/55">
                    <tr className="border-y border-navy/10">
                      <th className="py-2 pl-5 pr-2 font-medium sm:pl-6">Priority</th>
                      <th className="px-2 py-2 text-right font-medium">Items</th>
                      <th className="px-2 py-2 text-right font-medium">Requisitions</th>
                      <th className="px-2 py-2 text-right font-medium">Requested</th>
                      <th className="px-2 py-2 text-right font-medium">Approved</th>
                      <th className="px-2 py-2 pr-5 text-right font-medium sm:pr-6">Actual</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-navy/[0.07]">
                    {byPriority.map((b) => (
                      <tr key={b.priority}>
                        <td className="py-2.5 pl-5 pr-2 sm:pl-6"><PriorityBadge priority={b.priority} size="sm" /></td>
                        <td className="px-2 py-2.5 text-right">{b.count}</td>
                        <td className="px-2 py-2.5 text-right">{b.requisitions}</td>
                        <td className="px-2 py-2.5 text-right">{formatCents(b.requested, currency)}</td>
                        <td className="px-2 py-2.5 text-right">{formatCents(b.approved, currency)}</td>
                        <td className="px-2 py-2.5 pr-5 text-right font-medium sm:pr-6">{formatCents(b.actual, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Estimated vs actual (completed purchases)" description={`${s.completed.count} purchased or closed with receipts`} />
            <CardBody>
              <dl className="tabular space-y-2 text-[15px]">
                <div className="flex justify-between"><dt className="text-navy/60">Estimated</dt><dd className="font-medium">{formatCents(s.completed.estimated, currency)}</dd></div>
                <div className="flex justify-between"><dt className="text-navy/60">Approved</dt><dd className="font-medium">{formatCents(s.completed.approved, currency)}</dd></div>
                <div className="flex justify-between"><dt className="text-navy/60">Actual</dt><dd className="font-medium">{formatCents(s.completed.actual, currency)}</dd></div>
                <div className="flex justify-between border-t border-navy/10 pt-2"><dt className="font-bold">Purchase variance</dt><dd className="font-bold">{s.completed.variance > 0n ? "+" : ""}{formatCents(s.completed.variance, currency)}</dd></div>
              </dl>
            </CardBody>
          </Card>
          <RequisitionList title="Outstanding receipts" description="Approved and in purchasing — receipts not yet fully reconciled." rows={s.awaitingReceipts} currency={currency} />
          <RequisitionList title="Orders awaiting purchase" description="PO issued or ordered, nothing reconciled yet." rows={s.awaitingPurchase} currency={currency} />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Insights"
        title="Reports"
        actions={tab ? <a href={exportHref} className="inline-flex h-11 items-center gap-2 rounded-xl bg-navy px-4 text-[15px] font-medium text-gold"><Download className="size-4" aria-hidden /> Export CSV</a> : null}
      />
      <nav aria-label="Report" className="mb-4 flex gap-1.5 overflow-x-auto rounded-2xl bg-white p-1 ring-1 ring-navy/10 sm:inline-flex">
        {tabs.map((t) => (
          <Link key={t.key} href={`/reports?tab=${t.key}&from=${from}&to=${to}&period=${period}`} aria-current={t.key === tab ? "page" : undefined}
            className={cn("whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-medium", t.key === tab ? "bg-navy text-gold" : "text-navy/70 hover:bg-navy/5")}>{t.label}</Link>
        ))}
      </nav>
      <form method="get" className="mb-6 flex flex-wrap items-end gap-2">
        <input type="hidden" name="tab" value={tab} />
        <label className="text-sm">From<Input type="date" name="from" defaultValue={from} max={to} className="mt-1 w-44" /></label>
        <label className="text-sm">To<Input type="date" name="to" defaultValue={to} max={today} className="mt-1 w-44" /></label>
        {tab !== "requisitions" ? (
          <label className="text-sm">Group by
            <Select name="period" defaultValue={period} className="mt-1 w-40">
              {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </Select>
          </label>
        ) : null}
        <button type="submit" className="h-12 rounded-xl bg-navy px-5 font-medium text-gold">Apply</button>
        <span className="flex flex-wrap gap-1.5 text-[13px]">
          {[["Last 4 weeks", addDays(today, -27)], ["Year to date", startOfYear(today)], ["Last 12 months", addDays(today, -364)]].map(([label, f]) => (
            <Link key={label} href={`/reports?tab=${tab}&from=${f}&to=${today}&period=${period}`} className="rounded-xl px-3 py-2 ring-1 ring-navy/15 hover:bg-white">{label}</Link>
          ))}
        </span>
      </form>
      {body}
    </>
  );
}

function BucketTable({ title, buckets, currency }: { title: string; buckets: Bucket[]; currency: string }) {
  return (
    <Card>
      <CardHeader title={title} />
      <CardBody className="px-0 sm:px-0">
        {buckets.length === 0 ? <p className="px-5 pb-2 text-sm text-navy/55 sm:px-6">No data in this range.</p> : (
          <div className="overflow-x-auto">
            <table className="tabular w-full min-w-[480px] text-sm">
              <thead className="text-left text-[12px] text-navy/55">
                <tr className="border-y border-navy/10">
                  <th className="py-2 pl-5 pr-2 font-medium sm:pl-6">Name</th>
                  <th className="px-2 py-2 text-right font-medium">Count</th>
                  <th className="px-2 py-2 text-right font-medium">Requested</th>
                  <th className="px-2 py-2 text-right font-medium">Approved</th>
                  <th className="px-2 py-2 pr-5 text-right font-medium sm:pr-6">Actual</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy/[0.07]">
                {buckets.map((b) => (
                  <tr key={b.key}>
                    <td className="py-2.5 pl-5 pr-2 sm:pl-6">{b.key}</td>
                    <td className="px-2 py-2.5 text-right">{b.count}</td>
                    <td className="px-2 py-2.5 text-right">{formatCents(b.requested, currency)}</td>
                    <td className="px-2 py-2.5 text-right">{formatCents(b.approved, currency)}</td>
                    <td className="px-2 py-2.5 pr-5 text-right font-medium sm:pr-6">{formatCents(b.actual, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function RequisitionList({ title, description, rows, currency }: { title: string; description: string; rows: { id: string; requisition_number: string; department: string; status: string; approved_total: string }[]; currency: string }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <CardBody>
        {rows.length === 0 ? <p className="text-sm text-navy/55">None.</p> : (
          <ul className="divide-y divide-navy/10 text-sm">
            {rows.slice(0, 25).map((r) => (
              <li key={r.id} className="flex justify-between gap-3 py-2">
                <Link href={`/requisitions/${r.id}`} className="tabular font-medium underline decoration-gold underline-offset-4">{r.requisition_number}</Link>
                <span className="text-navy/60">{r.department} · {isRequisitionStatus(r.status) ? STATUS_LABELS[r.status] : r.status}</span>
                <span className="tabular">{formatMoney(r.approved_total, currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
