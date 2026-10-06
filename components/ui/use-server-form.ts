"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { useFieldErrors } from "@/components/ui/form-feedback";
import { useToast } from "@/components/ui/toast";
import { GENERIC_ERROR, isNavigationSignal } from "@/components/ui/use-action";
import type { FieldErrors } from "@/lib/validation/form";

export type ServerFormState = { error?: string; message?: string; fieldErrors?: FieldErrors } | undefined;

/**
 * For server actions shaped `(prevState, formData) => state` (sign in, setup,
 * password forms). Unlike `<form action>`, this never resets the form, so a
 * failed submission keeps everything the person typed. It validates on the
 * client first, blocks duplicate submits, and toasts success/failure.
 * A redirect() from the action proceeds as normal navigation.
 */
export function useServerForm<S extends ServerFormState>(
  action: (prev: S, formData: FormData) => Promise<S>,
  options: { validate?: (formData: FormData) => FieldErrors; errorMessage?: string } = {},
) {
  const formRef = useRef<HTMLFormElement>(null);
  const toast = useToast();
  const fields = useFieldErrors();
  const [state, setState] = useState<S | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const [transitionPending, startTransition] = useTransition();
  const inFlight = useRef(false);
  const { validate, errorMessage } = options;

  const onSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (inFlight.current) return;
      const form = event.currentTarget;
      const formData = new FormData(form);
      if (validate && !fields.check(validate(formData), form)) {
        setState(undefined);
        return;
      }
      inFlight.current = true;
      setRunning(true);
      startTransition(async () => {
        try {
          const next = await action(state as S, formData);
          setState(next);
          if (next?.error) {
            toast.error(next.error);
            fields.show(next.fieldErrors, form);
          } else if (next?.message) {
            toast.success(next.message);
          }
        } catch (err) {
          if (isNavigationSignal(err)) throw err;
          console.error(err);
          const text = errorMessage ?? GENERIC_ERROR;
          setState({ error: text } as S);
          toast.error(text);
        } finally {
          inFlight.current = false;
          setRunning(false);
        }
      });
    },
    [action, state, validate, errorMessage, fields, toast],
  );

  return {
    formRef,
    onSubmit,
    pending: running || transitionPending,
    state,
    errors: fields.errors,
    clearError: fields.clear,
  };
}
