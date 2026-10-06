import "server-only";

import { serverEnv } from "@/lib/server-env";

export interface OutgoingEmail {
  to: string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string | null;
  attachments?: { filename: string; content: Buffer }[];
  idempotencyKey?: string;
}

export type SendResult = { status: "sent"; id: string } | { status: "skipped"; reason: string } | { status: "failed"; error: string };

export function isEmailConfigured(): boolean {
  const env = serverEnv();
  return Boolean(env.resendApiKey && env.emailFrom);
}

/**
 * Send via the Resend REST API. When email is not configured the message is
 * NOT pretended to be sent: the caller records it as "skipped".
 */
export async function sendEmail(message: OutgoingEmail): Promise<SendResult> {
  const env = serverEnv();
  if (!isEmailConfigured()) return { status: "skipped", reason: "Email is not configured (RESEND_API_KEY / EMAIL_FROM)" };
  const recipients = [...new Set(message.to.map((t) => t.trim().toLowerCase()).filter(Boolean))];
  if (recipients.length === 0) return { status: "skipped", reason: "No recipients" };

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.resendApiKey}`,
        "Content-Type": "application/json",
        ...(message.idempotencyKey ? { "Idempotency-Key": message.idempotencyKey.slice(0, 256) } : {}),
      },
      body: JSON.stringify({
        from: env.emailFrom,
        to: recipients,
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
        ...(message.attachments?.length
          ? { attachments: message.attachments.map((a) => ({ filename: a.filename, content: a.content.toString("base64") })) }
          : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!response.ok || !body.id) return { status: "failed", error: body.message ?? `HTTP ${response.status}` };
    return { status: "sent", id: body.id };
  } catch (error) {
    return { status: "failed", error: (error as Error).message };
  }
}
