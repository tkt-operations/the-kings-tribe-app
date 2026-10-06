import { cn } from "@/lib/cn";
import { STATUS_LABELS, STATUS_TONES, type RequisitionStatus, type StatusTone } from "@/lib/workflow/status";

const tones: Record<StatusTone, { pill: string; dot: string }> = {
  neutral: { pill: "bg-navy/[0.06] text-navy", dot: "bg-navy/40" },
  info: { pill: "bg-ministry-blue/10 text-ministry-blue", dot: "bg-ministry-blue" },
  attention: { pill: "bg-gold/25 text-navy", dot: "bg-gold" },
  positive: { pill: "bg-kingdom-green/10 text-kingdom-green", dot: "bg-kingdom-green" },
  negative: { pill: "bg-energy-orange/10 text-navy", dot: "bg-energy-orange" },
  done: { pill: "bg-navy text-white", dot: "bg-gold" },
};

export function Badge({ tone = "neutral", children, className }: { tone?: StatusTone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold", tones[tone].pill, className)}>
      <span aria-hidden className={cn("size-1.5 rounded-full", tones[tone].dot)} />
      {children}
    </span>
  );
}

export function StatusBadge({ status, className }: { status: RequisitionStatus; className?: string }) {
  return (
    <Badge tone={STATUS_TONES[status]} className={className}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}
