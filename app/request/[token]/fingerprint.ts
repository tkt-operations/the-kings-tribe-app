import "server-only";

import { headers } from "next/headers";
import { fingerprint } from "@/lib/spam";

/** HMAC of client IP + user agent, for rate limiting (raw IPs are never stored). */
export async function clientFingerprint() {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip");
  return fingerprint(ip ?? null, h.get("user-agent"));
}
