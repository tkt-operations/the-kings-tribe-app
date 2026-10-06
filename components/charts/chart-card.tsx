"use client";

import { useState } from "react";
import { BarChart3, Table2 } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/cn";

export interface LegendItem {
  label: string;
  color: string;
}

export interface TableView {
  columns: string[];
  rows: (string | number)[][];
}

/** Card wrapper giving every chart a title, legend (≥2 series) and a table view. */
export function ChartCard({
  title,
  description,
  legend,
  table,
  children,
  className,
}: {
  title: string;
  description?: string;
  legend?: LegendItem[];
  table: TableView;
  children: React.ReactNode;
  className?: string;
}) {
  const [showTable, setShowTable] = useState(false);
  return (
    <Card className={className}>
      <CardHeader
        title={title}
        description={description}
        action={
          <button
            type="button"
            onClick={() => setShowTable((v) => !v)}
            className="flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-navy/70 hover:bg-navy/5 hover:text-navy"
            aria-pressed={showTable}
          >
            {showTable ? <BarChart3 className="size-4" aria-hidden /> : <Table2 className="size-4" aria-hidden />}
            {showTable ? "Chart" : "Table"}
          </button>
        }
      />
      <CardBody>
        {legend && legend.length > 1 && !showTable ? (
          <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5" aria-label="Legend">
            {legend.map((item) => (
              <li key={item.label} className="flex items-center gap-1.5 text-[13px] text-navy/75">
                <span aria-hidden className="size-2.5 rounded-sm" style={{ background: item.color }} />
                {item.label}
              </li>
            ))}
          </ul>
        ) : null}
        {showTable ? <DataTable table={table} /> : <div className="h-64 w-full">{children}</div>}
      </CardBody>
    </Card>
  );
}

function DataTable({ table }: { table: TableView }) {
  if (table.rows.length === 0) return <p className="py-8 text-center text-sm text-navy/55">No data in this range.</p>;
  return (
    <div className="max-h-64 overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-white">
          <tr>
            {table.columns.map((c, i) => (
              <th key={c} scope="col" className={cn("border-b border-navy/10 py-2 font-medium text-navy/60", i === 0 ? "text-left" : "text-right")}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular">
          {table.rows.map((row, r) => (
            <tr key={r} className="border-b border-navy/5 last:border-0">
              {row.map((cell, i) => (
                <td key={i} className={cn("py-2", i === 0 ? "text-left" : "text-right")}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ChartEmpty() {
  return <div className="flex h-full items-center justify-center text-sm text-navy/50">No data in this range.</div>;
}
