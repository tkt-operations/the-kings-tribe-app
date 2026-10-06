/**
 * Line-item priority: the requester's statement of operational need.
 * Information for Finance — it never approves, rejects or changes money.
 * Order matters everywhere: essential > high > medium > low.
 */
export const PRIORITIES = ["essential", "high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const DEFAULT_PRIORITY: Priority = "medium";

export const PRIORITY_LABELS: Record<Priority, string> = {
  essential: "Essential",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const PRIORITY_DESCRIPTIONS: Record<Priority, string> = {
  essential: "Required for the ministry/department to perform a necessary function or avoid a significant operational disruption.",
  high: "Important and time-sensitive, but operations can temporarily continue without it.",
  medium: "Needed, but can follow the normal purchasing timeline.",
  low: "Nice to have, replacement, improvement, or otherwise not time-sensitive.",
};

export const ESSENTIAL_JUSTIFICATION_MIN = 10;
export const ESSENTIAL_JUSTIFICATION_MAX = 500;

export function isPriority(value: unknown): value is Priority {
  return typeof value === "string" && (PRIORITIES as readonly string[]).includes(value);
}

/** 0 = most important. Unknown values sort last. */
export function priorityRank(p: string | null | undefined): number {
  const i = PRIORITIES.indexOf(p as Priority);
  return i === -1 ? PRIORITIES.length : i;
}

export function comparePriority(a: string | null | undefined, b: string | null | undefined): number {
  return priorityRank(a) - priorityRank(b);
}

/** Most important priority among the items (calculated, never stored). */
export function highestPriority(items: { priority?: string | null }[]): Priority | null {
  let best: Priority | null = null;
  for (const item of items) {
    if (isPriority(item.priority) && (best === null || priorityRank(item.priority) < priorityRank(best))) best = item.priority;
  }
  return best;
}

export function countByPriority(items: { priority?: string | null }[]): Record<Priority, number> {
  const counts: Record<Priority, number> = { essential: 0, high: 0, medium: 0, low: 0 };
  for (const item of items) if (isPriority(item.priority)) counts[item.priority] += 1;
  return counts;
}
