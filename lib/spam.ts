import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/server-env";

/**
 * Anti-spam helpers for the public requisition form:
 *  - a signed "form issued at" stamp (bots that submit instantly, or replay
 *    a stale page, are rejected),
 *  - an HMAC fingerprint of IP + user agent for rate limiting (raw IPs are
 *    never stored).
 */
function key(): string {
  const env = serverEnv();
  const secret = env.supabaseSecretKey || env.setupToken;
  if (!secret) throw new Error("Server secret is not configured");
  return `tkt-form:${secret}`;
}

function sign(value: string): string {
  return createHmac("sha256", key()).update(value).digest("base64url");
}

export function issueFormStamp(now = Date.now()): string {
  const ts = String(now);
  return `${ts}.${sign(ts)}`;
}

export function verifyFormStamp(stamp: string, now = Date.now(), minMs = 3_000, maxMs = 24 * 60 * 60 * 1000): "ok" | "too-fast" | "expired" | "invalid" {
  const [ts, mac] = String(stamp ?? "").split(".");
  if (!ts || !mac || !/^\d{10,16}$/.test(ts)) return "invalid";
  const expected = Buffer.from(sign(ts));
  const provided = Buffer.from(mac);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return "invalid";
  const age = now - Number(ts);
  if (age < minMs) return "too-fast";
  if (age > maxMs) return "expired";
  return "ok";
}

export function fingerprint(ip: string | null, userAgent: string | null): string {
  return sign(`${ip ?? "unknown"}|${(userAgent ?? "").slice(0, 300)}`).slice(0, 43);
}
