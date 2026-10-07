import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { parseMoney } from "@/lib/money";
import { serverEnv } from "@/lib/server-env";
import { cleanFields } from "@/lib/product/normalize";
import {
  LOOKUP_METHODS,
  LOOKUP_TOKEN_MAX_LENGTH,
  LOOKUP_TOKEN_TTL_MS,
  PRODUCT_FIELD_KEYS,
  PRODUCT_FIELD_MAX,
  type LookupMethod,
  type ProductFields,
} from "@/lib/product/types";
import { canonicalProductUrl } from "@/lib/product/url";

/**
 * Signed product-lookup tokens. A lookup result travels through the browser
 * between "Get details" and Submit, so the server signs it and, at
 * submission, classifies each line:
 *
 *   none         no token — a normal manual line
 *   rejected     malformed, bad signature, or signed for another form link
 *   url_changed  genuine, but for a different link than the line now has
 *   expired      genuine, but older than 24 hours
 *   verified     genuine, current and for this link → attribution is stored
 *
 * Only `verified` lines keep source attribution. Every other status keeps the
 * requester's typed values and stores NO attribution. The requester sees the
 * same response either way (no security detail is revealed).
 */

const VERSION = "v1";

export interface LookupClaims {
  /** Form link (external_form_tokens.id) the lookup was made through. */
  fid: string;
  /** Canonical link the lookup was made for. */
  url: string;
  dom: string;
  m: LookupMethod;
  /** Lookup time, ms since epoch. */
  at: number;
  n: string;
  f: ProductFields;
  p: string | null;
  c: string | null;
}

const text = (max: number) => z.string().min(1).max(max).optional();
const claimsSchema = z.object({
  fid: z.uuid(),
  url: z.string().min(8).max(2048),
  dom: z.string().min(3).max(253).regex(/^[a-z0-9.-]+$/),
  m: z.enum(LOOKUP_METHODS),
  at: z.number().int().positive(),
  n: z.string().min(8).max(64),
  f: z.object({
    title: text(PRODUCT_FIELD_MAX.title),
    brand: text(PRODUCT_FIELD_MAX.brand),
    model: text(PRODUCT_FIELD_MAX.model),
    sku: text(PRODUCT_FIELD_MAX.sku),
    vendor_name: text(PRODUCT_FIELD_MAX.vendor_name),
    color: text(PRODUCT_FIELD_MAX.color),
    size: text(PRODUCT_FIELD_MAX.size),
  }).strict(),
  p: z.string().regex(/^\d{1,8}\.\d{2}$/).nullable(),
  c: z.literal("USD").nullable(),
}).strict().refine((c) => (c.p === null) === (c.c === null)).refine((c) => c.m !== "url_hint" || c.p === null);

function key(): string {
  const env = serverEnv();
  const secret = env.supabaseSecretKey || env.setupToken;
  if (!secret) throw new Error("Server secret is not configured");
  return `tkt-product-lookup:${secret}`;
}

function mac(value: string): string {
  return createHmac("sha256", key()).update(value).digest("base64url");
}

export function signLookupToken(claims: Omit<LookupClaims, "n"> & { n?: string }): string {
  const full: LookupClaims = { ...claims, n: claims.n ?? randomBytes(12).toString("base64url") };
  const body = `${VERSION}.${Buffer.from(JSON.stringify(full), "utf8").toString("base64url")}`;
  return `${body}.${mac(body)}`;
}

export type RejectReason = "malformed" | "signature" | "wrong_link";
export type LookupClassification =
  | { status: "none" }
  | { status: "rejected"; reason: RejectReason }
  | { status: "url_changed" }
  | { status: "expired" }
  | { status: "verified"; claims: LookupClaims };

export function classifyLookup(
  token: unknown,
  context: { formTokenId: string; vendorUrl: string | null | undefined; now?: number },
): LookupClassification {
  if (token === undefined || token === null || token === "") return { status: "none" };
  if (typeof token !== "string" || token.length > LOOKUP_TOKEN_MAX_LENGTH) return { status: "rejected", reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION || !parts[1] || !parts[2]) return { status: "rejected", reason: "malformed" };

  const expected = Buffer.from(mac(`${parts[0]}.${parts[1]}`));
  const provided = Buffer.from(parts[2]);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return { status: "rejected", reason: "signature" };

  let claims: LookupClaims;
  try {
    const parsed = claimsSchema.safeParse(JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")));
    if (!parsed.success) return { status: "rejected", reason: "malformed" };
    claims = parsed.data as LookupClaims;
  } catch {
    return { status: "rejected", reason: "malformed" };
  }
  if (claims.fid !== context.formTokenId) return { status: "rejected", reason: "wrong_link" };

  const current = canonicalProductUrl(context.vendorUrl);
  if (!current || current !== claims.url) return { status: "url_changed" };

  const now = context.now ?? Date.now();
  if (now - claims.at > LOOKUP_TOKEN_TTL_MS || claims.at - now > 5 * 60 * 1000) return { status: "expired" };

  return { status: "verified", claims };
}

/** The submitted line values a verified lookup is compared against. */
export interface SubmittedLine {
  description: string;
  vendor_name?: string | null;
  estimated_unit_price: string;
  requested_brand?: string | null;
  requested_model?: string | null;
  requested_sku?: string | null;
  color?: string | null;
  size?: string | null;
}

export type EditableField =
  | "description" | "vendor_name" | "estimated_unit_price" | "requested_brand" | "requested_model" | "requested_sku" | "color" | "size";

const FIELD_MAP: [EditableField, keyof ProductFields][] = [
  ["description", "title"],
  ["vendor_name", "vendor_name"],
  ["requested_brand", "brand"],
  ["requested_model", "model"],
  ["requested_sku", "sku"],
  ["color", "color"],
  ["size", "size"],
];

const same = (a: string | null | undefined, b: string) => (a ?? "").replace(/\s+/g, " ").trim() === b;

/** Which fetched values the requester changed (worked out on the server, never trusted from the browser). */
export function editedFields(claims: LookupClaims, line: SubmittedLine): EditableField[] {
  const edited: EditableField[] = [];
  for (const [column, key] of FIELD_MAP) {
    const fetched = claims.f[key];
    if (fetched !== undefined && !same(line[column], fetched)) edited.push(column);
  }
  if (claims.p !== null && parseMoney(line.estimated_unit_price) !== parseMoney(claims.p)) edited.push("estimated_unit_price");
  return edited;
}

/** Database payload for one line's lookup (`items[n].lookup`). */
export function lookupPayload(classification: LookupClassification, line: SubmittedLine): Record<string, unknown> {
  switch (classification.status) {
    case "none":
    case "url_changed":
    case "expired":
      return { status: classification.status };
    case "rejected":
      return { status: "rejected", reason: classification.reason };
    case "verified": {
      const { claims } = classification;
      const values = cleanFields(claims.f);
      return {
        status: "verified",
        method: claims.m,
        domain: claims.dom,
        fetched_at: new Date(claims.at).toISOString(),
        price: claims.p,
        currency: claims.p === null ? null : claims.c,
        values: Object.keys(values).length ? Object.fromEntries(PRODUCT_FIELD_KEYS.filter((k) => values[k]).map((k) => [k, values[k]])) : null,
        edited_fields: editedFields(claims, line),
      };
    }
  }
}
