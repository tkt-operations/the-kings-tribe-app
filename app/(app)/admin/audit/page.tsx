import Link from "next/link";
import { Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { requirePagePermission } from "@/lib/auth";
import { getChurchSettings } from "@/lib/data/settings";
import { addDays, formatDateTime, isIsoDate } from "@/lib/dates";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = { title: "Audit log" };

const PAGE = 100;
const ENTITY_TYPES = ["requisition", "purchase_order", "vendor_order", "receipt", "disbursement", "finance_entry", "attendance_entry", "category", "department", "department_subcategory", "cost_center", "request_type", "church_settings", "user_role", "role_permission", "profile", "external_form_token"];

export default async function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  await requirePagePermission("audit.view");
  const settings = await getChurchSettings();
  const tz = settings?.timezone ?? "UTC";
  const params = await searchParams;
  const entity = typeof params.entity === "string" && ENTITY_TYPES.includes(params.entity) ? params.entity : "";
  const from = typeof params.from === "string" && isIsoDate(params.from) ? params.from : "";
  const to = typeof params.to === "string" && isIsoDate(params.to) ? params.to : "";
  const page = Math.max(1, Math.min(500, Number(params.page) || 1));

  const supabase = await createSupabaseServerClient();
  let query = supabase.from("audit_logs").select("id, occurred_at, actor_id, actor_label, action, entity_type, entity_id, requisition_id, before_data, after_data, metadata", { count: "exact" })
    .order("occurred_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
  if (entity) query = query.eq("entity_type", entity);
  if (from) query = query.gte("occurred_at", `${from}T00:00:00Z`);
  if (to) query = query.lt("occurred_at", `${addDays(to, 1)}T00:00:00Z`);
  const [{ data, count }, { data: people }] = await Promise.all([query, supabase.from("profiles").select("id, full_name, email")]);
  const names = new Map(((people ?? []) as { id: string; full_name: string; email: string }[]).map((p) => [p.id, p.full_name || p.email]));
  type Row = { id: string; occurred_at: string; actor_id: string | null; actor_label: string | null; action: string; entity_type: string; entity_id: string | null; requisition_id: string | null; before_data: unknown; after_data: unknown; metadata: unknown };
  const rows = (data ?? []) as Row[];
  const qs = (p: number) => `/admin/audit?${new URLSearchParams({ ...(entity && { entity }), ...(from && { from }), ...(to && { to }), page: String(p) })}`;

  return (
    <>
      <PageHeader eyebrow="Administration" title="Audit log" description="Append-only. Nobody — including administrators — can edit or delete these records." />
      <form method="get" className="mb-5 flex flex-wrap items-end gap-2">
        <Select name="entity" defaultValue={entity} aria-label="Entity type" className="w-56">
          <option value="">All record types</option>
          {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
        </Select>
        <Input type="date" name="from" defaultValue={from} aria-label="From" className="w-44" />
        <Input type="date" name="to" defaultValue={to} aria-label="To" className="w-44" />
        <button type="submit" className="h-12 rounded-xl bg-navy px-5 font-medium text-gold">Filter</button>
      </form>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="rounded-2xl bg-white p-4 ring-1 ring-navy/10">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-mono text-[13px] font-bold">{r.action}</p>
              <p className="text-[13px] text-navy/60">{formatDateTime(r.occurred_at, tz)} · {r.actor_id ? names.get(r.actor_id) ?? r.actor_id : r.actor_label ?? "system"}</p>
            </div>
            {r.requisition_id ? <Link href={`/requisitions/${r.requisition_id}`} className="text-[13px] underline decoration-gold underline-offset-4">Open requisition</Link> : null}
            {r.before_data || r.after_data ? (
              <details className="mt-2">
                <summary className="cursor-pointer text-[13px] text-navy/60">Before / after</summary>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <pre className="max-h-64 overflow-auto rounded-xl bg-neutral-gray p-3 text-[11px]">{JSON.stringify(r.before_data, null, 2) ?? "—"}</pre>
                  <pre className="max-h-64 overflow-auto rounded-xl bg-neutral-gray p-3 text-[11px]">{JSON.stringify(r.after_data, null, 2) ?? "—"}</pre>
                </div>
              </details>
            ) : null}
          </li>
        ))}
      </ul>
      <nav className="mt-5 flex items-center justify-between text-sm">
        <span className="text-navy/60">{count ?? 0} events</span>
        <span className="flex gap-2">
          {page > 1 ? <Link href={qs(page - 1)} className="rounded-xl px-3 py-2 ring-1 ring-navy/15">Newer</Link> : null}
          {(count ?? 0) > page * PAGE ? <Link href={qs(page + 1)} className="rounded-xl px-3 py-2 ring-1 ring-navy/15">Older</Link> : null}
        </span>
      </nav>
    </>
  );
}
