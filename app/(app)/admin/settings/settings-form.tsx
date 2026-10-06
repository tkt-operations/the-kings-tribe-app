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
import { ALL_SETTINGS_SECTIONS, sectionSchema, type SettingsSection } from "@/lib/validation/settings";
import { saveSettings } from "./actions";

const CURRENCIES = ["USD", "CAD", "GBP", "EUR", "NGN", "GHS", "KES", "ZAR", "AUD", "NZD"];

/**
 * Edits one or more settings sections. Only the shown sections are validated
 * and saved, so each setup-wizard step stands on its own.
 */
export function SettingsForm({ settings, timezones, sections = ALL_SETTINGS_SECTIONS, requireNotificationEmail = false }: {
  settings: ChurchSettings;
  timezones: string[];
  sections?: SettingsSection[];
  /** Setup wizard step 2: a Finance notification address is part of completing the step. */
  requireNotificationEmail?: boolean;
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
  const { pending, error, run } = useAction();
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setV({ ...v, [k]: e.target.value });
    fields.clear(k);
  };
  const err = (k: string) => fields.errors[k];

  return (
    <form
      className="space-y-6"
      ref={formRef}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const parsed = sectionSchema(sections, { requireNotificationEmail }).safeParse(v);
        if (!parsed.success) {
          fields.check(issuesToFieldErrors(parsed.error.issues), formRef.current);
          return;
        }
        run(() => saveSettings(v, { sections, requireNotificationEmail }), {
          errorMessage: "Settings could not be saved. Please try again.",
          onError: (_e, fe) => fields.show(fe, formRef.current),
        });
      }}
    >
      {error ? <Alert tone="error">{error}</Alert> : null}
      <RequiredNote />

      {sections.includes("church") ? (
        <Card>
          <CardHeader title="Church information" description="Shown on the requisition form, emails and Purchase Orders." />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field className="sm:col-span-2" label="Church name" htmlFor="church_name" required error={err("church_name")}><Input id="church_name" value={v.church_name} onChange={set("church_name")} /></Field>
            <Field label="Address line 1" htmlFor="address_line1" required error={err("address_line1")}><Input id="address_line1" autoComplete="address-line1" value={v.address_line1} onChange={set("address_line1")} /></Field>
            <Field label="Address line 2" htmlFor="address_line2"><Input id="address_line2" autoComplete="address-line2" value={v.address_line2} onChange={set("address_line2")} /></Field>
            <Field label="City" htmlFor="city"><Input id="city" value={v.city} onChange={set("city")} /></Field>
            <Field label="State / region" htmlFor="region"><Input id="region" value={v.region} onChange={set("region")} /></Field>
            <Field label="Postal code" htmlFor="postal_code"><Input id="postal_code" value={v.postal_code} onChange={set("postal_code")} /></Field>
            <Field label="Country" htmlFor="country"><Input id="country" value={v.country} onChange={set("country")} /></Field>
            <Field label="Phone" htmlFor="phone" required error={err("phone")}><Input id="phone" type="tel" inputMode="tel" value={v.phone} onChange={set("phone")} /></Field>
            <Field label="Church email" htmlFor="email" required error={err("email")}><Input id="email" type="email" inputMode="email" value={v.email} onChange={set("email")} /></Field>
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
          <CardHeader title="Notifications" description={requireNotificationEmail ? "Where new requisitions and receipts are announced." : "Where new requisitions and receipts are announced. Leave blank to notify everyone with the Head of Finance permission."} />
          <CardBody>
            <Field label="Finance notification email(s)" htmlFor="finance_notification_email" required={requireNotificationEmail} error={err("finance_notification_email")} hint="Separate multiple addresses with commas.">
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
