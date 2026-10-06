"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/field";
import { LoadingButton } from "@/components/ui/submit-button";
import { useAction } from "@/components/ui/use-action";
import { updatePreferences } from "./actions";

export function PreferencesForm({ token, email, sms }: { token: string; email: boolean; sms: boolean }) {
  const [e, setE] = useState(email);
  const [s, setS] = useState(sms);
  const { pending, error, message, run } = useAction();
  return (
    <form
      className="space-y-4"
      onSubmit={(ev) => {
        ev.preventDefault();
        run(() => updatePreferences(token, e, s), { successMessage: "Your preferences were saved successfully.", errorMessage: "Unable to save your preferences. Please try again.", refresh: false });
      }}
    >
      {error ? <Alert tone="error">{error}</Alert> : message ? <Alert tone="success">{message}</Alert> : null}
      <label className="flex gap-3"><Checkbox checked={e} onChange={(x) => setE(x.target.checked)} />Email me status updates for this request</label>
      <label className="flex gap-3"><Checkbox checked={s} onChange={(x) => setS(x.target.checked)} />Text me status updates (message and data rates may apply)</label>
      <LoadingButton type="submit" pending={pending} pendingLabel="Saving…">Save preferences</LoadingButton>
    </form>
  );
}
