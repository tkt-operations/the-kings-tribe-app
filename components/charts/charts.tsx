"use client";

import {
  Bar, BarChart, CartesianGrid, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { AXIS, formatValue, seriesColor, type ValueFormat } from "./theme";
import { ChartEmpty } from "./chart-card";

export interface SeriesDef {
  key: string;
  label: string;
  color?: string;
}

type Datum = Record<string, string | number>;

interface TooltipEntry {
  dataKey?: string | number;
  name?: string | number;
  value?: number | string;
  color?: string;
}

function ChartTooltip({
  active,
  payload,
  label,
  format,
  currency,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  format: ValueFormat;
  currency: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-navy/10 bg-white px-3 py-2 text-[13px] shadow-lg shadow-navy/10">
      <p className="mb-1 font-medium text-navy">{label}</p>
      <ul className="space-y-0.5">
        {payload.map((p) => (
          <li key={String(p.dataKey)} className="flex items-center justify-between gap-6">
            <span className="flex items-center gap-1.5 text-navy/70">
              <span aria-hidden className="size-2 rounded-full" style={{ background: p.color }} />
              {p.name}
            </span>
            <span className="tabular font-medium text-navy">{formatValue(Number(p.value ?? 0), format, currency)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const axisProps = {
  stroke: AXIS.stroke,
  tick: AXIS.tick,
  tickLine: false,
  axisLine: false,
} as const;

export function TrendLineChart({
  data,
  xKey,
  series,
  format = "number",
  currency = "USD",
}: {
  data: Datum[];
  xKey: string;
  series: SeriesDef[];
  format?: ValueFormat;
  currency?: string;
}) {
  if (data.length === 0) return <ChartEmpty />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke={AXIS.grid} />
        <XAxis dataKey={xKey} {...axisProps} minTickGap={16} />
        <YAxis {...axisProps} width={56} tickFormatter={(v: number) => formatValue(v, format, currency, true)} />
        <Tooltip
          cursor={{ stroke: "rgba(18,23,45,0.25)", strokeWidth: 1 }}
          content={(p) => <ChartTooltip {...(p as object)} format={format} currency={currency} />}
        />
        {series.map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color ?? seriesColor(i)}
            strokeWidth={2}
            dot={data.length <= 16 ? { r: 3, strokeWidth: 2, fill: "#fff" } : false}
            activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff" }}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function ColumnChart({
  data,
  xKey,
  series,
  stacked = false,
  format = "number",
  currency = "USD",
  showLabels = false,
}: {
  data: Datum[];
  xKey: string;
  series: SeriesDef[];
  stacked?: boolean;
  format?: ValueFormat;
  currency?: string;
  showLabels?: boolean;
}) {
  if (data.length === 0) return <ChartEmpty />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 18, right: 12, bottom: 0, left: 0 }} barGap={2} barCategoryGap="22%">
        <CartesianGrid vertical={false} stroke={AXIS.grid} />
        <XAxis dataKey={xKey} {...axisProps} minTickGap={8} />
        <YAxis {...axisProps} width={56} tickFormatter={(v: number) => formatValue(v, format, currency, true)} />
        <Tooltip cursor={{ fill: "rgba(18,23,45,0.04)" }} content={(p) => <ChartTooltip {...(p as object)} format={format} currency={currency} />} />
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            fill={s.color ?? seriesColor(i)}
            stackId={stacked ? "stack" : undefined}
            radius={stacked ? (i === series.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]) : [4, 4, 0, 0]}
            stroke="#fff"
            strokeWidth={stacked ? 1 : 0}
            maxBarSize={40}
            isAnimationActive={false}
          >
            {showLabels && !stacked ? (
              <LabelList dataKey={s.key} position="top" className="tabular" fill="rgba(18,23,45,0.7)" fontSize={11}
                formatter={(v: unknown) => formatValue(Number(v ?? 0), format, currency, true)} />
            ) : null}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function HorizontalBarChart({
  data,
  labelKey,
  valueKey,
  format = "number",
  currency = "USD",
  color,
}: {
  data: Datum[];
  labelKey: string;
  valueKey: string;
  format?: ValueFormat;
  currency?: string;
  color?: string;
}) {
  if (data.length === 0) return <ChartEmpty />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 56, bottom: 0, left: 0 }} barCategoryGap="28%">
        <CartesianGrid horizontal={false} stroke={AXIS.grid} />
        <XAxis type="number" {...axisProps} tickFormatter={(v: number) => formatValue(v, format, currency, true)} />
        <YAxis type="category" dataKey={labelKey} {...axisProps} width={128} interval={0} />
        <Tooltip cursor={{ fill: "rgba(18,23,45,0.04)" }} content={(p) => <ChartTooltip {...(p as object)} format={format} currency={currency} />} />
        <Bar dataKey={valueKey} name="Value" radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false}
          fill={color ?? seriesColor(0)}
        >
          <LabelList dataKey={valueKey} position="right" fill="rgba(18,23,45,0.75)" fontSize={12}
            formatter={(v: unknown) => formatValue(Number(v ?? 0), format, currency, true)} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
