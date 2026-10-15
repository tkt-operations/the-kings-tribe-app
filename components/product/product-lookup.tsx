"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Field, Input } from "@/components/ui/field";
import { LoadingButton } from "@/components/ui/submit-button";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/cn";
import { formatMoney, parseMoney } from "@/lib/money";
import { LOOKUP_TOKEN_TTL_MS, type LookupOutcome, type PriceNote, type ProductFields, type ProductLookupResponse } from "@/lib/product/types";
import { canonicalProductUrl, checkProductUrl } from "@/lib/product/url";

/**
 * Product URL auto-fill, shared by every form with line items (the external
 * request form and staff amendments). A lookup fills only EMPTY fields;
 * anything already typed is never overwritten (a "Use fetched value"
 * suggestion appears instead). Every field stays editable and manual entry
 * always works — a failed lookup never blocks submission.
 *
 * Per line, the engine remembers which fields the lookup filled (and with
 * what) and which of those have since been edited. When the link changes to a
 * genuinely different product, only untouched auto-filled values are cleared;
 * typed and edited values are kept (edited ones carry a "previous product"
 * warning), and the old lookup token is dropped for good.
 */

export type FillField =
  | "description" | "requested_brand" | "requested_model" | "requested_sku" | "vendor_name" | "color" | "size" | "estimated_unit_price";

export const FILL_FIELDS: readonly FillField[] = [
  "description", "requested_brand", "requested_model", "requested_sku", "vendor_name", "color", "size", "estimated_unit_price",
];

const FIELD_SOURCES: [FillField, keyof ProductFields | "price"][] = [
  ["description", "title"],
  ["requested_brand", "brand"],
  ["requested_model", "model"],
  ["requested_sku", "sku"],
  ["vendor_name", "vendor_name"],
  ["color", "color"],
  ["size", "size"],
  ["estimated_unit_price", "price"],
];

export const LOOKUP_MESSAGES = {
  failed: "We couldn't retrieve all of this product's information. Please complete the details below.",
  partial: "We found some details. Please complete the rest below.",
  linkChanged: "The product link changed. Select Get details to look up the new product.",
  cleared: "The product link changed, so details filled from the previous product were cleared. Check the details for the new product.",
  changedKept: "The product link changed. Some details below came from the previous product — check them for the new product.",
  restored: "Details from the previous product were restored. Check that they apply to this product.",
  previousProduct: "From the previous product — check this still applies.",
  expired: "The product lookup has expired. Your entries will be submitted as typed. Select Get details again to keep the product source.",
  invalid: "Enter a full web address starting with https://",
  multiplePrices: "This page lists more than one price. Please enter the price for the item you want.",
  otherCurrency: "The price on this page isn't in US dollars. Please enter the price manually.",
} as const;

/** The lookup for the line's current (or most recently looked-up) link. */
export interface LineLookup {
  status: "loading" | "done" | "error";
  /** The trimmed link the lookup was made for, and its canonical form. */
  url: string;
  canonical: string | null;
  token: string | null;
  issuedAt: number | null;
  outcome: LookupOutcome | null;
  message: string;
  priceNote: PriceNote | null;
  /** Values the lookup supplied, by form field. */
  fetched: Partial<Record<FillField, string>>;
  /** Fields the lookup actually populated (were empty, or "Use fetched value"). */
  filled: FillField[];
  /** Filled fields the requester has since typed into (sticky). */
  edited: FillField[];
}

/** What is left of the previous product after the link changed. */
export interface PreviousProduct {
  /** Untouched auto-filled values that were cleared (for Undo; emptied once a new lookup starts). */
  cleared: Partial<Record<FillField, string>>;
  /** How many values were cleared (for the notice). */
  clearedCount: number;
  /** Kept fields that came from the previous product and need checking. */
  warned: FillField[];
  restored: boolean;
  /** Hidden once a new lookup retrieves product details for the new link. */
  showNotice: boolean;
}

export interface LineState {
  lookup: LineLookup | null;
  previous: PreviousProduct | null;
}

