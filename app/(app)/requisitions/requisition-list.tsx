import Link from "next/link";
import { StatusBadge } from "@/components/ui/badge";
import { PriorityIndicator } from "@/components/ui/priority-badge";
import { formatDate, formatTimestampDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import type { Priority } from "@/lib/priority";
import type { RequisitionStatus } from "@/lib/workflow/status";

export type RequisitionListRow = {
  id: string;
  requisition_number: string;
  submitted_at: string;
  requester_name: string;
  needed_by: string;
  estimated_total: string | number;
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

/** Phones, tablets and small laptops (below 1280px): one card per requisition. */
export function RequisitionCards({ rows, currency }: { rows: RequisitionListRow[]; currency: string }) {
  return (
    <ul className="space-y-3 xl:hidden">
      {rows.map((r) => (
        <li key={r.id}>
          <Link href={`/requisitions/${r.id}`} className="block rounded-[var(--radius-card)] bg-white p-4 ring-1 ring-navy/10 active:bg-navy/[0.02]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="tabular font-bold">{r.requisition_number}{r.is_demo ? <span className="ml-2 text-xs font-medium text-navy/50">DEMO</span> : null}</p>
                <p className="text-sm text-navy/65 [overflow-wrap:anywhere]">{r.requester_name} · {r.departments?.name}</p>
              </div>
              <StatusBadge status={r.status} />
            </div>
            <PriorityIndicator className="mt-2" highest={r.highest_item_priority} essentialCount={r.essential_item_count} />
            <div className="mt-3 flex flex-wrap items-end justify-between gap-x-3 gap-y-1 text-sm">
              <span className="text-navy/60">{r.request_types?.name} · needed {formatDate(r.needed_by, "short")}</span>
              <span className="tabular text-base font-bold">{formatMoney(r.estimated_total, currency)}</span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * Desktop (≥1280px; the content area is ~912px beside the sidebar). Seven
 * columns, with secondary details stacked under the primary value so nothing
 * is dropped: submitted date under the number, department/subcategory under
 * the requester, reviewer under the status. Amounts, statuses and dates never
 * wrap; the Priority indicator wraps inside its cell. The wrapper scrolls
 * horizontally only if the content genuinely cannot fit, and is `relative` so
 * absolutely-positioned screen-reader text inside it is clipped instead of
 * widening the page.
 */
/** `timezone` is the church timezone: the Submitted date matches the detail page and "today". */
export function RequisitionTable({ rows, currency, timezone, reviewerName }: { rows: RequisitionListRow[]; currency: string; timezone: string; reviewerName: (id: string | null) => string }) {
  return (
    <div className="hidden overflow-hidden rounded-[var(--radius-card)] bg-white ring-1 ring-navy/10 xl:block">
      <div className="relative overflow-x-auto" data-testid="requisition-table-scroll">
        <table className="w-full text-sm">
          <thead className="bg-neutral-gray/60 text-left text-[13px] text-navy/60">
            <tr>
              <th scope="col" className="px-3 py-3 font-medium">Requisition</th>
              <th scope="col" className="px-3 py-3 font-medium">Requester · Department</th>
              <th scope="col" className="px-3 py-3 font-medium">Request type</th>
              <th scope="col" className="px-3 py-3 font-medium">Needed</th>
              <th scope="col" className="px-3 py-3 text-right font-medium">Est. total</th>
              <th scope="col" className="px-3 py-3 font-medium">Status · Reviewer</th>
              <th scope="col" className="px-3 py-3 font-medium">Priority</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-navy/[0.07]">
            {rows.map((r) => (
              <tr key={r.id} className="align-top hover:bg-navy/[0.02]">
                <td className="whitespace-nowrap px-3 py-3">
                  <Link href={`/requisitions/${r.id}`} className="tabular font-bold underline-offset-4 hover:underline">{r.requisition_number}</Link>
                  {r.is_demo ? <span className="ml-1.5 text-[11px] font-medium text-navy/45">DEMO</span> : null}
                  <span className="tabular block text-[13px] text-navy/60">Submitted {formatTimestampDate(r.submitted_at, timezone, "short")}</span>
                </td>
                <td className="min-w-[9rem] px-3 py-3">
                  {r.requester_name}
                  <span className="block text-[13px] text-navy/60">
                    {r.departments?.name}{r.department_subcategories?.name ? ` · ${r.department_subcategories.name}` : ""}
                  </span>
                </td>
                <td className="min-w-[6rem] px-3 py-3 text-navy/70">{r.request_types?.name}</td>
                <td className="tabular whitespace-nowrap px-3 py-3 text-navy/70">{formatDate(r.needed_by, "short")}</td>
                <td className="tabular whitespace-nowrap px-3 py-3 text-right font-medium">{formatMoney(r.estimated_total, currency)}</td>
                <td className="px-3 py-3">
                  <span className="whitespace-nowrap"><StatusBadge status={r.status} /></span>
                  <span className="mt-1 block text-[13px] text-navy/60"><span className="sr-only">Reviewer: </span>{reviewerName(r.assigned_reviewer_id)}</span>
                </td>
                <td className="min-w-[8.5rem] px-3 py-3" data-testid="priority-cell"><PriorityIndicator highest={r.highest_item_priority} essentialCount={r.essential_item_count} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
