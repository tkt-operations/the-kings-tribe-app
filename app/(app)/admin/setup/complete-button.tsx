"use client";

import { LoadingButton } from "@/components/ui/submit-button";
import { useAction } from "@/components/ui/use-action";
import { completeSetup } from "../settings/actions";

/** The server re-checks every required step before marking setup complete. */
export function CompleteSetupButton({ done, outstanding = [] }: { done: boolean; outstanding?: string[] }) {
  const { pending, error, run } = useAction();
  if (done) return <p className="font-medium text-kingdom-green">Setup is complete.</p>;
  return (
    <div>
      <LoadingButton variant="gold" size="lg" pending={pending} pendingLabel="Checking…"
        onClick={() => run(() => completeSetup(), { successMessage: "Setup completed successfully.", errorMessage: "Setup could not be marked complete. Please try again." })}>
        Mark setup complete
      </LoadingButton>
      {outstanding.length && !error ? (
        <p className="mt-2 text-sm text-navy/70">Still needed: {outstanding.join(", ")}.</p>
      ) : null}
      {error ? <p role="alert" className="mt-2 text-sm font-medium">{error}</p> : null}
    </div>
  );
}
