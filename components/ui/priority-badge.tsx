import { AlertTriangle, ArrowDown, ArrowUp, Minus } from "lucide-react";
import { cn } from "@/lib/cn";
import { PRIORITY_LABELS, type Priority } from "@/lib/priority";

/**
 * Priority shown by text + icon + weight, never colour alone.
 * Essential is the loudest (solid orange, uppercase, warning icon); High is a
 * gold outline; Medium and Low recede progressively.
 */
const styles: Record<Priority, string> = {
  // Navy on orange keeps ~5.8:1 contrast (white on this orange would fail AA).
  essential: "bg-energy-orange text-navy uppercase tracking-[0.08em] shadow-sm shadow-energy-orange/30",
  high: "bg-gold/25 text-navy ring-1 ring-inset ring-gold uppercase tracking-[0.06em]",
  medium: "bg-navy/[0.06] text-navy/80",
  low: "bg-transparent text-navy/55 ring-1 ring-inset ring-navy/15 font-medium",
};

const icons: Record<Priority, typeof AlertTriangle> = {
  essential: AlertTriangle,
  high: ArrowUp,
  medium: Minus,
  low: ArrowDown,
};

export function PriorityBadge({ priority, className, size = "md" }: { priority: Priority; className?: string; size?: "sm" | "md" }) {
  const Icon = icons[priority];
  return (
    <span
      data-priority={priority}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full font-bold",
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
        styles[priority],
        className,
      )}
    >
      <Icon className={size === "sm" ? "size-3" : "size-3.5"} aria-hidden strokeWidth={2.5} />
      <span>
        <span className="sr-only">Priority: </span>
        {PRIORITY_LABELS[priority]}
      </span>
    </span>
  );
}

/** Requisition-level summary computed from its items, e.g. on list rows. */
export function PriorityIndicator({ highest, essentialCount, className }: { highest: Priority | null; essentialCount: number; className?: string }) {
  if (!highest) return null;
  if (highest === "essential") {
    return (
      <span className={cn("inline-flex items-center gap-1.5", className)}>
        <PriorityBadge priority="essential" size="sm" />
        <span className="text-[12px] font-bold text-navy">
          {essentialCount > 1 ? `${essentialCount} Essential items` : "Contains Essential item"}
        </span>
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className="text-[12px] text-navy/60">Highest priority</span>
      <PriorityBadge priority={highest} size="sm" />
    </span>
  );
}
