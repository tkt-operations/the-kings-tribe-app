import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requirePagePermission } from "@/lib/auth";
import { getChurchSettings } from "@/lib/data/settings";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listTimezones } from "@/lib/timezones";
import { SettingsForm } from "../settings/settings-form";
import { CompleteSetupButton } from "./complete-button";

export const metadata = { title: "Setup wizard" };

export default async function SetupWizardPage({ searchParams }: PageProps<"/admin/setup">) {
  await requirePagePermission("settings.manage");
  const settings = await getChurchSettings();
  if (!settings) return null;
  const supabase = await createSupabaseServerClient();
  const [{ count: userCount }, { count: linkCount }, { count: deptCount }, { count: catCount }] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("external_form_tokens").select("id", { count: "exact", head: true }),
    supabase.from("departments").select("id", { count: "exact", head: true }).eq("is_active", true),
    supabase.from("categories").select("id", { count: "exact", head: true }).eq("is_active", true),
  ]);
  const params = await searchParams;
  const step = Number(params.step) || 1;

  const steps = [
    { n: 1, title: "Church information", done: Boolean(settings.address_line1 && settings.phone && settings.email), body: <SettingsForm settings={settings} timezones={listTimezones(settings.timezone)} sections={["church", "money"]} /> },
    { n: 2, title: "Notification email & policies", done: Boolean(settings.finance_notification_email), body: <SettingsForm settings={settings} timezones={listTimezones(settings.timezone)} sections={["notifications", "policy"]} /> },
    { n: 3, title: "Categories", done: (catCount ?? 0) > 0, body: <Explain href="/categories" label="Review categories">Attendance (Adult, Children’s), finance (Offering, Tithe, Church Outreach) and expense categories are already created. Add Youth, Volunteers, Guests or anything else you track. Starter budget lines are under “Budget lines”.</Explain> },
    { n: 4, title: "Departments", done: (deptCount ?? 0) > 0, body: <Explain href="/departments" label="Review departments">Production, Hospitality and Children’s Ministry teams are set up with their subcategories. Add or rename to match your church.</Explain> },
    { n: 5, title: "Invite your team", done: (userCount ?? 0) > 1, body: <Explain href="/admin/users" label="Invite users">Invite the rest of the finance and operations team (about 5 people) and assign each a role. Department leads do not need accounts.</Explain> },
    { n: 6, title: "Create a requisition link", done: (linkCount ?? 0) > 0, body: <Explain href="/admin/form-links" label="Create a link">Create a secure link and send it to department and ministry leads so they can submit requisitions.</Explain> },
  ];
  const current = steps.find((s) => s.n === step) ?? steps[0];

  return (
    <>
      <PageHeader eyebrow="First-time setup" title="Setup wizard" description="Work through each step. You can return to any of these pages later from Administration." />
      <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <ol className="space-y-1">
          {steps.map((s) => (
            <li key={s.n}>
              <Link href={`/admin/setup?step=${s.n}`} aria-current={s.n === current.n ? "step" : undefined}
                className={`flex min-h-12 items-center gap-3 rounded-xl px-3 text-[15px] ${s.n === current.n ? "bg-navy text-white" : "hover:bg-white"}`}>
                {s.done ? <CheckCircle2 className="size-5 text-kingdom-green" aria-hidden /> : <Circle className={`size-5 ${s.n === current.n ? "text-gold" : "text-navy/30"}`} aria-hidden />}
                <span>{s.n}. {s.title}</span>
              </Link>
            </li>
          ))}
          <li className="pt-4"><CompleteSetupButton done={Boolean(settings.setup_completed_at)} /></li>
        </ol>
        <section aria-labelledby="step-title">
          <h2 id="step-title" className="mb-4 font-serif text-section">{current.n}. {current.title}</h2>
          {current.body}
          <div className="mt-6 flex justify-between">
            {current.n > 1 ? <Link href={`/admin/setup?step=${current.n - 1}`} className="rounded-xl px-4 py-3 font-medium ring-1 ring-navy/15">Back</Link> : <span />}
            {current.n < steps.length ? <Link href={`/admin/setup?step=${current.n + 1}`} className="rounded-xl bg-navy px-4 py-3 font-medium text-gold">Next step</Link> : null}
          </div>
        </section>
      </div>
    </>
  );
}

function Explain({ children, href, label }: { children: React.ReactNode; href: string; label: string }) {
  return (
    <Card>
      <CardBody className="space-y-4 pt-6">
        <p className="leading-relaxed text-navy/80">{children}</p>
        <Link href={href} className="inline-flex h-11 items-center rounded-xl bg-navy px-4 font-medium text-gold">{label}</Link>
      </CardBody>
    </Card>
  );
}
