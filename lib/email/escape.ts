const MAP: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** HTML-escape untrusted text (requester input, item names, comments). */
export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => MAP[c]);
}

/** Only allow http(s) links into emails. */
export function safeUrl(value: string): string {
  return /^https?:\/\//i.test(value) ? escapeHtml(value) : "#";
}
