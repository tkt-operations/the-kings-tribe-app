"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { updatePassword } from "./actions";

export function UpdatePasswordForm({ defaultName }: { defaultName: string }) {
  const [state, action] = useActionState(updatePassword, undefined);
  return (
    <form action={action} className="space-y-5" noValidate>
      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}
      <Field label="Your full name" htmlFor="full_name">
        <Input id="full_name" name="full_name" autoComplete="name" defaultValue={defaultName} />
      </Field>
      <Field label="New password" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required />
      </Field>
      <Field label="Confirm password" htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={12} required />
      </Field>
      <SubmitButton size="lg" className="w-full" pendingLabel="Saving…">Save password</SubmitButton>
    </form>
  );
}
