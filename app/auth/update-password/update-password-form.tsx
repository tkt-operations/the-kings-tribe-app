"use client";

import { Alert } from "@/components/ui/alert";
import { Field, Input, RequiredNote } from "@/components/ui/field";
import { LoadingButton } from "@/components/ui/submit-button";
import { useServerForm } from "@/components/ui/use-server-form";
import { rules, validate } from "@/lib/validation/form";
import { updatePassword } from "./actions";

export function validateNewPassword(fd: FormData) {
  const password = String(fd.get("password") ?? "");
  return validate({
    password: [password, rules.required("Password is required."), rules.minLength(12, "Use at least 12 characters.")],
    confirm: [String(fd.get("confirm") ?? ""), rules.required("Confirm your password."), rules.matches(password, "Passwords do not match.")],
  });
}

export function UpdatePasswordForm({ defaultName }: { defaultName: string }) {
  const { formRef, onSubmit, pending, state, errors, clearError } = useServerForm(updatePassword, {
    validate: validateNewPassword,
    errorMessage: "Unable to update your password. Please try again.",
  });
  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-5" noValidate>
      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}
      <RequiredNote />
      <Field label="Your full name" htmlFor="full_name" error={errors.full_name}>
        <Input id="full_name" name="full_name" autoComplete="name" defaultValue={defaultName} maxLength={120} />
      </Field>
      <Field label="New password" htmlFor="password" required error={errors.password} hint="At least 12 characters.">
        <Input id="password" name="password" type="password" autoComplete="new-password" onChange={() => clearError("password")} />
      </Field>
      <Field label="Confirm password" htmlFor="confirm" required error={errors.confirm}>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" onChange={() => clearError("confirm")} />
      </Field>
      <LoadingButton type="submit" size="lg" className="w-full" pending={pending} pendingLabel="Saving…">Save password</LoadingButton>
    </form>
  );
}
