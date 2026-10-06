"use client";

import { useCallback, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { hasErrors, type FieldErrors } from "@/lib/validation/form";

export const REVIEW_FIELDS_MESSAGE = "Please review the highlighted fields and try again.";

/**
 * Move focus to the first control marked aria-invalid inside `root`, in
 * document order, and bring it into view. Call after the errors render.
 * Groups that can't carry aria-invalid (role="group") use data-invalid.
 */
export function focusFirstInvalid(root: ParentNode | null | undefined = typeof document === "undefined" ? null : document) {
  if (!root) return;
  const candidates = root.querySelectorAll<HTMLElement>('[aria-invalid="true"], [data-invalid="true"]');
  for (const el of Array.from(candidates)) {
    // A group (e.g. a radiogroup fieldset) is marked invalid as a whole; focus the control inside it.
    const target = el.matches("input, select, textarea, button, [tabindex]")
      ? el
      : el.querySelector<HTMLElement>("input:checked:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)");
    if (!target || (target as HTMLInputElement).disabled) continue;
    el.scrollIntoView?.({ behavior: "smooth", block: "center" });
    target.focus({ preventScroll: true });
    return;
  }
}

/** After a render: focus the first invalid control. */
export function focusFirstInvalidSoon(root?: ParentNode | null) {
  const run = () => focusFirstInvalid(root ?? document);
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => setTimeout(run, 0));
  else setTimeout(run, 0);
}

/**
 * Inline field errors for hand-built forms.
 *
 *   const v = useFieldErrors();
 *   if (!v.check(validate({...}), formRef.current)) return; // shows errors, focuses the first
 *   <Field error={v.errors.email}> … onChange={() => v.clear("email")}
 */
export function useFieldErrors(initial: FieldErrors = {}) {
  const toast = useToast();
  const [errors, setErrors] = useState<FieldErrors>(initial);

  const clear = useCallback((field: string) => {
    setErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  /** Returns true when valid. Otherwise renders the errors, toasts once, and focuses the first. */
  const check = useCallback(
    (next: FieldErrors, root?: ParentNode | null, { announce = true }: { announce?: boolean } = {}) => {
      setErrors(next);
      if (!hasErrors(next)) return true;
      if (announce) toast.error(REVIEW_FIELDS_MESSAGE);
      focusFirstInvalidSoon(root);
      return false;
    },
    [toast],
  );

  /** Show server-side field errors (e.g. from ActionResult.fieldErrors). */
  const show = useCallback((next: FieldErrors | undefined, root?: ParentNode | null) => {
    if (!next || !hasErrors(next)) return;
    setErrors(next);
    focusFirstInvalidSoon(root);
  }, []);

  return { errors, setErrors, clear, check, show };
}
