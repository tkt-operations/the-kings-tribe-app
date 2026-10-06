/**
 * Setup wizard completion, derived ONLY from persisted database state.
 * Pure: the loader (lib/setup/load.ts) gathers a snapshot; this decides.
 */
import { sectionSchema } from "@/lib/validation/settings";

export interface SetupSnapshot {
  /** The saved church_settings row (null if it could not be read). */
  settings: Record<string, unknown> | null;
  activeCategories: { attendance: number; finance: number; requisition: number };
  /** Active departments that have at least one active subcategory. */
  departmentsReady: number;
  /** Active user accounts (including the administrator). */
  activeUsers: number;
  /** Requisition links that can currently accept submissions. */
  usableLinks: number;
}

export type SetupStepKey = "church" | "notifications" | "categories" | "departments" | "team" | "links";

export interface SetupStepStatus {
  n: number;
  key: SetupStepKey;
  title: string;
  done: boolean;
  /** Required before setup can be marked complete. */
  required: boolean;
  /** What is still missing (empty when done). */
  missing: string[];
}

function schemaProblems(row: Record<string, unknown> | null, ...args: Parameters<typeof sectionSchema>): string[] {
  if (!row) return ["Settings could not be loaded."];
  const parsed = sectionSchema(...args).safeParse(row);
  return parsed.success ? [] : [...new Set(parsed.error.issues.map((i) => i.message))];
}

export function computeSetupProgress(s: SetupSnapshot) {
  const steps: SetupStepStatus[] = [];
  const add = (n: number, key: SetupStepKey, title: string, required: boolean, missing: string[]) =>
    steps.push({ n, key, title, required, missing, done: missing.length === 0 });

  // 1: the saved row passes the same rules the Church information form enforces.
  add(1, "church", "Church information", true, schemaProblems(s.settings, ["church", "money"]));
  // 2: a Finance notification address is saved and the policy texts are valid.
  add(2, "notifications", "Notification email & policies", true, schemaProblems(s.settings, ["notifications", "policy"], { requireNotificationEmail: true }));
  // 3: Sunday entry needs attendance + finance categories; review needs expense categories.
  const cats = s.activeCategories;
  add(3, "categories", "Categories", true, [
    ...(cats.attendance > 0 ? [] : ["Add at least one active attendance category."]),
    ...(cats.finance > 0 ? [] : ["Add at least one active finance category."]),
    ...(cats.requisition > 0 ? [] : ["Add at least one active expense category."]),
  ]);
  // 4: the requisition form needs a department AND one of its subcategories.
  add(4, "departments", "Departments", true, s.departmentsReady > 0 ? [] : ["Add an active department with at least one active subcategory."]);
  // 5: existing rule — someone other than the first administrator has an account.
  //    Recommended, not required: invitations depend on email being configured.
  add(5, "team", "Invite your team", false, s.activeUsers > 1 ? [] : ["Invite at least one other team member."]);
  // 6: at least one link that can accept submissions right now.
  add(6, "links", "Create a requisition link", true, s.usableLinks > 0 ? [] : ["Create an active requisition link."]);

  const completed = steps.filter((x) => x.done).length;
  const incompleteRequired = steps.filter((x) => x.required && !x.done);
  return { steps, completed, total: steps.length, incompleteRequired, readyToComplete: incompleteRequired.length === 0 };
}

export type SetupProgress = ReturnType<typeof computeSetupProgress>;

/** "Step 1 — Church information (Address line 1 is required.)" … */
export function describeIncomplete(steps: SetupStepStatus[]): string {
  return steps.map((x) => `Step ${x.n} — ${x.title}${x.missing.length ? ` (${x.missing.join(" ")})` : ""}`).join("; ");
}

/** A link can accept submissions: active, not revoked, not expired, under its limit. */
export function isUsableLink(l: { is_active: boolean; revoked_at: string | null; expires_at: string | null; max_submissions: number | null; submission_count: number }, now = new Date()): boolean {
  if (!l.is_active || l.revoked_at) return false;
  if (l.expires_at && new Date(l.expires_at) <= now) return false;
  if (l.max_submissions && l.submission_count >= l.max_submissions) return false;
  return true;
}