function successMessage(outcome: LookupOutcome, domain: string, vendor: string | undefined): string {
  if (outcome === "full") return `Filled from ${domain}. Please check the details below.`;
  if (outcome === "partial") return LOOKUP_MESSAGES.partial;
  if (outcome === "hints") return `We recognised this ${vendor || domain} link and filled in what we could. Please add the price and check the details.`;
  return LOOKUP_MESSAGES.failed;
}

/** Lookup time from a token's (unsigned-readable) payload, for the expiry notice only. */
export function tokenIssuedAt(token: string | null): number | null {
  if (!token) return null;
  try {
    const part = token.split(".")[1] ?? "";
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (part.length % 4)) % 4));
    const at = (JSON.parse(json) as { at?: unknown }).at;
    return typeof at === "number" ? at : null;
  } catch {
    return null;
  }
}

const sameValue = (name: FillField, a: string, b: string) =>
  name === "estimated_unit_price" ? parseMoney(a) !== null && parseMoney(a) === parseMoney(b) : a.trim() === b.trim();

const EMPTY_LINE: LineState = { lookup: null, previous: null };

/**
 * How a form exposes its line items to the lookup engine. Lines are identified
 * by a stable key (never an array index), so answers for a line that moved or
 * was removed are handled correctly.
 */
export interface LookupAdapter {
  /** Current value of a line field ("" when empty or the line is gone). */
  get: (key: string, name: FillField | "vendor_url") => string;
  /** Set a line field (validate: also re-run field validation). */
  set: (key: string, name: FillField, value: string, validate: boolean) => void;
  /** The submission token for the line ("" = none). Forms that record no lookup evidence ignore it. */
  setToken: (key: string, token: string) => void;
  /** Whether the line still exists. */
  exists: (key: string) => boolean;
  /** All current line keys. */
  keys: () => string[];
  /** The server lookup for a link (best effort; never throws for vendor problems). */
  fetch: (url: string) => Promise<ActionResult<ProductLookupResponse>>;
  /** Element id of a line field, to move focus to the first missing detail. */
  fieldId: (key: string, name: FillField) => string;
}

