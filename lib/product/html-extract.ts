/**
 * Reads ONLY two things from a vendor page: <script type="application/ld+json">
 * blocks and <meta> tags. Nothing is rendered, executed or returned as HTML.
 * Linear scanning (indexOf) so hostile markup cannot cause regex backtracking.
 */

export const JSONLD_LIMITS = { maxBlocks: 20, maxBlockBytes: 200 * 1024 } as const;
const MAX_META_TAGS = 500;
const MAX_TAG_LENGTH = 4096;

/** Raw text of each JSON-LD block (up to 20 blocks of up to 200 KB each). */
export function extractJsonLdBlocks(html: string): string[] {
  const lower = asciiLower(html);
  const blocks: string[] = [];
  let from = 0;
  while (blocks.length < JSONLD_LIMITS.maxBlocks) {
    const start = lower.indexOf("<script", from);
    if (start === -1) break;
    const tagEnd = lower.indexOf(">", start);
    if (tagEnd === -1) break;
    const close = lower.indexOf("</script", tagEnd);
    if (close === -1) break;
    from = close + 8;
    const tag = lower.slice(start, Math.min(tagEnd, start + MAX_TAG_LENGTH));
    if (!/\btype\s*=\s*["']?application\/ld\+json/.test(tag)) continue;
    const body = html.slice(tagEnd + 1, close);
    if (body.length > JSONLD_LIMITS.maxBlockBytes) continue;
    blocks.push(body);
  }
  return blocks;
}

/** Parse one JSON-LD block; malformed blocks are skipped (undefined). */
export function parseJsonLd(block: string): unknown {
  const text = block
    .trim()
    .replace(/^<!--/, "")
    .replace(/-->$/, "")
    .replace(/^\/\/\s*<!\[CDATA\[/, "")
    .replace(/\/\/\s*\]\]>$/, "")
    .trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** <meta property|name|itemprop="…" content="…"> → lowercase key → raw content (first wins). */
export function extractMetaTags(html: string): Map<string, string> {
  const lower = asciiLower(html);
  const out = new Map<string, string>();
  let from = 0;
  let seen = 0;
  while (seen < MAX_META_TAGS) {
    const start = lower.indexOf("<meta", from);
    if (start === -1) break;
    const end = lower.indexOf(">", start);
    if (end === -1) break;
    from = end + 1;
    seen++;
    if (end - start > MAX_TAG_LENGTH) continue;
    const attrs = parseAttributes(html.slice(start + 5, end));
    const key = (attrs.property ?? attrs.name ?? attrs.itemprop)?.toLowerCase().trim();
    const content = attrs.content;
    if (key && content !== undefined && !out.has(key)) out.set(key, content);
  }
  return out;
}

/** Lowercases A–Z only, so indexes stay aligned with the original string. */
function asciiLower(value: string): string {
  return value.replace(/[A-Z]+/g, (m) => m.toLowerCase());
}

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    const name = match[1].toLowerCase();
    if (!(name in attrs)) attrs[name] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attrs;
}
