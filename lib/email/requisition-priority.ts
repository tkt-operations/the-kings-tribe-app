/**
 * Priority content for requisition emails (pure, so it can be unit-tested).
 * A requisition is never "Essential" itself — it CONTAINS Essential items.
 */
import type { EmailContent } from "@/lib/email/layout";
import { countByPriority, isPriority, PRIORITY_LABELS, type Priority } from "@/lib/priority";

export interface PriorityLine {
  priority?: string | null;
  essential_justification?: string | null;
}

/** "[ESSENTIAL] New requisition …" when at least one line is Essential. */
export function financeSubmissionSubject(base: string, items: PriorityLine[]): string {
  return countByPriority(items).essential > 0 ? `[ESSENTIAL] ${base}` : base;
}

/** Top-of-email callout: Essential beats High; nothing for Medium/Low-only. */
export function priorityAlert(items: PriorityLine[]): EmailContent["alert"] {
  const counts = countByPriority(items);
  if (counts.essential > 0) {
    const n = counts.essential;
    return {
      tone: "essential",
      title: "Essential item included",
      body: `This requisition contains ${n} Essential item${n === 1 ? "" : "s"}. ${n === 1 ? "Its reason is" : "Their reasons are"} listed with the item${n === 1 ? "" : "s"} below. Priority is the requester's statement of need, not an approval.`,
    };
  }
  if (counts.high > 0) {
    const n = counts.high;
    return {
      tone: "high",
      title: "High-priority item included",
      body: `This requisition contains ${n} High-priority item${n === 1 ? "" : "s"}: important and time-sensitive.`,
    };
  }
  return undefined;
}

/** Priority fields for one email item row. */
export function priorityRowFields(line: PriorityLine): Pick<NonNullable<EmailContent["items"]>[number], "priority" | "priorityNote"> {
  if (!isPriority(line.priority)) return {};
  const p: Priority = line.priority;
  return {
    priority: { label: PRIORITY_LABELS[p].toUpperCase(), tone: p },
    priorityNote: p === "essential" && line.essential_justification ? `Essential justification: ${line.essential_justification}` : undefined,
  };
}
