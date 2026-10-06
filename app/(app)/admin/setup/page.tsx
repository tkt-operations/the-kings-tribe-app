import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requirePagePermission } from "@/lib/auth";
import { getChurchSettings } from "@/lib/data/settings";
import { loadSetupProgress } from "@/lib/setup/load";
import type { SetupStepStatus } from "@/lib/setup/progress";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listTimezones } from "@/lib/timezones";
import { SettingsForm } from "../settings/settings-form";
import { CompleteSetupButton } from "./complete-button";
import { SetupStepList } from "./setup-step-list";

export const metadata = { title: "Setup wizard" };

export default async function SetupWizardPage({ searchParams }: PageProps<"/admin/setup">) {
  await requirePagePermission("settings.manage");
  const settings = await getChurchSettings();
  if (!settings) return null;
  // Completion comes from what is saved in the database — never from browser state.
  const progress = await loadSetupProgress(await createSupabaseServerClient());
  const params = await searchParams;
  const step = Number(params.step) || 1;
  const timezones = listTimezones(settings.timezone);

  const bodies: Record<number, React.ReactNode> = {
    1: <SettingsForm settings={settings} timezones={timezones} sections={["church", "money"]} />,
    2: <SettingsForm settings={settings} timezones={timezones} sections={["notifications", "policy"]} requireNotificationEmail />,
    3: <Explain href="/categories" label="Review categories">Attendance (Adult, Children’s), finance (Offering, Tithe, Church Outreach) and expense categories are already created. Add Youth, Volunteers, Guests or anything else you track. Starter budget lines are under “Budget lines”.</Explain>,
    4: <Explain href="/departments" label="Review departments">Production, Hospitality and Children’s Ministry teams are set up with their subcategories. Add or rename to match your church.</Explain>,
    5: <Explain href="/admin/users" label="Invite users">Invite the rest of the finance and operations team (about 5 people) and assign each a role. Department leads do not need accounts. This step is recommended but not required to finish setup.</Explain>,
    6: <Explain href="/admin/form-links" label="Create a link">Create a secure link and send it to department and ministry leads so they can submit requisitions.</Explain>,
  };
  const current = progress.steps.find((s) => s.n === step) ?? progress.steps[0];

  return (
    <>
      <PageHeader eyebrow="First-time setup" title="Setup wizard" description="Work through each step. You can return to any of these pages later from Administration." />
      <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <SetupStepList steps={progress.steps} currentStep={current.n} completed={progress.completed} total={progress.total}>
          <CompleteSetupButton done={Boolean(settings.setup_completed_at)} outstanding={progress.incompleteRequired.map((s) => `Step ${s.n} — ${s.title}`)} />
        </SetupStepList>
        <section aria-labelledby="step-title">
          <h2 id="step-title" className="mb-2 font-serif text-section">{current.n}. {current.title}</h2>
          <StepStatus step={current} />
          {bodies[current.n]}
          <div className="mt-6 flex justify-between">
            {current.n > 1 ? <Link href={`/admin/setup?step=${current.n - 1}`} className="rounded-xl px-4 py-3 font-medium ring-1 ring-navy/15">Back</Link> : <span />}
            {current.n < progress.total ? <Link href={`/admin/setup?step=${current.n + 1}`} className="rounded-xl bg-navy px-4 py-3 font-medium text-gold">Next step</Link> : null}
          </div>
        </section>
      </div>
    </>
  );
}

function StepStatus({ step }: { step: SetupStepStatus }) {
  if (step.done) return <p className="mb-4 flex items-center gap-1.5 text-sm font-medium text-kingdom-green"><CheckCircle2 className="size-4" aria-hidden /> This step is complete.</p>;
  return (
    <div className="mb-4 text-sm text-navy/70">
      <p className="font-medium text-navy">To complete this step:</p>
      <ul className="mt-1 list-disc pl-5">{step.missing.map((m) => <li key={m}>{m}</li>)}</ul>
    </div>
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
