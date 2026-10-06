import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/cn";

export function StatTile({
  label,
  value,
  delta,
  deltaLabel,
  sub,
  emphasis = false,
  className,
}: {
  label: string;
  value: string;
  delta?: number | null;
  deltaLabel?: string;
  sub?: React.ReactNode;
  emphasis?: boolean;
  className?: string;
}) {
  const direction = delta === null || delta === undefined ? null : delta > 0.05 ? "up" : delta < -0.05 ? "down" : "flat";
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col justify-between rounded-[var(--radius-card)] border p-4 sm:p-5",
        emphasis ? "brand-pattern border-navy bg-navy text-white" : "border-navy/10 bg-white",
        className,
      )}
    >
      <p className={cn("text-[13px] font-medium", emphasis ? "text-white/70" : "text-navy/60")}>{label}</p>
      <p className={cn("tabular mt-2 truncate font-serif text-[2rem] leading-none sm:text-[2.35rem]", emphasis ? "text-gold" : "text-navy")}>{value}</p>
      {direction ? (
        <p className={cn("mt-3 flex items-center gap-1 text-[13px]", emphasis ? "text-white/80" : "text-navy/70")}>
          {direction === "up" ? <ArrowUpRight className="size-4 text-kingdom-green" aria-hidden /> : null}
          {direction === "down" ? <ArrowDownRight className="size-4 text-energy-orange" aria-hidden /> : null}
          {direction === "flat" ? <Minus className="size-4" aria-hidden /> : null}
          <span className="tabular font-medium">
            {delta! > 0 ? "+" : ""}
            {delta!.toFixed(1)}%
          </span>
          <span className={emphasis ? "text-white/55" : "text-navy/50"}>{deltaLabel}</span>
        </p>
      ) : sub ? null : (
        <p className={cn("mt-3 text-[13px]", emphasis ? "text-white/50" : "text-navy/45")}>No comparison yet</p>
      )}
      {sub ? <div className={cn("mt-2 text-[13px]", emphasis ? "text-white/60" : "text-navy/55")}>{sub}</div> : null}
    </div>
  );
}
