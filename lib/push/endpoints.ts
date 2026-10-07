/**
 * Push subscription endpoints are URLs chosen by the browser vendor's push
 * service. The server will POST to them, so only those services are accepted
 * (also enforced by a database check): never an arbitrary or internal URL.
 * Client-safe.
 */
const ALLOWED = /^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)\/[^\s]+$/;

export function isAllowedPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048 || !ALLOWED.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && (url.port === "" || url.port === "443");
  } catch {
    return false;
  }
}

/** Base64url key material from PushSubscription.toJSON().keys. */
export const P256DH_PATTERN = /^[A-Za-z0-9_-]{40,200}={0,2}$/;
export const AUTH_PATTERN = /^[A-Za-z0-9_-]{16,64}={0,2}$/;
