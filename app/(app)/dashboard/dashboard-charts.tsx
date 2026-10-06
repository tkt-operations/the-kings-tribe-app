"use client";

import { ChartCard } from "@/components/charts/chart-card";
import { ColumnChart, HorizontalBarChart, TrendLineChart } from "@/components/charts/charts";
import { formatValue, seriesColor } from "@/components/charts/theme";

type Datum = Record<string, string | number>;

export function DashboardCharts(props: {
  currency: string;
  canAttendance: boolean;
  canFinance: boolean;
  canRequisitions: boolean;
  attendanceTrend: Datum[];
  attendanceByCategory: Datum[];
  attendanceSeries: { key: string; label: string }[];
  givingTrend: Datum[];
  givingByCategory: { name: string; value: number; formatted: string }[];
  mtdCumulative: Datum[];
  monthLabel: string;
  statusCounts: { name: string; value: number }[];
  deptSpend: { name: string; approved: number; actual: number; approvedText: string; actualText: string }[];
}) {
  const money = (v: number) => formatValue(v, "currency", props.currency);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {props.canAttendance ? (
        <>
          <ChartCard
            title="Attendance trend"
            description="Total attendance per Sunday"
            table={{ columns: ["Date", "Total"], rows: props.attendanceTrend.map((d) => [d.date, Number(d.total).toLocaleString()]) }}
          >
            <TrendLineChart data={props.attendanceTrend} xKey="date" series={[{ key: "total", label: "Total attendance", color: seriesColor(0) }]} />
          </ChartCard>
          <ChartCard
            title="Attendance by category"
            description="Adult, children's and any added categories"
            legend={props.attendanceSeries.map((s, i) => ({ label: s.label, color: seriesColor(i) }))}
            table={{
              columns: ["Date", ...props.attendanceSeries.map((s) => s.label)],
              rows: props.attendanceByCategory.map((d) => [d.date, ...props.attendanceSeries.map((s) => Number(d[s.key] ?? 0).toLocaleString())]),
            }}
          >
            <ColumnChart data={props.attendanceByCategory} xKey="date" series={props.attendanceSeries} stacked />
          </ChartCard>
        </>
      ) : null}

      {props.canFinance ? (
        <>
          <ChartCard
            title="Weekly giving"
            description="Total finance received per Sunday"
            table={{ columns: ["Date", "Total"], rows: props.givingTrend.map((d) => [d.date, money(Number(d.total))]) }}
          >
            <ColumnChart data={props.givingTrend} xKey="date" series={[{ key: "total", label: "Total giving", color: seriesColor(2) }]} format="currency" currency={props.currency} />
          </ChartCard>
          <ChartCard
            title="Giving by category"
            description="Selected period"
            table={{ columns: ["Category", "Amount"], rows: props.givingByCategory.map((g) => [g.name, g.formatted]) }}
          >
            <HorizontalBarChart data={props.givingByCategory} labelKey="name" valueKey="value" format="currency" currency={props.currency} color={seriesColor(2)} />
          </ChartCard>
          <ChartCard
            title="Month-to-date giving"
            description={`Running total · ${props.monthLabel}`}
            table={{ columns: ["Date", "Running total"], rows: props.mtdCumulative.map((d) => [d.date, money(Number(d.total))]) }}
          >
            <ColumnChart data={props.mtdCumulative} xKey="date" series={[{ key: "total", label: "Month to date", color: seriesColor(3) }]} format="currency" currency={props.currency} showLabels />
          </ChartCard>
        </>
      ) : null}

      {props.canRequisitions ? (
        <>
          <ChartCard
            title="Requisition spending"
            description="Approved vs actual by department (requisitions submitted in this period)"
            legend={[{ label: "Approved", color: seriesColor(0) }, { label: "Actual", color: seriesColor(1) }]}
            table={{ columns: ["Department", "Approved", "Actual"], rows: props.deptSpend.map((d) => [d.name, d.approvedText, d.actualText]) }}
          >
            <ColumnChart
              data={props.deptSpend}
              xKey="name"
              series={[{ key: "approved", label: "Approved" }, { key: "actual", label: "Actual" }]}
              format="currency"
              currency={props.currency}
            />
          </ChartCard>
          <ChartCard
            title="Requisition status"
            description="Requisitions submitted in this period"
            table={{ columns: ["Status", "Count"], rows: props.statusCounts.map((s) => [s.name, s.value]) }}
          >
            <HorizontalBarChart data={props.statusCounts} labelKey="name" valueKey="value" color={seriesColor(3)} />
          </ChartCard>
        </>
      ) : null}
    </div>
  );
}
