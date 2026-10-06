"use client";

import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/field";
import { updatePreferences } from "./actions";

export function PreferencesForm({ token, email, sms }: { token: string; email: boolean; sms: boolean }) {
  const [e, setE] = useState(email);
  const [s, setS] = useState(sms);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form className="space-y-4" onSubmit={(ev) => { ev.preventDefault(); start(async () => { const r = await updatePreferences(token, e, s); setResult(r.ok ? { ok: true, text: r.message ?? "Saved." } : { ok: false, text: r.error }); }); }}>
      {result ? <Alert tone={result.ok ? "success" : "error"}>{result.text}</Alert> : null}
      <label className="flex gap-3"><Checkbox checked={e} onChange={(x) => setE(x.target.checked)} />Email me status updates for this request</label>
      <label className="flex gap-3"><Checkbox checked={s} onChange={(x) => setS(x.target.checked)} />Text me status updates (message and data rates may apply)</label>
      <Button type="submit" disabled={pending}>Save preferences</Button>
    </form>
  );
}
