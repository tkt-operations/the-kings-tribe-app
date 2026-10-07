import "server-only";

import { lookup as dnsLookup } from "node:dns/promises";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { pipeline, Readable } from "node:stream";
import zlib from "node:zlib";
import { isPublicAddress } from "@/lib/product/ip-policy";
import { checkProductUrl } from "@/lib/product/url";

/**
 * SSRF-safe, best-effort fetch of a product page (or of a short link's
 * redirects). The URL is untrusted input:
 *  - https only on port 443; no credentials; no IP-literal or internal hosts
 *  - every resolved address must be public (lib/product/ip-policy.ts); the
 *    connection is made to THAT validated address (pinned lookup, SNI and
 *    certificate checks use the hostname), so DNS rebinding cannot redirect it
 *  - redirects are followed manually (max 3) and each hop is re-validated
 *  - 8 s overall deadline; at most 2 MB is read AFTER decompression
 *  - HTML content types only; no cookies; no retries; nothing is executed
 */

export const FETCH_LIMITS = { timeoutMs: 8_000, maxBytes: 2 * 1024 * 1024, maxRedirects: 3 } as const;
export const USER_AGENT = "TKT-Requisitions/1.0 (+https://ops.thekingstribe.org)";
const HTML_TYPES = ["text/html", "application/xhtml+xml"];
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}
export type Resolver = (host: string) => Promise<ResolvedAddress[]>;

export interface TransportResponse {
  status: number;
  headers: Record<string, string | undefined>;
  body: AsyncIterable<Uint8Array>;
  destroy(): void;
}
export type Transport = (request: {
  url: URL;
  address: ResolvedAddress;
  headers: Record<string, string>;
  signal: AbortSignal;
}) => Promise<TransportResponse>;

export type SafeFetchFailure =
  | "invalid_url"
  | "dns"
  | "blocked_address"
  | "too_many_redirects"
  | "http_error"
  | "not_html"
  | "timeout"
  | "network";

export type SafeFetchResult =
  | { ok: true; finalUrl: URL; status: number; body: string; truncated: boolean }
  | { ok: false; reason: SafeFetchFailure; status?: number };

export interface SafeFetchOptions {
  /** "page" reads an HTML body; "redirects" only follows redirects and returns the final URL. */
  mode?: "page" | "redirects";
  resolver?: Resolver;
  transport?: Transport;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

class FetchFailure extends Error {
  constructor(readonly reason: SafeFetchFailure, readonly status?: number) {
    super(reason);
  }
}

export async function safeFetch(input: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const {
    mode = "page",
    resolver = systemResolver,
    transport = httpsTransport,
    timeoutMs = FETCH_LIMITS.timeoutMs,
    maxBytes = FETCH_LIMITS.maxBytes,
    maxRedirects = FETCH_LIMITS.maxRedirects,
  } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const { signal } = controller;
  try {
    let current = input;
    for (let hop = 0; ; hop++) {
      const checked = checkProductUrl(current);
      if (!checked.ok) throw new FetchFailure("invalid_url");

      let addresses: ResolvedAddress[];
      try {
        addresses = await raceAbort(resolver(checked.host), signal);
      } catch (error) {
        if (signal.aborted) throw error;
        throw new FetchFailure("dns");
      }
      if (addresses.length === 0) throw new FetchFailure("dns");
      if (addresses.some((a) => !isPublicAddress(a.address))) throw new FetchFailure("blocked_address");

      const response = await raceAbort(
        transport({ url: checked.url, address: addresses[0], headers: requestHeaders(), signal }),
        signal,
      );
      if (REDIRECTS.has(response.status)) {
        response.destroy();
        const location = response.headers.location;
        if (!location) throw new FetchFailure("http_error", response.status);
        if (hop >= maxRedirects) throw new FetchFailure("too_many_redirects");
        current = new URL(location, checked.url).href;
        continue;
      }
      if (response.status < 200 || response.status >= 300) {
        response.destroy();
        throw new FetchFailure("http_error", response.status);
      }
      if (mode === "redirects") {
        response.destroy();
        return { ok: true, finalUrl: checked.url, status: response.status, body: "", truncated: false };
      }
      const contentType = (response.headers["content-type"] ?? "").toLowerCase();
      if (!HTML_TYPES.some((t) => contentType.split(";")[0].trim() === t)) {
        response.destroy();
        throw new FetchFailure("not_html");
      }
      const decoded = decodeBody(response.body, response.headers["content-encoding"]);
      try {
        const { bytes, truncated } = await readLimited(decoded.body, maxBytes, signal);
        return { ok: true, finalUrl: checked.url, status: response.status, body: decodeText(bytes, contentType), truncated };
      } finally {
        decoded.destroy();
        response.destroy();
      }
    }
  } catch (error) {
    if (signal.aborted) return { ok: false, reason: "timeout" };
    if (error instanceof FetchFailure) return { ok: false, reason: error.reason, status: error.status };
    return { ok: false, reason: "network" };
  } finally {
    clearTimeout(timer);
  }
}

function requestHeaders(): Record<string, string> {
  return {
    "user-agent": USER_AGENT,
    accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
    "accept-language": "en-US,en;q=0.8",
    "accept-encoding": "gzip, deflate, br",
  };
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error("aborted"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error("aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
      (error) => { signal.removeEventListener("abort", onAbort); reject(error); },
    );
  });
}

