import { DashboardCharts } from "@/app/(app)/dashboard/dashboard-charts";
import { DateRangeFilter } from "@/app/(app)/dashboard/date-range-filter";
import { AppShell } from "@/components/shell/app-shell";
import { NAV_ITEMS } from "@/components/shell/nav-config";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { devOnly } from "../guard";

const weeks = ["Jul 19", "Jul 26", "Aug 2", "Aug 9", "Aug 16", "Aug 23", "Aug 30", "Sep 6", "Sep 13", "Sep 20", "Sep 27", "Oct 4"];

export default function PreviewDashboard() {
  devOnly();
  const att = weeks.map((date, i) => ({ date, a1: 120 + ((i * 37) % 29) + i * 2, a2: 31 + ((i * 13) % 11) }));
  return (
    <AppShell nav={NAV_ITEMS} user={{ fullName: "Avery Finance", email: "avery@example.org", roleNames: ["Head of Finance"] }} notifications={{ userId: "00000000-0000-4000-8000-000000000000", unread: 3 }}>
      <PageHeader eyebrow="Latest service · Sunday, October 4, 2026" title="Good morning, Avery" actions={<ButtonLink href="#" variant="gold">Enter this Sunday</ButtonLink>} />
      <DateRangeFilter from="2026-07-14" to="2026-10-05" today="2026-10-05" />
      <section className="mb-8 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatTile emphasis label="Total finance received" value="$4,102.65" delta={6.2} deltaLabel="vs Sep 27" className="col-span-2" sub={<span className="tabular">4-wk avg $3,880.10 · MTD $4,102.65 · YTD $151,920.33</span>} />
        <StatTile label="Total attendance" value="180" delta={7.1} deltaLabel="vs Sep 27" className="col-span-2" sub={<span className="tabular">4-wk avg 166 · 40 services this year</span>} />
        <StatTile label="Adult Church" value="142" delta={5.2} deltaLabel="vs Sep 27" />
        <StatTile label="Children's Church" value="38" delta={-2.6} deltaLabel="vs Sep 27" />
        <StatTile label="Offering" value="$812.40" delta={3.4} deltaLabel="vs Sep 27" />
        <StatTile label="Tithe" value="$3,105.00" delta={8.9} deltaLabel="vs Sep 27" />
      </section>
      <DashboardCharts
        currency="USD" canAttendance canFinance canRequisitions
        attendanceTrend={att.map((d) => ({ date: d.date, total: d.a1 + d.a2 }))}
        attendanceByCategory={att}
        attendanceSeries={[{ key: "a1", label: "Adult Church" }, { key: "a2", label: "Children's Church" }]}
        givingTrend={weeks.map((date, i) => ({ date, total: 3500 + ((i * 173) % 640) }))}
        givingByCategory={[{ name: "Tithe", value: 36120, formatted: "$36,120.00" }, { name: "Offering", value: 9480, formatted: "$9,480.00" }, { name: "Church Outreach", value: 2010, formatted: "$2,010.00" }]}
        mtdCumulative={[{ date: "Oct 4", total: 4102.65 }]}
        monthLabel="October 2026"
        statusCounts={[{ name: "Submitted", value: 3 }, { name: "Under Review", value: 2 }, { name: "Approved", value: 4 }, { name: "Ordered", value: 2 }, { name: "Purchased", value: 5 }, { name: "Rejected", value: 1 }]}
        deptSpend={[{ name: "Production", approved: 1240, actual: 1180.5, approvedText: "$1,240.00", actualText: "$1,180.50" }, { name: "Hospitality", approved: 860, actual: 712.3, approvedText: "$860.00", actualText: "$712.30" }, { name: "Children's", approved: 540, actual: 498.1, approvedText: "$540.00", actualText: "$498.10" }]}
      />
    </AppShell>
  );
}
