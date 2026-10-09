import Link from "next/link";
import { Search } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { RequisitionCards, RequisitionTable, type RequisitionListRow } from "./requisition-list";
import { requirePagePermission } from "@/lib/auth";
import { getChurchSettings } from "@/lib/data/settings";
import { addDays, isIsoDate } from "@/lib/dates";
import { isPriority, PRIORITIES, PRIORITY_LABELS } from "@/lib/priority";
import { sanitizeSearch } from "@/lib/search";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { REQUISITION_STATUSES, STATUS_LABELS, isRequisitionStatus } from "@/lib/workflow/status";
import { ATTENTION_LABELS, isRequisitionAttentionCard } from "@/lib/notifications/attention";

export const metadata = { title: "Requisitions" };

const PAGE_SIZE = 50;

type Row = RequisitionListRow & { requester_email: string };

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
  // Needs Attention card filter: the same live workflow rule as the dashboard card (database function).
  const attention = isRequisitionAttentionCard(str("attention")) ? str("attention") : "";
  const page = Math.max(1, Math.min(1000, Number(str("page")) || 1));
  const uuid = /^[0-9a-f-]{36}$/i;

  const supabase = await createSupabaseServerClient();
  let attentionIds: string[] | null = null;
  if (attention) {
    const { data: idRows } = await supabase.rpc("needs_attention_requisition_ids", { p_card: attention });
    attentionIds = ((idRows ?? []) as unknown[]).map((r) => (typeof r === "string" ? r : String((r as Record<string, unknown>).needs_attention_requisition_ids ?? ""))).filter((id) => uuid.test(id));
  }
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
  if (attentionIds) query = attentionIds.length ? query.in("id", attentionIds) : query.eq("id", "00000000-0000-0000-0000-000000000000");
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
    for (const [k, v] of Object.entries({ q, status, department, type, from, to, requester, priority, attention, sort: sort === "newest" ? "" : sort, page, ...overrides })) if (v) sp.set(k, String(v));
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

      {attention ? (
        <p className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="inline-flex min-h-9 items-center rounded-full bg-gold/25 px-3 font-medium text-navy">
            Needs attention: {ATTENTION_LABELS[attention as keyof typeof ATTENTION_LABELS].title}
          </span>
          <Link href={qs({ attention: "", page: "" })} className="inline-flex min-h-11 items-center rounded-xl px-2 font-medium text-navy/70 underline-offset-2 hover:underline">
            Show all requisitions
          </Link>
        </p>
      ) : null}

      <form method="get" className="mb-6 grid gap-2 rounded-[var(--radius-card)] bg-white p-3 ring-1 ring-navy/10 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto]">
        {attention ? <input type="hidden" name="attention" value={attention} /> : null}
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
          <RequisitionCards rows={rows} currency={currency} />
          <RequisitionTable rows={rows} currency={currency} timezone={settings?.timezone ?? "UTC"} reviewerName={(id) => (id ? names.get(id) ?? "—" : "—")} />

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
