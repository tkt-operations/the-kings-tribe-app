import Link from "next/link";
import { Search } from "lucide-react";
import { StatusBadge } from "@/components/ui/badge";
import { PriorityIndicator } from "@/components/ui/priority-badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { requirePagePermission } from "@/lib/auth";
import { getChurchSettings } from "@/lib/data/settings";
import { addDays, formatDate, isIsoDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { isPriority, PRIORITIES, PRIORITY_LABELS, type Priority } from "@/lib/priority";
import { sanitizeSearch } from "@/lib/search";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { REQUISITION_STATUSES, STATUS_LABELS, isRequisitionStatus, type RequisitionStatus } from "@/lib/workflow/status";

export const metadata = { title: "Requisitions" };

const PAGE_SIZE = 50;

type Row = {
  id: string;
  requisition_number: string;
  submitted_at: string;
  requester_name: string;
  requester_email: string;
  needed_by: string;
  estimated_total: string;
  status: RequisitionStatus;
  is_demo: boolean;
  assigned_reviewer_id: string | null;
  departments: { name: string } | null;
  department_subcategories: { name: string } | null;
  request_types: { name: string } | null;
  // Calculated from line items in the database (never stored on the requisition)
  highest_item_priority: Priority | null;
  essential_item_count: number;
};

const SORTS = { newest: "Newest first", priority: "Priority (Essential first)" } as const;

export default async function RequisitionsPage({ searchParams }: PageProps<"/requisitions">) {
  const user = await requirePagePermission("requisitions.view");
  const settings = await getChurchSettings();
  const currency = settings?.currency_code ?? "USD";
  const params = await searchParams;
  const str = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : "");

  const q = sanitizeSearch(str("q"));
  const status = str("status");
  const department = str("department");
  const type = str("type");
  const from = isIsoDate(str("from")) ? str("from") : "";
  const to = isIsoDate(str("to")) ? str("to") : "";
  const requester = sanitizeSearch(str("requester"));
  const priority = isPriority(str("priority")) ? str("priority") : "";
  const sort = str("sort") === "priority" ? "priority" : "newest";
  const page = Math.max(1, Math.min(1000, Number(str("page")) || 1));
  const uuid = /^[0-9a-f-]{36}$/i;

  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("requisitions")
    .select(
      "id, requisition_number, submitted_at, requester_name, requester_email, needed_by, estimated_total, status, is_demo, assigned_reviewer_id, departments(name), department_subcategories(name), request_types(name), highest_item_priority, essential_item_count",
      { count: "exact" },
    );
  // Enum order makes ascending = Essential, High, Medium, Low.
  if (sort === "priority") query = query.order("highest_item_priority", { ascending: true, nullsFirst: false });
  query = query.order("submitted_at", { ascending: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (priority) query = query.eq("highest_item_priority", priority);
  if (status === "open") query = query.not("status", "in", "(closed,rejected)");
  else if (isRequisitionStatus(status)) query = query.eq("status", status);
  if (uuid.test(department)) query = query.eq("department_id", department);
  if (uuid.test(type)) query = query.eq("request_type_id", type);
  if (from) query = query.gte("submitted_at", `${from}T00:00:00Z`);
  if (to) query = query.lt("submitted_at", `${addDays(to, 1)}T00:00:00Z`);
  if (requester) query = query.or(`requester_name.ilike.%${requester}%,requester_email.ilike.%${requester}%`);
  if (q) query = query.or(`requisition_number.ilike.%${q}%,requester_name.ilike.%${q}%,requester_email.ilike.%${q}%,justification.ilike.%${q}%`);

  const [{ data, count }, { data: depts }, { data: types }, { data: people }] = await Promise.all([
    query,
    supabase.from("departments").select("id, name").order("sort_order"),
    supabase.from("request_types").select("id, name").order("sort_order"),
    supabase.from("profiles").select("id, full_name"),
  ]);
  const rows = (data ?? []) as unknown as Row[];
  const names = new Map(((people ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]));
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const qs = (overrides: Record<string, string | number>) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries({ q, status, department, type, from, to, requester, priority, sort: sort === "newest" ? "" : sort, page, ...overrides })) if (v) sp.set(k, String(v));
    return `/requisitions?${sp.toString()}`;
  };

  return (
    <>
      <PageHeader
        eyebrow="Purchasing"
        title="Requisitions"
        description="Requests submitted by department leads through secure requisition links."
        actions={user.permissions.has("form_links.manage") ? <ButtonLink href="/admin/form-links" variant="secondary">Requisition links</ButtonLink> : null}
      />

      <form method="get" className="mb-6 grid gap-2 rounded-[var(--radius-card)] bg-white p-3 ring-1 ring-navy/10 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-3.5 size-5 text-navy/40" aria-hidden />
          <Input name="q" defaultValue={q} placeholder="Search number, requester, purpose…" className="pl-11" aria-label="Search" type="search" />
        </div>
        <Select name="status" defaultValue={status} aria-label="Status">
          <option value="">All statuses</option>
          <option value="open">Open (not closed/rejected)</option>
          {REQUISITION_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </Select>
        <Select name="department" defaultValue={department} aria-label="Department">
          <option value="">All departments</option>
          {((depts ?? []) as { id: string; name: string }[]).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Select>
        <Select name="type" defaultValue={type} aria-label="Request type">
          <option value="">All request types</option>
          {((types ?? []) as { id: string; name: string }[]).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
        <Select name="priority" defaultValue={priority} aria-label="Highest item priority">
          <option value="">Any priority</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>Highest item: {PRIORITY_LABELS[p]}</option>)}
        </Select>
        <Select name="sort" defaultValue={sort} aria-label="Sort">
          {Object.entries(SORTS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </Select>
        <details className="sm:col-span-2 lg:col-span-1 lg:row-start-3 lg:col-start-1">
          <summary className="flex h-12 cursor-pointer items-center text-sm font-medium text-navy/70">More filters</summary>
          <div className="grid gap-2 pb-2 sm:grid-cols-3">
            <Input name="requester" defaultValue={requester} placeholder="Requester name or email" aria-label="Requester" />
            <Input name="from" type="date" defaultValue={from} aria-label="Submitted from" />
            <Input name="to" type="date" defaultValue={to} aria-label="Submitted to" />
          </div>
        </details>
        <div className="flex gap-2 lg:row-start-1 lg:col-start-5">
          <button type="submit" className="h-12 flex-1 rounded-xl bg-navy px-5 font-medium text-gold">Filter</button>
          <Link href="/requisitions" className="flex h-12 items-center rounded-xl px-3 text-sm font-medium text-navy/70 hover:bg-navy/5">Clear</Link>
        </div>
      </form>

      {rows.length === 0 ? (
        <EmptyState title="No requisitions found">Try different filters, or share a requisition link with a department lead.</EmptyState>
      ) : (
        <>
          {/* Mobile cards */}
          <ul className="space-y-3 lg:hidden">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={`/requisitions/${r.id}`} className="block rounded-[var(--radius-card)] bg-white p-4 ring-1 ring-navy/10 active:bg-navy/[0.02]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="tabular font-bold">{r.requisition_number}{r.is_demo ? <span className="ml-2 text-xs font-medium text-navy/50">DEMO</span> : null}</p>
                      <p className="truncate text-sm text-navy/65">{r.requester_name} · {r.departments?.name}</p>
                    </div>
                    <StatusBadge status={r.status} />
                  </div>
                  {r.highest_item_priority && r.highest_item_priority !== "medium" && r.highest_item_priority !== "low" ? (
                    <PriorityIndicator className="mt-2" highest={r.highest_item_priority} essentialCount={r.essential_item_count} />
                  ) : null}
                  <div className="mt-3 flex items-end justify-between text-sm">
                    <span className="text-navy/60">{r.request_types?.name} · needed {formatDate(r.needed_by, "short")}</span>
                    <span className="tabular text-base font-bold">{formatMoney(r.estimated_total, currency)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-[var(--radius-card)] bg-white ring-1 ring-navy/10 lg:block">
            <table className="w-full text-sm">
              <thead className="bg-neutral-gray/60 text-left text-[13px] text-navy/60">
                <tr>
                  {["Requisition #", "Date", "Requester", "Department", "Subcategory", "Request type", "Needed", "Est. total", "Status", "Priority", "Reviewer"].map((h, i) => (
                    <th key={h} scope="col" className={`px-4 py-3 font-medium ${i === 7 ? "text-right" : ""}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-navy/[0.07]">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-navy/[0.02]">
                    <td className="px-4 py-3">
                      <Link href={`/requisitions/${r.id}`} className="tabular font-bold underline-offset-4 hover:underline">{r.requisition_number}</Link>
                      {r.is_demo ? <span className="ml-1.5 text-[11px] font-medium text-navy/45">DEMO</span> : null}
                    </td>
                    <td className="tabular px-4 py-3 text-navy/70">{formatDate(r.submitted_at.slice(0, 10), "short")}</td>
                    <td className="px-4 py-3">{r.requester_name}</td>
                    <td className="px-4 py-3">{r.departments?.name}</td>
                    <td className="px-4 py-3 text-navy/70">{r.department_subcategories?.name}</td>
                    <td className="px-4 py-3 text-navy/70">{r.request_types?.name}</td>
                    <td className="tabular px-4 py-3 text-navy/70">{formatDate(r.needed_by, "short")}</td>
                    <td className="tabular px-4 py-3 text-right font-medium">{formatMoney(r.estimated_total, currency)}</td>
                    <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                    <td className="px-4 py-3"><PriorityIndicator highest={r.highest_item_priority} essentialCount={r.essential_item_count} /></td>
                    <td className="px-4 py-3 text-navy/70">{r.assigned_reviewer_id ? names.get(r.assigned_reviewer_id) ?? "—" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <nav className="mt-6 flex items-center justify-between text-sm" aria-label="Pagination">
            <span className="text-navy/60">{count} requisition{count === 1 ? "" : "s"}</span>
            <span className="flex gap-2">
              {page > 1 ? <Link href={qs({ page: page - 1 })} className="rounded-xl px-3 py-2 ring-1 ring-navy/15 hover:bg-white">Previous</Link> : null}
              {page < pages ? <Link href={qs({ page: page + 1 })} className="rounded-xl px-3 py-2 ring-1 ring-navy/15 hover:bg-white">Next</Link> : null}
            </span>
          </nav>
        </>
      )}
    </>
  );
}
