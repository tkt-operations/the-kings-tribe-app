"use client";

import { LoadingButton } from "@/components/ui/submit-button";
import { useAction } from "@/components/ui/use-action";
import { completeSetup } from "../settings/actions";

export function CompleteSetupButton({ done }: { done: boolean }) {
  const { pending, error, run } = useAction();
  if (done) return <p className="font-medium text-kingdom-green">Setup is complete.</p>;
  return (
    <div>
      <LoadingButton variant="gold" size="lg" pending={pending} pendingLabel="Saving…"
        onClick={() => run(() => completeSetup(), { successMessage: "Setup completed successfully.", errorMessage: "Unable to complete setup. Please try again." })}>
        Mark setup complete
      </LoadingButton>
      {error ? <p role="alert" className="mt-2 text-sm font-medium">{error}</p> : null}
    </div>
  );
}
