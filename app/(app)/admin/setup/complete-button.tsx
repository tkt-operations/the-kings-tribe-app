"use client";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/submit-button";
import { useAction } from "@/components/ui/use-action";
import { completeSetup } from "../settings/actions";

export function CompleteSetupButton({ done }: { done: boolean }) {
  const { pending, error, message, run } = useAction();
  if (done) return <p className="font-medium text-kingdom-green">Setup is complete.</p>;
  return (
    <div>
      <Button variant="gold" size="lg" disabled={pending} onClick={() => run(() => completeSetup())}>{pending ? <Spinner /> : null}Mark setup complete</Button>
      {error || message ? <p className="mt-2 text-sm">{error ?? message}</p> : null}
    </div>
  );
}
