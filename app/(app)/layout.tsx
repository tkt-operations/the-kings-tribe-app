import Link from "next/link";
import { AppShell } from "@/components/shell/app-shell";
import { visibleNav } from "@/components/shell/nav-config";
import { Alert } from "@/components/ui/alert";
import { requireUser } from "@/lib/auth";
import { getChurchSettings } from "@/lib/data/settings";

const ROLE_NAMES: Record<string, string> = {
  administrator: "Administrator",
  head_of_finance: "Head of Finance",
  finance_user: "Finance User",
  reporting_user: "Reporting User",
  viewer: "Viewer",
};

export default async function InternalLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const settings = await getChurchSettings();
  const nav = visibleNav(user.permissions);
  const needsSetup = !settings?.setup_completed_at && user.permissions.has("settings.manage");

  return (
    <AppShell
      nav={nav}
      user={{ fullName: user.fullName, email: user.email, roleNames: user.roles.map((r) => ROLE_NAMES[r] ?? r) }}
    >
      {needsSetup ? (
        <Alert tone="warning" title="Finish setting up the church" className="mb-6">
          Add church information, notification email and policies before sharing requisition links.{" "}
          <Link href="/admin/setup" className="font-bold underline decoration-gold decoration-2 underline-offset-4">Open the setup wizard</Link>
        </Alert>
      ) : null}
      {nav.length === 0 ? (
        <Alert tone="info" title="No access has been assigned yet">
          Your account is active but has no role. Ask an administrator to assign you a role.
        </Alert>
      ) : (
        children
      )}
    </AppShell>
  );
}
