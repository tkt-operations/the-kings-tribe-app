import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify a Svix-signed webhook (used by Resend).
 * Signed content: `${svix-id}.${svix-timestamp}.${rawBody}`, HMAC-SHA256 with
 * the base64-decoded secret (after the "whsec_" prefix). The signature header
 * holds one or more space-separated "v1,<base64>" values.
 */
export function verifySvixSignature(input: {
  id: string | null;
  timestamp: string | null;
  signatureHeader: string | null;
  body: string;
  secret: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): { ok: true } | { ok: false; reason: string } {
  const { id, timestamp, signatureHeader, body, secret } = input;
  if (!id || !timestamp || !signatureHeader) return { ok: false, reason: "missing signature headers" };
  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: "invalid timestamp" };
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSeconds ?? 300;
  if (Math.abs(now - Number(timestamp)) > tolerance) return { ok: false, reason: "timestamp outside tolerance" };
  const rawSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let key: Buffer;
  try {
    key = Buffer.from(rawSecret, "base64");
  } catch {
    return { ok: false, reason: "invalid secret" };
  }
  if (key.length === 0) return { ok: false, reason: "invalid secret" };
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  for (const part of signatureHeader.split(" ")) {
    const [version, signature] = part.split(",");
    if (version !== "v1" || !signature) continue;
    let provided: Buffer;
    try {
      provided = Buffer.from(signature, "base64");
    } catch {
      continue;
    }
    if (provided.length === expected.length && timingSafeEqual(provided, expected)) return { ok: true };
  }
  return { ok: false, reason: "signature mismatch" };
}
