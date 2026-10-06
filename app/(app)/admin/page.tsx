import Link from "next/link";
import { ClipboardList, KeyRound, Link2, ScrollText, Settings2, ShieldCheck, Sparkles, Users } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { requirePagePermission } from "@/lib/auth";
import type { Permission } from "@/lib/permissions";

export const metadata = { title: "Administration" };

const SECTIONS: { href: string; title: string; description: string; icon: typeof Users; permission: Permission }[] = [
  { href: "/admin/setup", title: "Setup wizard", description: "Step-by-step first-time configuration.", icon: Sparkles, permission: "settings.manage" },
  { href: "/admin/settings", title: "Church settings", description: "Church information, currency, timezone, notification email and policies.", icon: Settings2, permission: "settings.manage" },
  { href: "/admin/users", title: "Users", description: "Invite the team, activate or deactivate accounts and assign roles.", icon: Users, permission: "users.manage" },
  { href: "/admin/roles", title: "Roles & permissions", description: "Choose exactly what each role can see and do.", icon: ShieldCheck, permission: "users.manage" },
  { href: "/admin/form-links", title: "Requisition links", description: "Secure links for department leads to submit requests.", icon: Link2, permission: "form_links.manage" },
  { href: "/admin/request-types", title: "Request types", description: "Order, Direct Purchase, Reimbursement, Petty Cash, Advance Check — and new ones.", icon: ClipboardList, permission: "request_types.manage" },
  { href: "/admin/audit", title: "Audit log", description: "Every sensitive change, who made it and when.", icon: ScrollText, permission: "audit.view" },
  { href: "/categories", title: "Categories & budget lines", description: "Attendance, finance and expense categories; cost centers.", icon: KeyRound, permission: "categories.manage" },
];

export default async function AdminPage() {
  const user = await requirePagePermission(["settings.manage", "users.manage", "form_links.manage", "request_types.manage", "audit.view"]);
  const visible = SECTIONS.filter((s) => user.permissions.has(s.permission));
  return (
    <>
      <PageHeader eyebrow="Configuration" title="Administration" />
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map(({ href, title, description, icon: Icon }) => (
          <li key={href}>
            <Link href={href} className="flex h-full gap-4 rounded-[var(--radius-card)] bg-white p-5 ring-1 ring-navy/10 transition-shadow hover:shadow-lg hover:shadow-navy/5">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-navy text-gold"><Icon className="size-5" aria-hidden /></span>
              <span>
                <span className="block font-bold">{title}</span>
                <span className="mt-1 block text-sm text-navy/65">{description}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
