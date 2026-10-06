import { SundayEntryForm } from "@/app/(app)/sunday/sunday-entry-form";
import { AppShell } from "@/components/shell/app-shell";
import { NAV_ITEMS } from "@/components/shell/nav-config";
import { PageHeader } from "@/components/ui/page-header";
import { devOnly } from "../guard";

export default function PreviewSunday() {
  devOnly();
  return (
    <AppShell nav={NAV_ITEMS} user={{ fullName: "Avery Finance", email: "avery@example.org", roleNames: ["Head of Finance"] }}>
      <PageHeader eyebrow="Sunday reporting" title="Sunday Entry" description="Record attendance and finance received for a service. Totals are calculated automatically and every change is audited." />
      <SundayEntryForm
        serviceDate="2026-10-04" serviceName="Sunday Service" maxDate="2026-10-06" currency="USD" canAttendance canFinance isExisting canManageCategories
        attendanceRows={[{ categoryId: "a1", name: "Adult Church", archived: false, value: "142" }, { categoryId: "a2", name: "Children's Church", archived: false, value: "38" }, { categoryId: "a3", name: "Youth", archived: false, value: "" }]}
        financeRows={[
          { key: "f1:", categoryId: "f1", subcategoryId: null, label: "Offering", groupLabel: null, allowsNegative: false, archived: false, amount: "812.40", notes: "", isGroupHeader: false },
          { key: "f2:", categoryId: "f2", subcategoryId: null, label: "Tithe", groupLabel: null, allowsNegative: false, archived: false, amount: "3105.00", notes: "", isGroupHeader: false },
          { key: "f3:", categoryId: "f3", subcategoryId: null, label: "Church Outreach", groupLabel: null, allowsNegative: false, archived: false, amount: "", notes: "", isGroupHeader: false },
        ]}
      />
    </AppShell>
  );
}
