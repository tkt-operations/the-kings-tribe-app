"use client";

import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { addDays, startOfMonth, startOfQuarter, startOfYear } from "@/lib/dates";

/** One row of filters above the charts: presets + custom range. */
export function DateRangeFilter({ from, to, today }: { from: string; to: string; today: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const presets = [
    { label: "4 weeks", from: addDays(today, -27), to: today },
    { label: "12 weeks", from: addDays(today, -83), to: today },
    { label: "This month", from: startOfMonth(today), to: today },
    { label: "Quarter", from: startOfQuarter(today), to: today },
    { label: "Year to date", from: startOfYear(today), to: today },
  ];
  const go = (f: string, t: string) => router.push(`${pathname}?from=${f}&to=${t}`);

  return (
    <div className="mb-6 flex flex-wrap items-end gap-2" role="group" aria-label="Date range">
      <div className="flex flex-wrap gap-1.5 rounded-2xl bg-white p-1 ring-1 ring-navy/10">
        {presets.map((p) => {
          const active = p.from === from && p.to === to;
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => go(p.from, p.to)}
              aria-pressed={active}
              className={cn(
                "h-9 rounded-xl px-3 text-[13px] font-medium transition-colors",
                active ? "bg-navy text-gold" : "text-navy/70 hover:bg-navy/5 hover:text-navy",
              )}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2 text-[13px]">
        <label className="sr-only" htmlFor="range-from">From</label>
        <input id="range-from" type="date" value={from} max={to} onChange={(e) => e.target.value && go(e.target.value, to)}
          className="h-11 rounded-xl border border-navy/15 bg-white px-3 text-navy" />
        <span className="text-navy/50">to</span>
        <label className="sr-only" htmlFor="range-to">To</label>
        <input id="range-to" type="date" value={to} min={from} max={today} onChange={(e) => e.target.value && go(from, e.target.value)}
          className="h-11 rounded-xl border border-navy/15 bg-white px-3 text-navy" />
      </div>
    </div>
  );
}
