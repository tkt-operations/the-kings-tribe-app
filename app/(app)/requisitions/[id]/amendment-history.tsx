import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { displayValue, FIELD_LABELS, type AmendableField } from "@/lib/amendments";
import type { AmendmentRow } from "@/lib/data/requisition-detail";
import { formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

const label = (field: string) => FIELD_LABELS[field as AmendableField] ?? field;

/** Every amendment, newest first: who, when, why, and each line's old → new values. */
export function AmendmentHistory({ amendments, currency, timezone, name }: {
  amendments: AmendmentRow[];
  currency: string;
  timezone: string;
  name: (id: string | null) => string | null;
}) {
  if (!amendments.length) return null;
  const money = (v: string) => formatMoney(v, currency);
  return (
    <Card>
      <CardHeader title="Amendment history" description="Every change since submission. Earlier values are always kept." />
      <CardBody>
        <ol className="space-y-4" aria-label="Amendments, newest first">
          {amendments.map((a) => {
            const byLine = new Map<number, AmendmentRow["changes"]>();
            for (const c of a.changes) byLine.set(c.line_number, [...(byLine.get(c.line_number) ?? []), c]);
            return (
              <li key={a.id} className="rounded-2xl border border-navy/10 p-4" data-testid="amendment">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold">Revision {a.revision_number}</span>
                  <span className="text-sm text-navy/60">{name(a.actor_id) ?? a.actor_label ?? "System"} · {formatDateTime(a.submitted_at, timezone)}</span>
                </div>
                <p className="mt-1 text-sm"><span className="text-navy/60">Reason:</span> {a.reason}</p>
                <p className="tabular mt-1 text-sm text-navy/70">Estimated total {money(a.estimated_total_before)} → {money(a.estimated_total_after)}</p>
                <ul className="mt-2 space-y-2 text-sm">
                  {[...byLine.entries()].map(([line, changes]) => {
                    const first = changes[0];
                    if (first.change_type === "added") {
                      const v = (first.new_value ?? {}) as Record<string, string>;
                      return (
                        <li key={line}><Badge tone="info">New</Badge> <strong>Line {line}: {v.description}</strong>
                          <span className="tabular ml-1 text-navy/60">{displayValue("quantity", v.quantity, money)} × {displayValue("estimated_unit_price", v.estimated_unit_price, money)}</span></li>
                      );
                    }
                    if (first.change_type === "removed") {
                      const v = (first.old_value ?? {}) as Record<string, string>;
                      const reason = (first.new_value as { removed_reason?: string } | null)?.removed_reason;
                      return (
                        <li key={line}><Badge tone="negative">Removed</Badge> <strong className="line-through">Line {line}: {v.description}</strong>
                          {reason ? <span className="block text-navy/60">Reason: {reason}</span> : null}</li>
                      );
                    }
                    const review = first.previous_review;
                    return (
                      <li key={line}>
                        <Badge tone="attention">Changed</Badge> <strong>Line {line}</strong>
                        <ul className="mt-0.5 space-y-0.5 pl-1">
                          {changes.map((c) => (
                            <li key={c.id}>
                              <span className="text-navy/60">{label(c.field ?? "")}:</span>{" "}
                              <span className="line-through text-navy/55">{displayValue(c.field ?? "", c.old_value, money)}</span>{" → "}
                              <strong>{displayValue(c.field ?? "", c.new_value, money)}</strong>
                            </li>
                          ))}
                        </ul>
                        {review?.review_status && review.review_status !== "pending" ? (
                          <p className="text-[13px] text-navy/60">Earlier decision ({review.review_status}{review.review_comment ? `: ${review.review_comment}` : ""}) cleared — the line returns to review.</p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ol>
      </CardBody>
    </Card>
  );
}
