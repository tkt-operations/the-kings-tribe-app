/** Paths that never require an internal session. Everything else does. */
const PUBLIC_PREFIXES = [
  "/login",
  "/forgot-password",
  "/auth/",
  "/request/",
  "/notifications/",
  "/setup",
  "/api/inbound-email",
  "/offline",
];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) =>
    prefix.endsWith("/") ? pathname.startsWith(prefix) : pathname === prefix || pathname.startsWith(prefix + "/"),
  );
}
