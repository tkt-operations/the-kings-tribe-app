import {
  BarChart3, Building2, CalendarCheck2, FileText, LayoutDashboard, ReceiptText, Settings2, ShoppingCart, Tags,
} from "lucide-react";
import type { NavIcon as NavIconName } from "./nav-config";

const ICONS = {
  dashboard: LayoutDashboard,
  sunday: CalendarCheck2,
  requisitions: ShoppingCart,
  "purchase-orders": FileText,
  receipts: ReceiptText,
  reports: BarChart3,
  categories: Tags,
  departments: Building2,
  admin: Settings2,
} as const;

export function NavIcon({ name, className }: { name: NavIconName; className?: string }) {
  const Icon = ICONS[name];
  return <Icon className={className} aria-hidden strokeWidth={1.8} />;
}
