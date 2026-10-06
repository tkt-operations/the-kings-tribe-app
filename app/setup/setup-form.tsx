"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { createFirstAdministrator } from "./actions";

export function SetupForm() {
  const [state, action] = useActionState(createFirstAdministrator, undefined);
  return (
    <form action={action} className="space-y-5" noValidate>
      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}
      <Field label="Setup token" htmlFor="setup_token" hint="The SETUP_TOKEN value from your server environment variables.">
        <Input id="setup_token" name="setup_token" type="password" autoComplete="off" required />
      </Field>
      <Field label="Your full name" htmlFor="full_name">
        <Input id="full_name" name="full_name" autoComplete="name" required />
      </Field>
      <Field label="Your email" htmlFor="email">
        <Input id="email" name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" required />
      </Field>
      <Field label="Password" htmlFor="password" hint="At least 12 characters.">
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required />
      </Field>
      <Field label="Confirm password" htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={12} required />
      </Field>
      <SubmitButton size="lg" className="w-full" pendingLabel="Creating administrator…">
        Create administrator
      </SubmitButton>
    </form>
  );
}