/** Decompress gzip / deflate / brotli. Size is limited on the DECOMPRESSED stream. */
export function decodeBody(body: AsyncIterable<Uint8Array>, encoding: string | undefined): { body: AsyncIterable<Uint8Array>; destroy(): void } {
  const enc = (encoding ?? "").trim().toLowerCase();
  if (enc === "" || enc === "identity") return { body, destroy: () => {} };
  const decoder =
    enc === "gzip" || enc === "x-gzip" ? zlib.createGunzip()
    : enc === "deflate" ? zlib.createInflate()
    : enc === "br" ? zlib.createBrotliDecompress()
    : null;
  if (!decoder) throw new FetchFailure("network");
  const out = pipeline(Readable.from(body), decoder, () => {});
  return { body: out, destroy: () => out.destroy() };
}

/** Read at most `maxBytes`; stops reading (and never buffers more) at the limit. */
export async function readLimited(body: AsyncIterable<Uint8Array>, maxBytes: number, signal: AbortSignal): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  const iterator = body[Symbol.asyncIterator]();
  try {
    while (true) {
      const next = await raceAbort(iterator.next(), signal);
      if (next.done) break;
      const chunk = next.value;
      if (total + chunk.byteLength > maxBytes) {
        chunks.push(chunk.subarray(0, maxBytes - total));
        total = maxBytes;
        truncated = true;
        break;
      }
      chunks.push(chunk);
      total += chunk.byteLength;
    }
  } finally {
    void iterator.return?.().catch(() => {});
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return { bytes, truncated };
}

function decodeText(bytes: Uint8Array, contentType: string): string {
  const charset = /charset\s*=\s*"?([\w.:-]+)"?/i.exec(contentType)?.[1];
  try {
    return new TextDecoder(charset ?? "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

const systemResolver: Resolver = async (host) => {
  const results = await dnsLookup(host, { all: true, verbatim: true });
  return results.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }));
};

/** A `lookup` that always answers with the address we already validated. */
export function pinnedLookup(address: ResolvedAddress): LookupFunction {
  return ((_hostname: string, options: { all?: boolean } | undefined, callback: (...args: unknown[]) => void) => {
    if (options?.all) callback(null, [{ address: address.address, family: address.family }]);
    else callback(null, address.address, address.family);
  }) as unknown as LookupFunction;
}

export const httpsTransport: Transport = ({ url, address, headers, signal }) =>
  new Promise((resolve, reject) => {
    const request = https.request(
      {
        protocol: "https:",
        hostname: url.hostname,
        servername: url.hostname,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers,
        agent: false,
        lookup: pinnedLookup(address),
        signal,
      },
      (response) => {
        const flat: Record<string, string | undefined> = {};
        for (const [key, value] of Object.entries(response.headers)) {
          if (key === "set-cookie") continue;
          flat[key] = Array.isArray(value) ? value.join(", ") : value;
        }
        resolve({ status: response.statusCode ?? 0, headers: flat, body: response, destroy: () => response.destroy() });
      },
    );
    request.on("error", reject);
    request.end();
  });
