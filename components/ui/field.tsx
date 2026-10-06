"use client";

import { createContext, forwardRef, useContext } from "react";
import { cn } from "@/lib/cn";

const control =
  "block w-full rounded-xl border border-navy/15 bg-white px-3.5 text-navy placeholder:text-navy/40 " +
  "shadow-[0_1px_0_rgba(18,23,45,0.04)] transition-colors focus:border-navy/40 focus:outline-none " +
  "focus:ring-4 focus:ring-gold/30 disabled:bg-neutral-gray disabled:text-navy/50 " +
  "aria-[invalid=true]:border-2 aria-[invalid=true]:border-energy-orange";

/**
 * A <Field> tells the control inside it its id, whether it is required or
 * invalid, and which hint/error describes it — so every form gets correct
 * aria-required / aria-invalid / aria-describedby without repeating them.
 */
interface FieldContextValue {
  id: string;
  required: boolean;
  invalid: boolean;
  describedBy?: string;
}

const FieldContext = createContext<FieldContextValue | null>(null);

type AriaProps = {
  id?: string;
  "aria-required"?: React.AriaAttributes["aria-required"];
  "aria-invalid"?: React.AriaAttributes["aria-invalid"];
  "aria-describedby"?: string;
};

function useFieldProps<P extends AriaProps>(props: P): P {
  const ctx = useContext(FieldContext);
  if (!ctx) return props;
  const describedBy = [props["aria-describedby"], ctx.describedBy].filter(Boolean).join(" ") || undefined;
  return {
    ...props,
    id: props.id ?? ctx.id,
    "aria-required": props["aria-required"] ?? (ctx.required ? true : undefined),
    "aria-invalid": props["aria-invalid"] || (ctx.invalid ? true : undefined),
    "aria-describedby": describedBy,
  };
}

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  const merged = useFieldProps(props);
  return <input ref={ref} className={cn(control, "h-12", className)} {...merged} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, rows = 4, ...props }, ref) {
    const merged = useFieldProps(props);
    return <textarea ref={ref} rows={rows} className={cn(control, "py-3 leading-relaxed", className)} {...merged} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  const merged = useFieldProps(props);
  return (
    <select
      ref={ref}
      className={cn(
        control,
        "h-12 appearance-none bg-[length:1.1rem] bg-[right_0.85rem_center] bg-no-repeat pr-10",
        "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2312172d' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")]",
        className,
      )}
      {...merged}
    >
      {children}
    </select>
  );
});

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1.5 block text-sm font-medium text-navy", className)} {...props} />;
}

/**
 * The required marker. Hidden from screen readers because the control itself
 * carries aria-required; sighted users get the glyph, not just a colour.
 */
export function RequiredMark() {
  return (
    <span aria-hidden className="ml-0.5 font-bold text-energy-orange">
      *
    </span>
  );
}

/** "* Required fields" — place near the top of any form with required fields. */
export function RequiredNote({ className }: { className?: string }) {
  return (
    <p className={cn("text-sm text-navy/65", className)}>
      <span className="mr-1 font-bold text-energy-orange">*</span>Required fields
    </p>
  );
}

export function FieldHint({ children, className, id }: { children: React.ReactNode; className?: string; id?: string }) {
  return (
    <p id={id} className={cn("mt-1.5 text-[13px] text-navy/60", className)}>
      {children}
    </p>
  );
}

/**
 * Inline error under a control. Not a live region by default: the first
 * invalid control is focused and reads its error via aria-describedby. Pass
 * `live` for errors that appear without a focus change (e.g. a rejected file).
 */
export function FieldError({ message, id, live = false, className }: { message?: string | null; id?: string; live?: boolean; className?: string }) {
  if (!message) return null;
  return (
    <p id={id} role={live ? "alert" : undefined} className={cn("mt-1.5 flex items-start gap-1.5 text-[13px] font-medium text-navy", className)}>
      <span aria-hidden className="mt-1.5 inline-block size-2 shrink-0 rounded-full bg-energy-orange" />
      {message}
    </p>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required = false,
  children,
  className,
}: {
  label: React.ReactNode;
  htmlFor: string;
  hint?: React.ReactNode;
  error?: string | null;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const errorId = `${htmlFor}-error`;
  const hintId = `${htmlFor}-hint`;
  const describedBy = error ? errorId : hint ? hintId : undefined;
  return (
    <div className={className}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <RequiredMark /> : null}
      </Label>
      <FieldContext.Provider value={{ id: htmlFor, required, invalid: Boolean(error), describedBy }}>{children}</FieldContext.Provider>
      {error ? <FieldError message={error} id={errorId} /> : hint ? <FieldHint id={hintId}>{hint}</FieldHint> : null}
    </div>
  );
}

export function Checkbox({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="checkbox"
      className={cn("size-5 shrink-0 rounded-md border-navy/30 accent-navy", className)}
      {...props}
    />
  );
}
