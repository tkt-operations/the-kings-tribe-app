"use server";

/**
 * TEMPORARY — administrator email delivery self-test (Resend webhook check).
 * Remove this file, lib/email/self-test.ts, sendDeliverySelfTestEmail in
 * lib/notify.ts and the card in ./email-self-test.tsx once verified.
 *
 * No input at all: the recipient is the signed-in administrator's own email,
 * and the subject and body are fixed on the server.
 */

import { getSessionUser } from "@/lib/auth";
import { toActionError, type ActionResult } from "@/lib/action-result";
import { assertAdministrator, latestEmailSelfTest, runEmailSelfTest, type SelfTestStatus } from "@/lib/email/self-test";

export async function sendTestEmailToMyself(): Promise<ActionResult> {
  try {
    const user = await getSessionUser(); // null for signed-out or deactivated users
    assertAdministrator(user);
    await runEmailSelfTest(user);
    return { ok: true, data: undefined, message: "Test email accepted for delivery. Check your inbox." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function getTestEmailStatus(): Promise<ActionResult<SelfTestStatus | null>> {
  try {
    const user = await getSessionUser();
    assertAdministrator(user);
    return { ok: true, data: await latestEmailSelfTest(user) };
  } catch (e) {
    return toActionError(e);
  }
}
