"use client";

import { useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, RequiredNote, Select, Textarea } from "@/components/ui/field";
import { useFieldErrors } from "@/components/ui/form-feedback";
import { LoadingButton } from "@/components/ui/submit-button";
import { useAction } from "@/components/ui/use-action";
import { issuesToFieldErrors } from "@/lib/action-result";
import type { ChurchSettings } from "@/lib/data/settings";
import { settingsSchema } from "@/lib/validation/settings";
import { saveSettings } from "./actions";

type Section = "church" | "money" | "notifications" | "policy";

const SECTION_FIELDS: Record<Section, string[]> = {
  church: ["church_name", "address_line1", "address_line2", "city", "region", "postal_code", "country", "phone", "email", "website"],
  money: ["currency_code", "timezone"],
  notifications: ["finance_notification_email"],
  policy: ["requisition_policy", "po_instructions", "po_footer"],
};

const CURRENCIES = ["USD", "CAD", "GBP", "EUR", "NGN", "GHS", "KES", "ZAR", "AUD", "NZD"];

export function SettingsForm({ settings, timezones, sections = ["church", "money", "notifications", "policy"] }: {
  settings: ChurchSettings;
  timezones: string[];
  sections?: Section[];
}) {
  const [v, setV] = useState({
    church_name: settings.church_name ?? "",
    address_line1: settings.address_line1 ?? "",
    address_line2: settings.address_line2 ?? "",
    city: settings.city ?? "",
    region: settings.region ?? "",
    postal_code: settings.postal_code ?? "",
    country: settings.country ?? "",
    phone: settings.phone ?? "",
    email: settings.email ?? "",
    website: settings.website ?? "",
    currency_code: settings.currency_code ?? "USD",
    timezone: settings.timezone ?? "America/New_York",
    finance_notification_email: settings.finance_notification_email ?? "",
    requisition_policy: settings.requisition_policy ?? "",
    po_instructions: settings.po_instructions ?? "",
    po_footer: settings.po_footer ?? "",
  });
  const formRef = useRef<HTMLFormElement>(null);
  const fields = useFieldErrors();
  const [hiddenError, setHiddenError] = useState<string | null>(null);
  const { pending, error, run } = useAction();
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setV({ ...v, [k]: e.target.value });
    fields.clear(k);
  };
  const err = (k: string) => fields.errors[k];
  const visible = new Set(sections.flatMap((s) => SECTION_FIELDS[s]));

  /** Errors for fields on this screen go inline; others (another wizard step) become a form-level message. */
  function showErrors(all: Record<string, string>) {
    const inline = Object.fromEntries(Object.entries(all).filter(([k]) => visible.has(k)));
    const elsewhere = Object.entries(all).filter(([k]) => !visible.has(k));
    setHiddenError(elsewhere.length ? `Another settings section needs attention: ${elsewhere[0][1]}` : null);
    return inline;
  }

  return (
    <form
      className="space-y-6"
      ref={formRef}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const parsed = settingsSchema.safeParse(v);
        if (!parsed.success) {
          const all = issuesToFieldErrors(parsed.error.issues);
          const inline = showErrors(all);
          if (Object.keys(inline).length) fields.check(inline, formRef.current);
          return;
        }
        setHiddenError(null);
        run(() => saveSettings(v), {
          successMessage: "Settings saved successfully.",
          onError: (_e, fe) => fields.show(fe ? showErrors(fe) : undefined, formRef.current),
        });
      }}
    >
      {error ? <Alert tone="error">{error}</Alert> : null}
      {hiddenError ? <Alert tone="error">{hiddenError}</Alert> : null}
      <RequiredNote />

      {sections.includes("church") ? (
        <Card>
          <CardHeader title="Church information" description="Shown on the requisition form, emails and Purchase Orders." />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field className="sm:col-span-2" label="Church name" htmlFor="church_name" required error={err("church_name")}><Input id="church_name" value={v.church_name} onChange={set("church_name")} /></Field>
            <Field label="Address line 1" htmlFor="address_line1" error={err("address_line1")}><Input id="address_line1" autoComplete="address-line1" value={v.address_line1} onChange={set("address_line1")} /></Field>
            <Field label="Address line 2" htmlFor="address_line2"><Input id="address_line2" autoComplete="address-line2" value={v.address_line2} onChange={set("address_line2")} /></Field>
            <Field label="City" htmlFor="city"><Input id="city" value={v.city} onChange={set("city")} /></Field>
            <Field label="State / region" htmlFor="region"><Input id="region" value={v.region} onChange={set("region")} /></Field>
            <Field label="Postal code" htmlFor="postal_code"><Input id="postal_code" value={v.postal_code} onChange={set("postal_code")} /></Field>
            <Field label="Country" htmlFor="country"><Input id="country" value={v.country} onChange={set("country")} /></Field>
            <Field label="Phone" htmlFor="phone"><Input id="phone" type="tel" inputMode="tel" value={v.phone} onChange={set("phone")} /></Field>
            <Field label="Email" htmlFor="email" error={err("email")}><Input id="email" type="email" inputMode="email" value={v.email} onChange={set("email")} /></Field>
            <Field className="sm:col-span-2" label="Website" htmlFor="website" error={err("website")}><Input id="website" type="url" inputMode="url" value={v.website} onChange={set("website")} placeholder="https://" /></Field>
          </CardBody>
        </Card>
      ) : null}

      {sections.includes("money") ? (
        <Card>
          <CardHeader title="Currency & timezone" description="The timezone decides what “today” and “this Sunday” mean." />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Currency" htmlFor="currency_code" required error={err("currency_code")}>
              <Select id="currency_code" value={v.currency_code} onChange={set("currency_code")}>
                {[...new Set([v.currency_code, ...CURRENCIES])].map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label="Timezone" htmlFor="timezone" required error={err("timezone")}>
              <Select id="timezone" value={v.timezone} onChange={set("timezone")}>
                {timezones.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
              </Select>
            </Field>
          </CardBody>
        </Card>
      ) : null}

      {sections.includes("notifications") ? (
        <Card>
          <CardHeader title="Notifications" description="Where new requisitions and receipts are announced. Leave blank to notify everyone with the Head of Finance permission." />
          <CardBody>
            <Field label="Finance notification email(s)" htmlFor="finance_notification_email" error={err("finance_notification_email")} hint="Separate multiple addresses with commas.">
              <Input id="finance_notification_email" inputMode="email" value={v.finance_notification_email} onChange={set("finance_notification_email")} />
            </Field>
          </CardBody>
        </Card>
      ) : null}

      {sections.includes("policy") ? (
        <Card>
          <CardHeader title="Policies" description="Shown to requesters and printed on Purchase Orders." />
          <CardBody className="space-y-4">
            <Field label="Requisition policy" htmlFor="requisition_policy" required error={err("requisition_policy")}><Textarea id="requisition_policy" rows={3} value={v.requisition_policy} onChange={set("requisition_policy")} /></Field>
            <Field label="Purchase Order instructions" htmlFor="po_instructions" required error={err("po_instructions")}><Textarea id="po_instructions" rows={3} value={v.po_instructions} onChange={set("po_instructions")} /></Field>
            <Field label="Purchase Order policy / footer" htmlFor="po_footer" required error={err("po_footer")}><Textarea id="po_footer" rows={2} value={v.po_footer} onChange={set("po_footer")} /></Field>
          </CardBody>
        </Card>
      ) : null}

      <div className="flex justify-end">
        <LoadingButton type="submit" variant="gold" size="lg" pending={pending} pendingLabel="Saving…">Save settings</LoadingButton>
      </div>
    </form>
  );
}
