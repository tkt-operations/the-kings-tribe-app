import type { Permission } from "@/lib/permissions";

export type NavIcon =
  | "dashboard" | "sunday" | "requisitions" | "purchase-orders" | "receipts" | "reports"
  | "categories" | "departments" | "admin";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  /** Shown if the user holds ANY of these permissions. */
  anyOf: Permission[];
  mobilePrimary?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard", anyOf: ["dashboard.view"], mobilePrimary: true },
  { href: "/sunday", label: "Sunday Entry", icon: "sunday", anyOf: ["attendance.enter", "finance.enter"], mobilePrimary: true },
  { href: "/requisitions", label: "Requisitions", icon: "requisitions", anyOf: ["requisitions.view"], mobilePrimary: true },
  { href: "/purchase-orders", label: "Purchase Orders", icon: "purchase-orders", anyOf: ["requisitions.view"] },
  { href: "/receipts", label: "Receipts", icon: "receipts", anyOf: ["receipts.reconcile", "receipts.upload"] },
  { href: "/reports", label: "Reports", icon: "reports", anyOf: ["reports.view"] },
  { href: "/categories", label: "Categories", icon: "categories", anyOf: ["categories.manage"] },
  { href: "/departments", label: "Departments", icon: "departments", anyOf: ["departments.manage"] },
  {
    href: "/admin",
    label: "Administration",
    icon: "admin",
    anyOf: ["settings.manage", "users.manage", "form_links.manage", "request_types.manage", "audit.view"],
  },
];

export function visibleNav(permissions: ReadonlySet<string>): NavItem[] {
  return NAV_ITEMS.filter((item) => item.anyOf.some((p) => permissions.has(p)));
}
