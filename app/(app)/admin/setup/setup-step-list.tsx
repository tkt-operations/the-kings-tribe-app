import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import type { SetupStepStatus } from "@/lib/setup/progress";

/** Sidebar: one green check per step that is complete in the database. */
export function SetupStepList({ steps, currentStep, completed, total, children }: {
  steps: SetupStepStatus[];
  currentStep: number;
  completed: number;
  total: number;
  children?: React.ReactNode;
}) {
  return (
    <nav aria-label="Setup steps">
      <p className="mb-2 px-3 text-sm font-medium text-navy/65" aria-live="polite">{completed} of {total} steps complete</p>
      <ol className="space-y-1">
        {steps.map((s) => (
          <li key={s.n}>
            <Link href={`/admin/setup?step=${s.n}`} aria-current={s.n === currentStep ? "step" : undefined}
              className={`flex min-h-12 items-center gap-3 rounded-xl px-3 text-[15px] ${s.n === currentStep ? "bg-navy text-white" : "hover:bg-white"}`}>
              {s.done
                ? <CheckCircle2 className="size-5 shrink-0 text-kingdom-green" aria-hidden data-testid={`step-${s.n}-done`} />
                : <Circle className={`size-5 shrink-0 ${s.n === currentStep ? "text-gold" : "text-navy/30"}`} aria-hidden data-testid={`step-${s.n}-todo`} />}
              <span>{s.n}. {s.title}{!s.required ? <span className={`ml-1 text-xs ${s.n === currentStep ? "text-white/70" : "text-navy/50"}`}>(optional)</span> : null}</span>
              <span className="sr-only">{s.done ? " — complete" : " — not complete"}</span>
            </Link>
          </li>
        ))}
        {children ? <li className="pt-4">{children}</li> : null}
      </ol>
    </nav>
  );
}