export function useLineLookups(adapter: LookupAdapter) {
  // Handlers are recreated each render, so they always use this render's adapter.
  const a = () => adapter;
  const [state, setState] = useState<Record<string, LineState>>({});
  // Mirror for synchronous reads in event handlers (state updates are async).
  const stateRef = useRef<Record<string, LineState>>({});
  const [now, setNow] = useState(() => Date.now());
  const requests = useRef<Record<string, number>>({});

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const read = (fieldId: string): LineState => stateRef.current[fieldId] ?? EMPTY_LINE;
  const write = (fieldId: string, next: LineState | null) => {
    const all = { ...stateRef.current };
    if (next && (next.lookup || next.previous)) all[fieldId] = next;
    else delete all[fieldId];
    stateRef.current = all;
    setState(all);
  };

  /**
   * The link was edited. The token is submitted only while the link still
   * matches the looked-up product; fields are not cleared on each keystroke
   * (see commitUrl). An in-flight lookup for another link is abandoned.
   */
  function urlChanged(fieldId: string, value: string) {
    const { lookup, previous } = read(fieldId);
    if (!lookup) return;
    const matches = canonicalProductUrl(value) === lookup.canonical;
    if (lookup.status === "loading" && !matches) {
      requests.current[fieldId] = (requests.current[fieldId] ?? 0) + 1;
      write(fieldId, { lookup: null, previous });
      return;
    }
    if (a().exists(fieldId)) a().setToken(fieldId, matches && lookup.status === "done" && lookup.token ? lookup.token : "");
  }

  /**
   * Called when the link is committed (leaving the field, Get details, or
   * Submit). If it now points to a genuinely different product, clear ONLY
   * untouched auto-filled values of the previous product, keep everything the
   * requester typed or edited (warning on edited previous-product values), and
   * drop the previous token for good. Never touches other lines.
   */
  function commitUrl(fieldId: string) {
    const { lookup, previous } = read(fieldId);
    if (!lookup || lookup.status === "loading") return;
    if (!a().exists(fieldId)) return;
    if (canonicalProductUrl(a().get(fieldId, "vendor_url")) === lookup.canonical) return;

    const cleared: Partial<Record<FillField, string>> = {};
    const warned = new Set<FillField>(previous?.warned ?? []);
    for (const name of lookup.filled) {
      const fetched = lookup.fetched[name];
      const current = a().get(fieldId, name);
      if (!fetched || !current.trim()) continue;
      if (!lookup.edited.includes(name) && sameValue(name, current, fetched)) {
        a().set(fieldId, name, "", false);
        cleared[name] = current;
        warned.delete(name);
      } else {
        warned.add(name);
      }
    }
    a().setToken(fieldId, "");
    const changed = Object.keys(cleared).length > 0 || warned.size > 0;
    write(fieldId, {
      lookup: null,
      previous: changed ? { cleared, clearedCount: Object.keys(cleared).length, warned: [...warned], restored: false, showNotice: true } : previous,
    });
  }

  /** Undo: restore cleared values only into fields that are still empty. Never restores the token. */
  function undoClear(fieldId: string) {
    const { lookup, previous } = read(fieldId);
    if (!previous || previous.restored || !a().exists(fieldId)) return;
    const warned = new Set(previous.warned);
    for (const [name, value] of Object.entries(previous.cleared) as [FillField, string][]) {
      if (a().get(fieldId, name).trim() !== "") continue; // never overwrite what the requester entered since
      a().set(fieldId, name, value, true);
      warned.add(name);
    }
    write(fieldId, { lookup, previous: { cleared: {}, clearedCount: 0, warned: [...warned], restored: true, showNotice: true } });
  }

  async function getDetails(fieldId: string) {
    commitUrl(fieldId);
    if (!a().exists(fieldId)) return;
    const url = a().get(fieldId, "vendor_url").trim();
    const { previous } = read(fieldId);
    // Undo is no longer offered once a new lookup starts (never mix the old product into the new one).
    const quietPrevious = previous ? { ...previous, cleared: {} } : null;
    const base: LineLookup = {
      status: "error", url, canonical: canonicalProductUrl(url), token: null, issuedAt: null, outcome: null,
      message: "", priceNote: null, fetched: {}, filled: [], edited: [],
    };
    if (!checkProductUrl(url).ok) {
      write(fieldId, { lookup: { ...base, message: LOOKUP_MESSAGES.invalid }, previous: quietPrevious });
      return;
    }
    const requestId = (requests.current[fieldId] ?? 0) + 1;
    requests.current[fieldId] = requestId;
    a().setToken(fieldId, "");
    write(fieldId, { lookup: { ...base, status: "loading" }, previous: quietPrevious });

    let result: ActionResult<ProductLookupResponse> | null = null;
    try {
      result = await a().fetch(url);
    } catch {
      result = null;
    }
    // Ignore answers for a link that has since changed or a line that was removed.
    if (requests.current[fieldId] !== requestId || !a().exists(fieldId)) return;
    if (a().get(fieldId, "vendor_url").trim() !== url) return;
    const latestPrevious = read(fieldId).previous;

    if (!result || !result.ok) {
      write(fieldId, { lookup: { ...base, message: result && !result.ok ? result.error : LOOKUP_MESSAGES.failed }, previous: latestPrevious });
      return;
    }
    const data = result.data;
    const fetched: Partial<Record<FillField, string>> = {};
    const filled: FillField[] = [];
    for (const [name, source] of FIELD_SOURCES) {
      let value = source === "price" ? data.price : data.fields[source];
      if (!value && name === "vendor_name" && data.outcome === "domain") value = data.domain;
      if (!value) continue;
      fetched[name] = value;
      if (a().get(fieldId, name).trim() === "") {
        a().set(fieldId, name, value, true);
        filled.push(name);
      }
    }
    a().setToken(fieldId, data.token ?? "");
    const priceNote = data.priceNote;
    const message = [
      successMessage(data.outcome, data.domain, data.fields.vendor_name),
      priceNote === "multiple" ? LOOKUP_MESSAGES.multiplePrices : priceNote === "currency" ? LOOKUP_MESSAGES.otherCurrency : null,
    ].filter(Boolean).join(" ");
    const warned = (latestPrevious?.warned ?? []).filter((name) => !filled.includes(name));
    // The "previous product" notice stays until the new lookup actually finds product details.
    const keepNotice = Boolean(latestPrevious?.showNotice && !data.method);
    write(fieldId, {
      lookup: { ...base, status: "done", token: data.token, issuedAt: tokenIssuedAt(data.token), outcome: data.outcome, message, priceNote, fetched, filled },
      previous: latestPrevious && (warned.length || keepNotice) ? { ...latestPrevious, warned, showNotice: keepNotice } : null,
    });

    // Move to the first required detail that is still missing.
    const missing = !a().get(fieldId, "description").trim() ? "description" : !a().get(fieldId, "estimated_unit_price").trim() ? "estimated_unit_price" : null;
    if (missing) setTimeout(() => document.getElementById(a().fieldId(fieldId, missing))?.focus(), 0);
  }

  /** The requester typed into a product field. */
  function fieldEdited(fieldId: string, name: FillField) {
    const { lookup, previous } = read(fieldId);
    const markEdited = Boolean(lookup && lookup.filled.includes(name) && !lookup.edited.includes(name));
    const unwarn = Boolean(previous?.warned.includes(name));
    if (!markEdited && !unwarn) return;
    write(fieldId, {
      lookup: lookup && markEdited ? { ...lookup, edited: [...lookup.edited, name] } : lookup,
      previous: previous && unwarn ? { ...previous, warned: previous.warned.filter((n) => n !== name) } : previous,
    });
  }

  function applyFetched(fieldId: string, name: FillField) {
    const { lookup, previous } = read(fieldId);
    const value = lookup?.fetched[name];
    if (!lookup || !a().exists(fieldId) || !value) return;
    a().set(fieldId, name, value, true);
    write(fieldId, {
      lookup: { ...lookup, filled: lookup.filled.includes(name) ? lookup.filled : [...lookup.filled, name], edited: lookup.edited.filter((n) => n !== name) },
      previous: previous ? { ...previous, warned: previous.warned.filter((n) => n !== name) } : null,
    });
  }

  /** Before submitting: apply any link change that was not committed yet (e.g. Enter in the link field). */
  function commitAll() {
    for (const id of a().keys()) commitUrl(id);
  }

  function forget(fieldId: string) {
    requests.current[fieldId] = (requests.current[fieldId] ?? 0) + 1;
    write(fieldId, null);
  }

  return { lines: state, now, getDetails, urlChanged, commitUrl, commitAll, undoClear, fieldEdited, applyFetched, forget };
}

