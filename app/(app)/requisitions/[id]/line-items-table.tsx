import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EssentialReason } from "@/components/ui/essential-reason";
import { PriorityBadge } from "@/components/ui/priority-badge";
import type { RequisitionItem } from "@/lib/data/requisition-detail";
import { formatMoney, numericToCents, quantityToDecimal } from "@/lib/money";

function q(value: string | null | undefined) {
  if (value === null || value === undefined) return "—";
  return String(value).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

type Line = Pick<RequisitionItem,
  | "id" | "line_number" | "description" | "specifications" | "color" | "size" | "vendor_name" | "vendor_url" | "notes"
  | "review_status" | "review_comment" | "quantity" | "estimated_unit_price" | "estimated_total" | "approved_quantity"
  | "approved_unit_price" | "approved_total" | "po_quantity" | "ordered_quantity" | "purchased_quantity" | "actual_total"
  | "cancelled_quantity" | "cancel_reason" | "priority" | "essential_justification">;

/**
 * Purchasing lifecycle table (requisition detail). Rendered full width above
 * the two-column area, so it fits from ~1280px; scrolls inside its card below; the Item column keeps a readable width and wraps
 * (badge → description → compact "Why essential" → details), while quantities
 * and amounts stay on one line.
 */
export function LineItemsTable({ items, currency, renderPriorityEditor, renderRemaining }: {
  items: Line[];
  currency: string;
  renderPriorityEditor?: (item: Line) => React.ReactNode;
  renderRemaining?: (item: Line, remaining: bigint) => React.ReactNode;
}) {
  return (
    // `relative` keeps absolutely-positioned screen-reader text inside the scroll box.
    <div className="relative overflow-x-auto" data-testid="line-items-scroll">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="text-left text-[12px] text-navy/55">
          <tr className="border-y border-navy/10">
            <th scope="col" className="py-2 pl-5 pr-2 font-medium sm:pl-6">#</th>
            <th scope="col" className="px-2 py-2 font-medium">Item</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Requested</th>
            <th scope="col" className="px-2 py-2 font-medium">Decision</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Approved</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">On PO</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Ordered</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Purchased</th>
            <th scope="col" className="px-2 py-2 pr-5 text-right font-medium sm:pr-6">Actual</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-navy/[0.07] align-top">
          {items.map((i) => {
            const approved = i.review_status === "approved";
            const remaining = approved ? numericToCents(i.approved_quantity) - numericToCents(i.purchased_quantity) - numericToCents(i.cancelled_quantity) : 0n;
            const details = [i.specifications, i.color && `Color: ${i.color}`, i.size && `Size: ${i.size}`, i.vendor_name && `Vendor: ${i.vendor_name}`].filter(Boolean).join(" · ");
            return (
              <tr key={i.id}>
                <td className="tabular py-3 pl-5 pr-2 text-navy/50 sm:pl-6">{i.line_number}</td>
                <td className="min-w-[14rem] px-2 py-3" data-testid="item-cell">
                  <div className="mb-1 flex flex-wrap items-center gap-1">
                    <PriorityBadge priority={i.priority} size="sm" />
                    {renderPriorityEditor?.(i)}
                  </div>
                  <p className="font-medium [overflow-wrap:anywhere]">{i.description}</p>
                  <EssentialReason reason={i.priority === "essential" ? i.essential_justification : null} />
                  {details ? <p className="mt-1 text-[13px] text-navy/60">{details}</p> : null}
                  {i.vendor_url ? (
                    <a href={i.vendor_url} target="_blank" rel="noopener noreferrer nofollow" className="mt-0.5 inline-flex items-center gap-1 text-[13px] text-ministry-blue underline-offset-2 hover:underline">
                      Product link <ExternalLink className="size-3" aria-hidden />
                    </a>
                  ) : null}
                  {i.notes ? <p className="mt-1 text-[13px] text-navy/60">Note: {i.notes}</p> : null}
                  {i.review_comment ? <p className="mt-1 text-[13px] font-medium">Finance: {i.review_comment}</p> : null}
                  {Number(i.cancelled_quantity) > 0 ? <p className="mt-1 text-[13px] text-navy/60">{q(i.cancelled_quantity)} not purchased — {i.cancel_reason}</p> : null}
                </td>
                <td className="tabular whitespace-nowrap px-2 py-3 text-right">
                  {q(i.quantity)} × {formatMoney(i.estimated_unit_price, currency)}
                  <span className="block font-medium">{formatMoney(i.estimated_total, currency)}</span>
                </td>
                <td className="whitespace-nowrap px-2 py-3">
                  <Badge tone={approved ? "positive" : i.review_status === "rejected" ? "negative" : i.review_status === "held" ? "attention" : "neutral"}>
                    {i.review_status === "pending" ? "Pending" : i.review_status.charAt(0).toUpperCase() + i.review_status.slice(1)}
                  </Badge>
                </td>
                <td className="tabular whitespace-nowrap px-2 py-3 text-right">
                  {approved ? (
                    <>
                      {q(i.approved_quantity)} × {formatMoney(i.approved_unit_price, currency)}
                      <span className="block font-medium">{formatMoney(i.approved_total, currency)}</span>
                    </>
                  ) : "—"}
                </td>
                <td className="tabular whitespace-nowrap px-2 py-3 text-right">{approved ? q(i.po_quantity) : "—"}</td>
                <td className="tabular whitespace-nowrap px-2 py-3 text-right">{approved ? q(i.ordered_quantity) : "—"}</td>
                <td className="tabular px-2 py-3 text-right">
                  <span className="whitespace-nowrap">{approved ? q(i.purchased_quantity) : "—"}</span>
                  {remaining > 0n ? <span className="block whitespace-nowrap text-[12px] text-navy/55">{quantityToDecimal(remaining)} remaining</span> : null}
                  {remaining > 0n ? renderRemaining?.(i, remaining) : null}
                </td>
                <td className="tabular whitespace-nowrap px-2 py-3 pr-5 text-right font-medium sm:pr-6">{approved ? formatMoney(i.actual_total, currency) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
