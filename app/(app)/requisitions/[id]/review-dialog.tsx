"use client";

import { useState } from "react";
import { ClipboardCheck } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Spinner } from "@/components/ui/submit-button";
import { useAction } from "@/components/ui/use-action";
import { cn } from "@/lib/cn";
import { formatCents, lineTotal, parseMoney, parseQuantity, sumCents } from "@/lib/money";
import { reviewRequisition } from "./actions";
import type { ItemModel } from "./types";

type Decision = "approve" | "partial" | "hold" | "reject";
type LineDecision = "approved" | "held" | "rejected";

const DECISIONS: { key: Decision; label: string; help: string }[] = [
  { key: "approve", label: "Approve", help: "Approve every line (you may adjust quantities or prices)." },
  { key: "partial", label: "Partially approve", help: "Approve some lines and hold or reject others." },
  { key: "hold", label: "Hold", help: "Pause the request — a comment is required." },
  { key: "reject", label: "Reject", help: "Decline the whole request — a comment is required." },
];

export function ReviewDialog(props: {
  requisitionId: string;
  items: ItemModel[];
  currency: string;
  costCenters: { id: string; code: string; name: string }[];
  expenseCategories: { id: string; name: string }[];
  currentCostCenterId: string | null;
  currentExpenseCategoryId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState<Decision>("approve");
  const [comment, setComment] = useState("");
  const [costCenter, setCostCenter] = useState(props.currentCostCenterId ?? "");
  const [expenseCategory, setExpenseCategory] = useState(props.currentExpenseCategoryId ?? "");
  const [lines, setLines] = useState(() =>
    props.items.map((i) => ({
      item_id: i.id,
      decision: "approved" as LineDecision,
      approved_quantity: i.quantity.replace(/\.00$/, ""),
      approved_unit_price: i.estimatedUnitPrice,
      comment: "",
    })),
  );
  const { pending, error, run, setError } = useAction();

  const effective = lines.map((l) => (decision === "approve" ? { ...l, decision: "approved" as LineDecision } : l));
  const approvedTotal =
    decision === "hold" || decision === "reject"
      ? 0n
      : sumCents(
      effective
        .filter((l) => l.decision === "approved")
        .map((l) => {
          const q = parseQuantity(l.approved_quantity);
          const p = parseMoney(l.approved_unit_price);
          return q !== null && p !== null ? lineTotal(q, p) : 0n;
        }),
        );

  function update(index: number, patch: Partial<(typeof lines)[number]>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if ((decision === "hold" || decision === "reject") && !comment.trim()) {
      setError("A comment is required when holding or rejecting.");
      return;
    }
    run(
      () =>
        reviewRequisition(props.requisitionId, {
          decision,
          comment,
          cost_center_id: costCenter || null,
          expense_category_id: expenseCategory || null,
          items: decision === "hold" || decision === "reject" ? [] : effective,
        }),
      () => setOpen(false),
    );
  }

  const showLines = decision === "approve" || decision === "partial";

  return (
    <>
      <Button variant="gold" onClick={() => setOpen(true)}>
        <ClipboardCheck className="size-4" aria-hidden /> Review
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Finance review" description="Decide on the request and each line. The requester is notified of the outcome." wide>
        <form onSubmit={submit} className="space-y-5">
          {error ? <Alert tone="error">{error}</Alert> : null}
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Decision</legend>
            <div className="grid gap-2 sm:grid-cols-4">
              {DECISIONS.map((d) => (
                <label key={d.key} className={cn("cursor-pointer rounded-2xl border p-3 text-sm", decision === d.key ? "border-navy bg-navy text-white" : "border-navy/15 hover:border-navy/30")}>
                  <input type="radio" name="decision" value={d.key} checked={decision === d.key} onChange={() => setDecision(d.key)} className="sr-only" />
                  <span className={cn("block font-bold", decision === d.key && "text-gold")}>{d.label}</span>
                  <span className={cn("mt-0.5 block text-[13px]", decision === d.key ? "text-white/75" : "text-navy/60")}>{d.help}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {showLines ? (
            <div className="space-y-3">
              {props.items.map((item, index) => {
                const line = effective[index];
                const needsComment = line.decision !== "approved";
                return (
                  <div key={item.id} className="rounded-2xl border border-navy/10 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{item.line}. {item.description}</p>
                      <p className="tabular text-sm text-navy/60">Requested {item.quantity.replace(/\.00$/, "")} × {formatCents(parseMoney(item.estimatedUnitPrice) ?? 0n, props.currency)}</p>
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-[10rem_7rem_9rem_1fr]">
                      <Select aria-label={`Decision for line ${item.line}`} value={line.decision} disabled={decision === "approve"}
                        onChange={(e) => update(index, { decision: e.target.value as LineDecision })}>
                        <option value="approved">Approve</option>
                        <option value="held">Hold</option>
                        <option value="rejected">Reject</option>
                      </Select>
                      <Input aria-label={`Approved quantity for line ${item.line}`} inputMode="decimal" className="tabular" value={line.approved_quantity}
                        disabled={line.decision !== "approved"} onChange={(e) => update(index, { approved_quantity: e.target.value })} />
                      <Input aria-label={`Approved unit price for line ${item.line}`} inputMode="decimal" className="tabular" value={line.approved_unit_price}
                        disabled={line.decision !== "approved"} onChange={(e) => update(index, { approved_unit_price: e.target.value })} />
                      <Input aria-label={`Comment for line ${item.line}`} placeholder={needsComment ? "Reason (required)" : "Comment (optional)"} value={line.comment}
                        onChange={(e) => update(index, { comment: e.target.value })} aria-invalid={needsComment && !line.comment && !comment} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Budget line / cost center" htmlFor="review_cc">
              <Select id="review_cc" value={costCenter} onChange={(e) => setCostCenter(e.target.value)}>
                <option value="">Not assigned</option>
                {props.costCenters.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </Select>
            </Field>
            <Field label="Expense category" htmlFor="review_cat">
              <Select id="review_cat" value={expenseCategory} onChange={(e) => setExpenseCategory(e.target.value)}>
                <option value="">Not assigned</option>
                {props.expenseCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
          </div>

          <Field label={decision === "hold" || decision === "reject" ? "Comment for the requester (required)" : "Comment for the requester (optional)"} htmlFor="review_comment">
            <Textarea id="review_comment" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} />
          </Field>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-navy/10 pt-4">
            <p className="text-sm">Approved total <span className="tabular ml-2 font-serif text-2xl">{formatCents(approvedTotal, props.currency)}</span></p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={pending}>{pending ? <Spinner /> : null}Save decision</Button>
            </div>
          </div>
        </form>
      </Dialog>
    </>
  );
}
