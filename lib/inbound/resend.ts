import "server-only";

import { serverEnv } from "@/lib/server-env";

/** Resend Receiving API (webhooks carry metadata only; content is fetched here). */
const API = "https://api.resend.com";

export interface ReceivedEmail {
  id: string;
  from: string;
  to: string[];
  cc: string[];
  received_for: string[];
  subject: string | null;
  text: string | null;
  message_id: string | null;
}

export interface ReceivedAttachment {
  id: string;
  filename: string;
  content_type: string;
  size: number;
  download_url: string;
  content_disposition?: string | null;
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${serverEnv().resendApiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Resend API ${path} returned ${response.status}`);
  return (await response.json()) as T;
}

export function getReceivedEmail(emailId: string): Promise<ReceivedEmail> {
  return get<ReceivedEmail>(`/emails/receiving/${encodeURIComponent(emailId)}`);
}

export async function listReceivedAttachments(emailId: string): Promise<ReceivedAttachment[]> {
  const result = await get<{ data: ReceivedAttachment[] }>(`/emails/receiving/${encodeURIComponent(emailId)}/attachments`);
  return result.data ?? [];
}

/** Download an attachment with a hard size cap (never trust the declared size alone). */
export async function downloadAttachment(url: string, maxBytes: number): Promise<Buffer> {
  if (!/^https:\/\//.test(url)) throw new Error("Attachment URL must be HTTPS");
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok || !response.body) throw new Error(`Attachment download failed (${response.status})`);
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Attachment too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
