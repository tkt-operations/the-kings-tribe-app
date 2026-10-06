import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requirePagePermission } from "@/lib/auth";
import { buildTree, listCategories } from "@/lib/data/categories";
import { getChurchSettings } from "@/lib/data/settings";
import { addDays, formatDate, isIsoDate, mostRecentSunday, todayInTimezone } from "@/lib/dates";
import { formatCents, numericToCents } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SundayEntryForm, type FinanceRowModel } from "./sunday-entry-form";

export const metadata = { title: "Sunday Entry" };

export default async function SundayEntryPage({ searchParams }: PageProps<"/sunday">) {
  const user = await requirePagePermission(["attendance.enter", "finance.enter"]);
  const settings = await getChurchSettings();
  const timezone = settings?.timezone ?? "UTC";
  const currency = settings?.currency_code ?? "USD";
  const today = todayInTimezone(timezone);
  const params = await searchParams;

  const requestedDate = typeof params.date === "string" && isIsoDate(params.date) && params.date <= addDays(today, 1) ? params.date : null;
  const serviceDate = requestedDate ?? mostRecentSunday(today);
  const serviceName =
    typeof params.service === "string" && params.service.trim() && params.service.length <= 80 ? params.service.trim() : "Sunday Service";

  const canAttendance = user.permissions.has("attendance.enter");
  const canFinance = user.permissions.has("finance.enter");

  const supabase = await createSupabaseServerClient();
  const [attendanceCats, financeCats, serviceRow, recent] = await Promise.all([
    canAttendance ? listCategories("attendance") : Promise.resolve([]),
    canFinance ? listCategories("finance") : Promise.resolve([]),
    supabase.from("service_dates").select("id, updated_at").eq("service_date", serviceDate).eq("service_name", serviceName).maybeSingle(),
    supabase.rpc("service_category_totals", { p_from: addDays(today, -120), p_to: addDays(today, 1) }),
  ]);

  const serviceId = (serviceRow.data?.id as string | undefined) ?? null;
  const [attendanceEntries, financeEntries] = serviceId
    ? await Promise.all([
        canAttendance
          ? supabase.from("attendance_entries").select("category_id, count").eq("service_date_id", serviceId)
          : Promise.resolve({ data: [] }),
        canFinance
          ? supabase
              .from("finance_entries")
              .select("category_id, subcategory_id, amount, notes, updated_at")
              .eq("service_date_id", serviceId)
              .is("voided_at", null)
          : Promise.resolve({ data: [] }),
      ])
    : [{ data: [] }, { data: [] }];

  const attendanceValues = new Map(
    ((attendanceEntries.data ?? []) as { category_id: string; count: number }[]).map((e) => [e.category_id, String(e.count)]),
  );
  const financeValues = new Map(
    ((financeEntries.data ?? []) as { category_id: string; subcategory_id: string | null; amount: string; notes: string | null }[]).map(
      (e) => [`${e.category_id}:${e.subcategory_id ?? ""}`, { amount: String(e.amount), notes: e.notes ?? "" }],
    ),
  );

  // Show active categories, plus archived ones that already hold data for this service.
  const attendanceRows = attendanceCats
    .filter((c) => !c.parent_id && (c.is_active || attendanceValues.has(c.id)))
    .map((c) => ({ categoryId: c.id, name: c.name, archived: !c.is_active, value: attendanceValues.get(c.id) ?? "" }));

  const financeRows: FinanceRowModel[] = [];
  for (const node of buildTree(financeCats)) {
    const own = financeValues.get(`${node.id}:`);
    const children = node.children.filter((c) => c.is_active || financeValues.has(`${node.id}:${c.id}`));
    if (!node.is_active && !own && children.every((c) => !financeValues.has(`${node.id}:${c.id}`))) continue;
    financeRows.push({
      key: `${node.id}:`,
      categoryId: node.id,
      subcategoryId: null,
      label: node.name,
      groupLabel: null,
      allowsNegative: node.allows_negative,
      archived: !node.is_active,
      amount: own?.amount ?? "",
      notes: own?.notes ?? "",
      isGroupHeader: children.length > 0,
    });
    for (const child of children) {
      const v = financeValues.get(`${node.id}:${child.id}`);
      financeRows.push({
        key: `${node.id}:${child.id}`,
        categoryId: node.id,
        subcategoryId: child.id,
        label: child.name,
        groupLabel: node.name,
        allowsNegative: node.allows_negative || child.allows_negative,
        archived: !child.is_active,
        amount: v?.amount ?? "",
        notes: v?.notes ?? "",
        isGroupHeader: false,
      });
    }
  }

  // Recent services summary
  type TotalRow = { service_date: string; service_name: string; kind: string; total: string };
  const recentMap = new Map<string, { date: string; name: string; attendance: number; finance: bigint }>();
  for (const row of (recent.data ?? []) as TotalRow[]) {
    const key = `${row.service_date}|${row.service_name}`;
    const entry = recentMap.get(key) ?? { date: row.service_date, name: row.service_name, attendance: 0, finance: 0n };
    if (row.kind === "attendance") entry.attendance += Number(row.total);
    else entry.finance += numericToCents(row.total);
    recentMap.set(key, entry);
  }
  const recentServices = [...recentMap.values()].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 10);

  return (
    <>
      <PageHeader
        eyebrow="Sunday reporting"
        title="Sunday Entry"
        description="Record attendance and finance received for a service. Totals are calculated automatically and every change is audited."
      />
      <SundayEntryForm
        key={`${serviceDate}|${serviceName}`}
        serviceDate={serviceDate}
        serviceName={serviceName}
        maxDate={addDays(today, 1)}
        currency={currency}
        canAttendance={canAttendance}
        canFinance={canFinance}
        attendanceRows={attendanceRows}
        financeRows={financeRows}
        isExisting={Boolean(serviceId)}
        canManageCategories={user.permissions.has("categories.manage")}
      />

      <Card className="mt-8">
        <CardHeader title="Recent services" description="Select a service to review or correct it." />
        <CardBody className="pt-2">
          {recentServices.length === 0 ? (
            <p className="py-4 text-sm text-navy/60">No services recorded yet.</p>
          ) : (
            <ul className="divide-y divide-navy/10">
              {recentServices.map((s) => (
                <li key={`${s.date}|${s.name}`}>
                  <Link
                    href={`/sunday?date=${s.date}${s.name !== "Sunday Service" ? `&service=${encodeURIComponent(s.name)}` : ""}`}
                    className="flex min-h-14 items-center justify-between gap-4 py-3 hover:bg-navy/[0.02]"
                  >
                    <div>
                      <p className="font-medium">{formatDate(s.date, "long")}</p>
                      <p className="text-sm text-navy/55">{s.name}</p>
                    </div>
                    <div className="tabular text-right text-sm">
                      {canAttendance ? <p>{s.attendance.toLocaleString()} attended</p> : null}
                      {canFinance ? <p className="font-medium">{formatCents(s.finance, currency)}</p> : null}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  );
}
