"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";

/** Run a server action, track pending/error/success, refresh the route on success. */
export function useAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function run<T>(fn: () => Promise<ActionResult<T>>, onSuccess?: (data: T) => void) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        setMessage(result.message ?? null);
        onSuccess?.(result.data);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return { pending, error, message, run, setError };
}