export function ProductLinkField({
  index,
  line,
  now,
  registration,
  error,
  urlValue,
  onGetDetails,
  onUndo,
  className,
  inputId,
  readOnly = false,
}: {
  index: number;
  line: LineState | undefined;
  now: number;
  /** Input props: a react-hook-form registration or plain value/onChange/onBlur. */
  registration: React.InputHTMLAttributes<HTMLInputElement> & { ref?: React.Ref<HTMLInputElement> };
  /** Input id (default: the request form's items.N.vendor_url). */
  inputId?: string;
  /** The link was verified at submission and cannot change (no lookup offered). */
  readOnly?: boolean;
  error?: string;
  urlValue: string;
  onGetDetails: () => void;
  onUndo: () => void;
  className?: string;
}) {
  const id = inputId ?? `items.${index}.vendor_url`;
  const lookup = line?.lookup ?? null;
  const previous = line?.previous ?? null;
  const loading = lookup?.status === "loading";
  const differs = Boolean(lookup && !loading && canonicalProductUrl(urlValue) !== lookup.canonical);
  const linkChanged = Boolean(differs && lookup && (lookup.filled.length || lookup.token));
  const expired = Boolean(!differs && lookup?.status === "done" && lookup.token && lookup.issuedAt && now - lookup.issuedAt > LOOKUP_TOKEN_TTL_MS);
  const message = loading
    ? "Getting product details…"
    : linkChanged ? LOOKUP_MESSAGES.linkChanged : differs ? "" : expired ? LOOKUP_MESSAGES.expired : lookup?.message ?? "";
  const notice = previous?.showNotice
    ? previous.restored
      ? LOOKUP_MESSAGES.restored
      : previous.clearedCount
        ? LOOKUP_MESSAGES.cleared
        : previous.warned.length
          ? LOOKUP_MESSAGES.changedKept
          : ""
    : "";
  const canUndo = Boolean(previous?.showNotice && !previous.restored && Object.keys(previous.cleared).length);
  return (
    <div className={cn("rounded-xl bg-neutral-gray p-3", className)}>
      <Field label="Product link (optional)" htmlFor={id} error={error}
        hint={readOnly ? "Verified when submitted, so it can’t be changed. Remove the line and add a new one instead." : "Paste a link and we'll fill in whatever product information we can."}>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input id={id} type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="https://" className="min-w-0 flex-1" readOnly={readOnly} {...registration} />
          {readOnly ? null : (
            <LoadingButton type="button" variant="secondary" className="h-12 w-full shrink-0 sm:w-auto" pending={loading} pendingLabel="Getting details…"
              disabled={!urlValue.trim()} onClick={onGetDetails} icon={<Search className="size-4" aria-hidden />}>
              Get details
            </LoadingButton>
          )}
        </div>
      </Field>
      <p id={`${id}-previous-notice`} aria-live="polite" className={cn("text-[13px] font-medium text-navy", notice ? "mt-2" : "sr-only")}>
        {notice}
        {canUndo ? (
          <button type="button" onClick={onUndo} className="ml-2 min-h-10 font-bold text-ministry-blue underline-offset-2 hover:underline">
            Undo
          </button>
        ) : null}
      </p>
      <p id={`${id}-lookup-status`} aria-live="polite" className={cn("text-[13px] font-medium text-navy", message ? "mt-2" : "sr-only")}>
        {message}
      </p>
    </div>
  );
}

