import "server-only";

import { after } from "next/server";
import { dispatchPendingPushes } from "@/lib/push/dispatch";

/**
 * Queue a best-effort push dispatch to run after the response is sent (and so
 * after the workflow transaction has committed). Never throws: push can never
 * affect the workflow action, its response, the inbox or email.
 */
export function schedulePushDispatch() {
  try {
    after(async () => {
      try {
        await dispatchPendingPushes();
      } catch (error) {
        console.warn("push dispatch failed", { error: (error as Error)?.name ?? "Error" });
      }
    });
  } catch {
    // Outside a request scope (e.g. tests): nothing to schedule.
  }
}
