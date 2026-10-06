import { publicEnv } from "@/lib/env";

/**
 * Canonical external requisition URL, built from NEXT_PUBLIC_APP_URL
 * (production: https://ops.thekingstribe.org). Never hard-code the domain.
 */
export function requisitionLinkUrl(token: string): string {
  return `${publicEnv().appUrl}/request/${encodeURIComponent(token)}`;
}

/**
 * Truncated form for display, e.g. "ops.thekingstribe.org/request/Ab3dE9…".
 * Only the stored 6-character hint is ever shown, never the secret token.
 */
export function displayRequisitionLink(hint: string): string {
  const host = publicEnv().appUrl.replace(/^https?:\/\//, "");
  return `${host}/request/${hint}…`;
}
