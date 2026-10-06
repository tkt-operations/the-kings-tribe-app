"use client";

import { Alert } from "@/components/ui/alert";
import { Field, Input, RequiredNote } from "@/components/ui/field";
import { LoadingButton } from "@/components/ui/submit-button";
import { useServerForm } from "@/components/ui/use-server-form";
import { rules, validate } from "@/lib/validation/form";
import { createFirstAdministrator } from "./actions";

export function validateSetup(fd: FormData) {
  const get = (k: string) => String(fd.get(k) ?? "");
  return validate({
    setup_token: [get("setup_token"), rules.required("Setup token is required.")],
    full_name: [get("full_name"), rules.required("Full name is required."), rules.minLength(2, "Enter your full name.")],
    email: [get("email"), rules.required("Email address is required."), rules.email()],
    password: [get("password"), rules.required("Password is required."), rules.minLength(12, "Use at least 12 characters.")],
    confirm: [get("confirm"), rules.required("Confirm your password."), rules.matches(get("password"), "Passwords do not match.")],
  });
}

export function SetupForm() {
  const { formRef, onSubmit, pending, state, errors, clearError } = useServerForm(createFirstAdministrator, {
    validate: validateSetup,
    errorMessage: "Unable to create the administrator. Please try again.",
  });
  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-5" noValidate>
      {state?.error ? <Alert tone="error" title="The administrator was not created">{state.error}</Alert> : null}
      <RequiredNote />
      <Field label="Setup token" htmlFor="setup_token" required error={errors.setup_token} hint="The SETUP_TOKEN value from your server environment variables.">
        <Input id="setup_token" name="setup_token" type="password" autoComplete="off" onChange={() => clearError("setup_token")} />
      </Field>
      <Field label="Your full name" htmlFor="full_name" required error={errors.full_name}>
        <Input id="full_name" name="full_name" autoComplete="name" maxLength={120} onChange={() => clearError("full_name")} />
      </Field>
      <Field label="Your email address" htmlFor="email" required error={errors.email}>
        <Input id="email" name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" onChange={() => clearError("email")} />
      </Field>
      <Field label="Password" htmlFor="password" required error={errors.password} hint="At least 12 characters.">
        <Input id="password" name="password" type="password" autoComplete="new-password" onChange={() => clearError("password")} />
      </Field>
      <Field label="Confirm password" htmlFor="confirm" required error={errors.confirm}>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" onChange={() => clearError("confirm")} />
      </Field>
      <LoadingButton type="submit" size="lg" className="w-full" pending={pending} pendingLabel="Creating administrator…">
        Create administrator
      </LoadingButton>
    </form>
  );
}