/** "Filled" / "Edited" marker beside a field's label (only while the lookup matches the current link). */
export function LookupTag({ line, name, value, urlValue }: { line: LineState | undefined; name: FillField; value: string | undefined; urlValue: string }) {
  const lookup = line?.lookup;
  if (!lookup || lookup.status !== "done" || !lookup.filled.includes(name) || canonicalProductUrl(urlValue) !== lookup.canonical) return null;
  const fetched = lookup.fetched[name] ?? "";
  const edited = lookup.edited.includes(name) || !sameValue(name, String(value ?? ""), fetched);
  return (
    <span className={cn("ml-2 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide", edited ? "bg-gold/25 text-navy" : "bg-ministry-blue/10 text-ministry-blue")}>
      {edited ? "Edited" : "Filled"}
    </span>
  );
}

/**
 * Under a field: a warning when its value came from the previous product, or
 * a "Use fetched value" suggestion when the requester had already filled it
 * in with something different.
 */
export function FieldLookupNote({ line, name, value, currency, urlValue, onUse }: {
  line: LineState | undefined; name: FillField; value: string | undefined; currency: string; urlValue: string; onUse: () => void;
}) {
  const current = String(value ?? "");
  if (line?.previous?.warned.includes(name) && current.trim()) {
    return <p className="mt-1.5 text-[13px] font-medium text-navy/75"><span aria-hidden className="mr-1 inline-block size-2 rounded-full bg-gold" />{LOOKUP_MESSAGES.previousProduct}</p>;
  }
  const lookup = line?.lookup;
  if (!lookup || lookup.status !== "done" || lookup.filled.includes(name) || canonicalProductUrl(urlValue) !== lookup.canonical) return null;
  const fetched = lookup.fetched[name];
  if (!fetched || !current.trim() || sameValue(name, current, fetched)) return null;
  const shown = name === "estimated_unit_price" ? formatMoney(fetched, currency) : fetched;
  return (
    <button type="button" onClick={onUse} className="mt-1.5 min-h-10 text-left text-[13px] font-medium text-ministry-blue underline-offset-2 hover:underline">
      Use fetched value: {shown}
    </button>
  );
}
