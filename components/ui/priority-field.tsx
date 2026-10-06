"use client";

import { AlertTriangle, ArrowDown, ArrowUp, Minus } from "lucide-react";
import { FieldError, RequiredMark } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { PRIORITIES, PRIORITY_DESCRIPTIONS, PRIORITY_LABELS, type Priority } from "@/lib/priority";

const icons = { essential: AlertTriangle, high: ArrowUp, medium: Minus, low: ArrowDown } as const;

const selectedStyles: Record<Priority, string> = {
  essential: "border-energy-orange bg-energy-orange text-navy ring-2 ring-energy-orange/40",
  high: "border-gold bg-gold/30 text-navy ring-2 ring-gold/50",
  medium: "border-navy bg-navy text-gold",
  low: "border-navy/50 bg-navy/[0.06] text-navy",
};

/**
 * Required priority selector: four large radio "chips" (2×2 on phones, one row
 * on wider screens) with the selected level's meaning shown underneath and
 * all definitions one tap away. `inputProps` wires each radio to a form
 * library (react-hook-form register) or to controlled state.
 */
export function PriorityField({
  id,
  legend = "Priority",
  value,
  error,
  inputProps,
  className,
}: {
  id: string;
  legend?: React.ReactNode;
  value: Priority | undefined;
  error?: string;
  inputProps: (priority: Priority) => React.InputHTMLAttributes<HTMLInputElement>;
  className?: string;
}) {
  const errorId = `${id}-error`;
  const helpId = `${id}-help`;
  return (
    <fieldset
      id={id}
      role="radiogroup"
      aria-required="true"
      aria-invalid={error ? true : undefined}
      aria-describedby={[error ? errorId : null, helpId].filter(Boolean).join(" ")}
      className={className}
    >
      <legend className="mb-1.5 text-sm font-medium text-navy">
        {legend}
        <RequiredMark />
      </legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {PRIORITIES.map((p) => {
          const Icon = icons[p];
          const selected = value === p;
          return (
            <label
              key={p}
              className={cn(
                "flex min-h-12 cursor-pointer items-center justify-center gap-1.5 rounded-xl border px-2 text-[15px] font-bold transition-colors",
                "has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-gold",
                selected ? selectedStyles[p] : "border-navy/15 bg-white text-navy hover:border-navy/35",
                error && !selected && "border-energy-orange/60",
              )}
            >
              <input type="radio" className="sr-only" {...inputProps(p)} />
              <Icon className="size-4" aria-hidden strokeWidth={2.5} />
              {PRIORITY_LABELS[p]}
            </label>
          );
        })}
      </div>
      <FieldError id={errorId} message={error} />
      <div id={helpId} className="mt-1.5 text-[13px] text-navy/65">
        {value ? <p><strong className="text-navy">{PRIORITY_LABELS[value]}:</strong> {PRIORITY_DESCRIPTIONS[value]}</p> : null}
        <details className="mt-1">
          <summary className="cursor-pointer font-medium text-navy/75 underline decoration-gold decoration-2 underline-offset-4">What do the priorities mean?</summary>
          <dl className="mt-2 space-y-1.5">
            {PRIORITIES.map((p) => (
              <div key={p}>
                <dt className="inline font-bold text-navy">{PRIORITY_LABELS[p]}: </dt>
                <dd className="inline">{PRIORITY_DESCRIPTIONS[p]}</dd>
              </div>
            ))}
          </dl>
        </details>
      </div>
    </fieldset>
  );
}
