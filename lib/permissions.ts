export const PERMISSIONS = [
  "dashboard.view",
  "attendance.view",
  "attendance.enter",
  "finance.view",
  "finance.enter",
  "finance.void",
  "requisitions.view",
  "requisitions.review",
  "purchase_orders.issue",
  "orders.record",
  "receipts.upload",
  "receipts.reconcile",
  "disbursements.record",
  "reports.view",
  "categories.manage",
  "departments.manage",
  "request_types.manage",
  "form_links.manage",
  "settings.manage",
  "users.manage",
  "audit.view",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

/** True if the user holds at least one of the given permissions. */
export function hasAny(granted: ReadonlySet<string>, required: Permission | readonly Permission[]): boolean {
  const list = Array.isArray(required) ? required : [required];
  return list.some((p) => granted.has(p));
}
