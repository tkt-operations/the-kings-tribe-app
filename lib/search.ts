/**
 * Make free-text search safe to embed in a PostgREST `or=(…)` filter:
 * strip characters that are part of the filter grammar and LIKE wildcards.
 */
export function sanitizeSearch(input: unknown, maxLength = 80): string {
  if (typeof input !== "string") return "";
  return input
    .normalize("NFKC")
    .replace(/[%_*,()\\:"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}
