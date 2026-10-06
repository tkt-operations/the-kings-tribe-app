"use client";

import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Field, Input, RequiredNote } from "@/components/ui/field";
import { LoadingButton } from "@/components/ui/submit-button";
import { useServerForm } from "@/components/ui/use-server-form";
import { rules, validate } from "@/lib/validation/form";
import { signIn } from "./actions";

export function validateSignIn(fd: FormData) {
  return validate({
    email: [String(fd.get("email") ?? ""), rules.required("Email address is required."), rules.email()],
    password: [String(fd.get("password") ?? ""), rules.required("Password is required.")],
  });
}

export function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const { formRef, onSubmit, pending, state, errors, clearError } = useServerForm(signIn, { validate: validateSignIn, errorMessage: "Sign in failed. Please try again." });
  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-5" noValidate>
      {notice ? <Alert tone="info">{notice}</Alert> : null}
      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}
      <RequiredNote />
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Email address" htmlFor="email" required error={errors.email}>
        <Input id="email" name="email" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false} onChange={() => clearError("email")} />
      </Field>
      <Field label="Password" htmlFor="password" required error={errors.password}>
        <Input id="password" name="password" type="password" autoComplete="current-password" onChange={() => clearError("password")} />
      </Field>
      <LoadingButton type="submit" size="lg" className="w-full" pending={pending} pendingLabel="Signing in…">
        Sign in
      </LoadingButton>
      <p className="text-center text-sm">
        <Link href="/forgot-password" className="font-medium text-navy underline decoration-gold decoration-2 underline-offset-4">
          Forgot your password?
        </Link>
      </p>
    </form>
  );
}
