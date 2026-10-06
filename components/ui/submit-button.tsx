"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "./button";

/** Submit button for forms using a React form action (reads useFormStatus). */
export function SubmitButton({ children, pendingLabel = "Saving…", ...props }: ButtonProps & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <LoadingButton type="submit" pending={pending} pendingLabel={pendingLabel} {...props}>
      {children}
    </LoadingButton>
  );
}

/**
 * Button with a loading state: shows a spinner and pending label, is disabled
 * and aria-busy while `pending`, and is restored automatically afterwards.
 */
export function LoadingButton({
  children,
  pending = false,
  pendingLabel,
  icon,
  disabled,
  ...props
}: ButtonProps & { pending?: boolean; pendingLabel?: string; icon?: React.ReactNode }) {
  return (
    <Button disabled={pending || disabled} aria-busy={pending || undefined} aria-disabled={pending || disabled || undefined} {...props}>
      {pending ? <Spinner /> : icon}
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}

export function Spinner({ className = "size-4" }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
