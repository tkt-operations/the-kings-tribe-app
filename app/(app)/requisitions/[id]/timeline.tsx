import { Check, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { StepState, TimelineStep } from "@/lib/workflow/request-types";

export function Timeline({ steps, states }: { steps: TimelineStep[]; states: StepState[] }) {
  return (
    <ol className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-0" aria-label="Workflow progress">
      {steps.map((step, i) => {
        const state = states[i];
        return (
          <li key={`${step.key}-${i}`} className="relative flex items-center gap-3 sm:flex-1 sm:flex-col sm:gap-2 sm:text-center" aria-current={state === "current" ? "step" : undefined}>
            {i < steps.length - 1 ? (
              <span aria-hidden className={cn("absolute left-4 top-8 h-[calc(100%+0.25rem)] w-0.5 sm:left-1/2 sm:top-4 sm:h-0.5 sm:w-full", state === "done" ? "bg-kingdom-green" : "bg-navy/10")} />
            ) : null}
            <span
              className={cn(
                "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ring-4 ring-white",
                state === "done" && "bg-kingdom-green text-white",
                state === "current" && "bg-gold text-navy",
                state === "upcoming" && "bg-neutral-gray text-navy/50",
                state === "stopped" && "bg-energy-orange text-white",
              )}
            >
              {state === "done" ? <Check className="size-4" aria-hidden /> : state === "stopped" ? <X className="size-4" aria-hidden /> : i + 1}
            </span>
            <span className={cn("text-sm sm:px-1 sm:text-[13px]", state === "upcoming" ? "text-navy/50" : "font-medium text-navy")}>
              {step.label}
              <span className="sr-only"> — {state}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
