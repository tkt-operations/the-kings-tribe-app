"use client";

import { useRef, useState } from "react";
import { ClipboardCheck } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EssentialReason } from "@/components/ui/essential-reason";
import { PriorityBadge } from "@/components/ui/priority-badge";
import { Field, Input, RequiredMark, RequiredNote, Select, Textarea } from "@/components/ui/field";
import { useFieldErrors } from "@/components/ui/form-feedback";
import { LoadingButton } from "@/components/ui/submit-button";
import { useAction } from "@/components/ui/use-action";
import { rules, validate, type Check } from "@/lib/validation/form";
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
  const { pending, error, run } = useAction();
  const formRef = useRef<HTMLFormElement>(null);
  const fields = useFieldErrors();
  const commentRequired = decision === "hold" || decision === "reject";

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
    for (const key of Object.keys(patch)) fields.clear(`rv_${key}_${index}`);
  }

  function validateReview() {
    const spec: Record<string, [string, ...Check[]]> = {
      review_comment: [comment, ...(commentRequired ? [rules.required("A comment is required when holding or rejecting.")] : [])],
    };
    if (decision === "approve" || decision === "partial") {
      effective.forEach((line, i) => {
        if (line.decision === "approved") {
          spec[`rv_approved_quantity_${i}`] = [line.approved_quantity, rules.required("Enter the approved quantity."), rules.quantity()];
          spec[`rv_approved_unit_price_${i}`] = [line.approved_unit_price, rules.money()];
        } else {
          spec[`rv_comment_${i}`] = [line.comment || comment, rules.required("Give a reason for holding or rejecting this line, or add a comment below.")];
        }
      });
    }
    return validate(spec);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!fields.check(validateReview(), formRef.current)) return;
    run(
      () =>
        reviewRequisition(props.requisitionId, {
          decision,
          comment,
          cost_center_id: costCenter || null,
          expense_category_id: expenseCategory || null,
          items: decision === "hold" || decision === "reject" ? [] : effective,
        }),
      { errorMessage: "Unable to save the review decision. Please try again.", onSuccess: () => setOpen(false) },
    );
  }

  const showLines = decision === "approve" || decision === "partial";

  return (
    <>
      <Button variant="gold" onClick={() => setOpen(true)}>
        <ClipboardCheck className="size-4" aria-hidden /> Review
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Finance review" description="Decide on the request and each line. The decision is saved when you submit this review. If requester notifications are configured, the requester may receive an update." wide>
        <form ref={formRef} onSubmit={submit} className="space-y-5" noValidate>
          {error ? <Alert tone="error">{error}</Alert> : null}
          <RequiredNote />
          <fieldset role="radiogroup" aria-required="true">
            <legend className="mb-2 text-sm font-medium">Decision<RequiredMark /></legend>
            <div className="grid gap-2 sm:grid-cols-4">
              {DECISIONS.map((d) => (
                <label key={d.key} className={cn("cursor-pointer rounded-2xl border p-3 text-sm", decision === d.key ? "border-navy bg-navy text-white" : "border-navy/15 hover:border-navy/30")}>
                  <input type="radio" name="decision" value={d.key} checked={decision === d.key} onChange={() => { setDecision(d.key); fields.setErrors({}); }} className="sr-only" />
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
                      <p className="flex flex-wrap items-center gap-2 font-medium"><PriorityBadge priority={item.priority} size="sm" />{item.line}. {item.description}</p>
                      <p className="tabular text-sm text-navy/60">Requested {item.quantity.replace(/\.00$/, "")} × {formatCents(parseMoney(item.estimatedUnitPrice) ?? 0n, props.currency)}</p>
                    </div>
                    <EssentialReason reason={item.priority === "essential" ? item.essentialJustification : null} />
                    <div className="mt-2 grid items-start gap-2 sm:grid-cols-[10rem_7rem_9rem_1fr]">
                      <Field label={<>Decision <span className="sr-only">for line {item.line}</span></>} htmlFor={`rv_decision_${index}`}>
                        <Select value={line.decision} disabled={decision === "approve"}
                          onChange={(e) => update(index, { decision: e.target.value as LineDecision })}>
                          <option value="approved">Approve</option>
                          <option value="held">Hold</option>
                          <option value="rejected">Reject</option>
                        </Select>
                      </Field>
                      <Field label={<>Approved qty <span className="sr-only">for line {item.line}</span></>} htmlFor={`rv_approved_quantity_${index}`} required={line.decision === "approved"} error={fields.errors[`rv_approved_quantity_${index}`]}>
                        <Input inputMode="decimal" className="tabular" value={line.approved_quantity}
                          disabled={line.decision !== "approved"} onChange={(e) => update(index, { approved_quantity: e.target.value })} />
                      </Field>
                      <Field label={<>Unit price <span className="sr-only">for line {item.line}</span></>} htmlFor={`rv_approved_unit_price_${index}`} error={fields.errors[`rv_approved_unit_price_${index}`]}>
                        <Input inputMode="decimal" className="tabular" value={line.approved_unit_price}
                          disabled={line.decision !== "approved"} onChange={(e) => update(index, { approved_unit_price: e.target.value })} />
                      </Field>
                      <Field label={<>{needsComment ? "Reason" : "Comment (optional)"} <span className="sr-only">for line {item.line}</span></>} htmlFor={`rv_comment_${index}`} required={needsComment && !comment.trim()} error={fields.errors[`rv_comment_${index}`]}>
                        <Input value={line.comment} maxLength={1000} onChange={(e) => update(index, { comment: e.target.value })} />
                      </Field>
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

          <Field label={commentRequired ? "Comment for the requester" : "Comment for the requester (optional)"} htmlFor="review_comment" required={commentRequired} error={fields.errors.review_comment}>
            <Textarea rows={3} value={comment} onChange={(e) => { setComment(e.target.value); fields.clear("review_comment"); }} maxLength={2000} />
          </Field>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-navy/10 pt-4">
            <p className="text-sm">Approved total <span className="tabular ml-2 font-serif text-2xl">{formatCents(approvedTotal, props.currency)}</span></p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <LoadingButton type="submit" pending={pending} pendingLabel="Saving…">Save decision</LoadingButton>
            </div>
          </div>
        </form>
      </Dialog>
    </>
  );
}
