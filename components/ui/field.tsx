import { forwardRef } from "react";
import { cn } from "@/lib/cn";

const control =
  "block w-full rounded-xl border border-navy/15 bg-white px-3.5 text-navy placeholder:text-navy/40 " +
  "shadow-[0_1px_0_rgba(18,23,45,0.04)] transition-colors focus:border-navy/40 focus:outline-none " +
  "focus:ring-4 focus:ring-gold/30 disabled:bg-neutral-gray disabled:text-navy/50 aria-[invalid=true]:border-energy-orange";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(control, "h-12", className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, rows = 4, ...props }, ref) {
    return <textarea ref={ref} rows={rows} className={cn(control, "py-3 leading-relaxed", className)} {...props} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <select
      ref={ref}
      className={cn(
        control,
        "h-12 appearance-none bg-[length:1.1rem] bg-[right_0.85rem_center] bg-no-repeat pr-10",
        "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2312172d' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")]",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
});

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1.5 block text-sm font-medium text-navy", className)} {...props} />;
}

export function FieldHint({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("mt-1.5 text-[13px] text-navy/60", className)}>{children}</p>;
}

export function FieldError({ message, id }: { message?: string; id?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1.5 flex items-start gap-1.5 text-[13px] font-medium text-navy">
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
  required,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  hint?: React.ReactNode;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <span className="ml-0.5 text-navy/50" aria-hidden>*</span> : null}
      </Label>
      {children}
      {error ? <FieldError message={error} id={`${htmlFor}-error`} /> : hint ? <FieldHint>{hint}</FieldHint> : null}
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
