"use client";

import { Alert } from "@/components/ui/alert";
import { Field, Input, RequiredNote } from "@/components/ui/field";
import { LoadingButton } from "@/components/ui/submit-button";
import { useServerForm } from "@/components/ui/use-server-form";
import { rules, validate } from "@/lib/validation/form";
import { requestPasswordReset } from "../login/actions";

export function ForgotForm() {
  const { formRef, onSubmit, pending, state, errors, clearError } = useServerForm(requestPasswordReset, {
    validate: (fd) => validate({ email: [String(fd.get("email") ?? ""), rules.required("Email address is required."), rules.email()] }),
    errorMessage: "Unable to send the reset link. Please try again.",
  });
  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-5" noValidate>
      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state?.message ? <Alert tone="success">{state.message}</Alert> : null}
      <RequiredNote />
      <Field label="Email address" htmlFor="email" required error={errors.email}>
        <Input id="email" name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" onChange={() => clearError("email")} />
      </Field>
      <LoadingButton type="submit" size="lg" className="w-full" pending={pending} pendingLabel="Sending…">Send reset link</LoadingButton>
    </form>
  );
}
