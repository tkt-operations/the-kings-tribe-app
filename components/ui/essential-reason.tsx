import { cn } from "@/lib/cn";

/** Reasons longer than this collapse behind a native disclosure. */
export const ESSENTIAL_REASON_INLINE_MAX = 180;

/**
 * The requester's "Why essential" explanation, shown as compact supporting
 * metadata under the item (the ESSENTIAL badge already carries the urgency).
 * Short reasons show inline; long ones use a native <details> disclosure that
 * works with keyboard, touch and screen readers and reveals the full text with
 * one action. Never truncated, never hover-only.
 */
export function EssentialReason({ reason, className }: { reason: string | null | undefined; className?: string }) {
  const text = (reason ?? "").trim();
  if (!text) return null;
  const base = "mt-1 border-l-2 border-energy-orange/40 pl-2 text-[13px] leading-snug text-navy/80 [overflow-wrap:anywhere]";
  if (text.length <= ESSENTIAL_REASON_INLINE_MAX) {
    return (
      <p className={cn(base, className)} data-testid="essential-reason">
        <span className="font-semibold text-navy">Why essential:</span> {text}
      </p>
    );
  }
  return (
    <details className={cn(base, "group", className)} data-testid="essential-reason">
      <summary className="cursor-pointer list-none rounded font-semibold text-navy [&::-webkit-details-marker]:hidden">
        Why essential<span className="font-normal text-navy/65"> · <span className="underline decoration-gold decoration-2 underline-offset-2 group-open:hidden">View reason</span><span className="hidden underline decoration-gold decoration-2 underline-offset-2 group-open:inline">Hide reason</span></span>
      </summary>
      <p className="mt-1 whitespace-pre-line">{text}</p>
    </details>
  );
}
