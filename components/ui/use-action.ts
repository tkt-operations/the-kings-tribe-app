"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState, useTransition } from "react";
import { useToast } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/action-result";
import type { FieldErrors } from "@/lib/validation/form";

export const GENERIC_ERROR = "Unable to save changes. Please try again.";
export const GENERIC_SUCCESS = "Changes saved successfully.";

/** Next.js signals redirect()/notFound() from a server action by rejecting with these. */
export function isNavigationSignal(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK") || digest === "NEXT_NOT_FOUND");
}

export interface RunOptions<T> {
  onSuccess?: (data: T) => void;
  onError?: (error: string, fieldErrors?: FieldErrors) => void;
  /** Toast text when the server doesn't supply a message. */
  successMessage?: string | ((data: T) => string);
  /** Toast text for unexpected failures (network, crash). Server messages are already safe. */
  errorMessage?: string;
  /** Set false for silent background actions. Default true. */
  toast?: boolean;
  /** router.refresh() after success. Default true. */
  refresh?: boolean;
}

/**
 * Run a server action with consistent feedback:
 *  - ignores re-entry while a request is in flight (double clicks, double Enter)
 *  - exposes `pending` for spinners/disabled buttons
 *  - success → toast; failure → toast + `error` (form-level) + `fieldErrors`
 *  - refreshes the route on success
 */
export function useAction() {
  const router = useRouter();
  const toast = useToast();
  const [transitionPending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);

  const run = useCallback(
    <T,>(fn: () => Promise<ActionResult<T>>, options?: RunOptions<T> | ((data: T) => void)): boolean => {
      if (inFlight.current) return false;
      const opts: RunOptions<T> = typeof options === "function" ? { onSuccess: options } : (options ?? {});
      const showToast = opts.toast !== false;
      inFlight.current = true;
      setRunning(true);
      setError(null);
      setFieldErrors({});
      setMessage(null);
      startTransition(async () => {
        try {
          const result = await fn();
          if (result.ok) {
            const fallback = typeof opts.successMessage === "function" ? opts.successMessage(result.data) : opts.successMessage;
            const text = result.message ?? fallback ?? GENERIC_SUCCESS;
            setMessage(text);
            if (showToast) toast.success(text);
            opts.onSuccess?.(result.data);
            if (opts.refresh !== false) router.refresh();
          } else {
            setError(result.error);
            setFieldErrors(result.fieldErrors ?? {});
            if (showToast) toast.error(result.error);
            opts.onError?.(result.error, result.fieldErrors);
          }
        } catch (err) {
          if (isNavigationSignal(err)) throw err;
          console.error(err);
          const text = opts.errorMessage ?? GENERIC_ERROR;
          setError(text);
          if (showToast) toast.error(text);
          opts.onError?.(text);
        } finally {
          inFlight.current = false;
          setRunning(false);
        }
      });
      return true;
    },
    [router, toast],
  );

  return { pending: running || transitionPending, error, fieldErrors, message, run, setError, setFieldErrors };
}
