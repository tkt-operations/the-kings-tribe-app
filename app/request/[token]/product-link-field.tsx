"use client";

import { useEffect, useRef, useState } from "react";
import type { UseFormRegisterReturn, UseFormReturn } from "react-hook-form";
import { Search } from "lucide-react";
import { Field, Input } from "@/components/ui/field";
import { LoadingButton } from "@/components/ui/submit-button";
import { cn } from "@/lib/cn";
import { formatMoney, parseMoney } from "@/lib/money";
import { LOOKUP_TOKEN_TTL_MS, type LookupOutcome, type PriceNote, type ProductFields } from "@/lib/product/types";
import { checkProductUrl } from "@/lib/product/url";
import type { RequisitionInput } from "@/lib/validation/requisition";
import { getProductDetails } from "./product-actions";

/**
 * "Product link (optional)" at the top of each line item. A lookup fills only
 * EMPTY fields; anything the requester already typed is never overwritten
 * (a "Use fetched value" suggestion appears instead). Every field stays
 * editable and manual entry always works — a failed lookup never blocks
 * submission.
 */

export type FillField =
  | "description" | "requested_brand" | "requested_model" | "requested_sku" | "vendor_name" | "color" | "size" | "estimated_unit_price";

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
  stale: "These details came from the previous link. Select Get details again to keep the product source.",
  expired: "The product lookup has expired. Your entries will be submitted as typed. Select Get details again to keep the product source.",
  invalid: "Enter a full web address starting with https://",
  multiplePrices: "This page lists more than one price. Please enter the price for the item you want.",
  otherCurrency: "The price on this page isn't in US dollars. Please enter the price manually.",
} as const;

export interface LineLookup {
  status: "loading" | "done" | "error" | "stale";
  /** The trimmed link the lookup was made for. */
  url: string;
  token: string | null;
  issuedAt: number | null;
  outcome: LookupOutcome | null;
  message: string;
  priceNote: PriceNote | null;
  fetched: Partial<Record<FillField, string>>;
  filled: FillField[];
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

export function useProductLookups(form: UseFormReturn<RequisitionInput>, formToken: string, indexOf: (fieldId: string) => number) {
  const [lookups, setLookups] = useState<Record<string, LineLookup>>({});
  const [now, setNow] = useState(() => Date.now());
  const requests = useRef<Record<string, number>>({});

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const update = (fieldId: string, next: LineLookup | null) =>
    setLookups((all) => {
      const copy = { ...all };
      if (next) copy[fieldId] = next;
      else delete copy[fieldId];
      return copy;
    });

  async function getDetails(fieldId: string) {
    const index = indexOf(fieldId);
    if (index < 0) return;
    const url = String(form.getValues(`items.${index}.vendor_url`) ?? "").trim();
    const base: LineLookup = { status: "error", url, token: null, issuedAt: null, outcome: null, message: "", priceNote: null, fetched: {}, filled: [] };
    if (!checkProductUrl(url).ok) {
      update(fieldId, { ...base, message: LOOKUP_MESSAGES.invalid });
      return;
    }
    const requestId = (requests.current[fieldId] ?? 0) + 1;
    requests.current[fieldId] = requestId;
    form.setValue(`items.${index}.product_lookup`, "");
    update(fieldId, { ...base, status: "loading" });

    let result: Awaited<ReturnType<typeof getProductDetails>> | null = null;
    try {
      result = await getProductDetails(formToken, url);
    } catch {
      result = null;
    }
    // Ignore answers for a link that has since changed or a line that was removed.
    const current = indexOf(fieldId);
    if (requests.current[fieldId] !== requestId || current < 0) return;
    if (String(form.getValues(`items.${current}.vendor_url`) ?? "").trim() !== url) return;

    if (!result || !result.ok) {
      update(fieldId, { ...base, message: result && !result.ok ? result.error : LOOKUP_MESSAGES.failed });
      return;
    }
    const data = result.data;
    const values = form.getValues(`items.${current}`);
    const fetched: Partial<Record<FillField, string>> = {};
    const filled: FillField[] = [];
    for (const [name, source] of FIELD_SOURCES) {
      let value = source === "price" ? data.price : data.fields[source];
      if (!value && name === "vendor_name" && data.outcome === "domain") value = data.domain;
      if (!value) continue;
      fetched[name] = value;
      if (String(values[name] ?? "").trim() === "") {
        form.setValue(`items.${current}.${name}`, value, { shouldDirty: true, shouldValidate: true });
        filled.push(name);
      }
    }
    form.setValue(`items.${current}.product_lookup`, data.token ?? "");
    const priceNote = data.priceNote;
    const message = [
      successMessage(data.outcome, data.domain, data.fields.vendor_name),
      priceNote === "multiple" ? LOOKUP_MESSAGES.multiplePrices : priceNote === "currency" ? LOOKUP_MESSAGES.otherCurrency : null,
    ].filter(Boolean).join(" ");
    update(fieldId, { status: "done", url, token: data.token, issuedAt: tokenIssuedAt(data.token), outcome: data.outcome, message, priceNote, fetched, filled });

    // Move to the first required detail that is still missing.
    const after = form.getValues(`items.${current}`);
    const missing = !String(after.description ?? "").trim() ? "description" : !String(after.estimated_unit_price ?? "").trim() ? "estimated_unit_price" : null;
    if (missing) setTimeout(() => document.getElementById(`items.${current}.${missing}`)?.focus(), 0);
  }

  /** The link was edited: a lookup for the old link no longer applies. */
  function urlChanged(fieldId: string, value: string) {
    const lookup = lookups[fieldId];
    if (!lookup || value.trim() === lookup.url) return;
    requests.current[fieldId] = (requests.current[fieldId] ?? 0) + 1;
    const index = indexOf(fieldId);
    if (index >= 0) form.setValue(`items.${index}.product_lookup`, "");
    if (lookup.status === "done" && lookup.token) {
      update(fieldId, { ...lookup, status: "stale", token: null, issuedAt: null, message: LOOKUP_MESSAGES.stale, filled: [], fetched: {} });
    } else {
      update(fieldId, null);
    }
  }

  function applyFetched(fieldId: string, name: FillField) {
    const lookup = lookups[fieldId];
    const index = indexOf(fieldId);
    const value = lookup?.fetched[name];
    if (!lookup || index < 0 || !value) return;
    form.setValue(`items.${index}.${name}`, value, { shouldDirty: true, shouldValidate: true });
    update(fieldId, { ...lookup, filled: lookup.filled.includes(name) ? lookup.filled : [...lookup.filled, name] });
  }

  function forget(fieldId: string) {
    requests.current[fieldId] = (requests.current[fieldId] ?? 0) + 1;
    update(fieldId, null);
  }

  return { lookups, now, getDetails, urlChanged, applyFetched, forget };
}

export function ProductLinkField({
  index,
  lookup,
  now,
  registration,
  error,
  urlValue,
  onGetDetails,
  className,
}: {
  index: number;
  lookup: LineLookup | undefined;
  now: number;
  registration: UseFormRegisterReturn;
  error?: string;
  urlValue: string;
  onGetDetails: () => void;
  className?: string;
}) {
  const id = `items.${index}.vendor_url`;
  const loading = lookup?.status === "loading";
  const expired = Boolean(lookup?.status === "done" && lookup.token && lookup.issuedAt && now - lookup.issuedAt > LOOKUP_TOKEN_TTL_MS);
  const message = expired ? LOOKUP_MESSAGES.expired : lookup?.message ?? "";
  return (
    <div className={cn("rounded-xl bg-neutral-gray p-3", className)}>
      <Field label="Product link (optional)" htmlFor={id} error={error} hint="Paste a link and we'll fill in whatever product information we can.">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input id={id} type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="https://" className="min-w-0 flex-1" {...registration} />
          <LoadingButton type="button" variant="secondary" className="h-12 w-full shrink-0 sm:w-auto" pending={loading} pendingLabel="Getting details…"
            disabled={!urlValue.trim()} onClick={onGetDetails} icon={<Search className="size-4" aria-hidden />}>
            Get details
          </LoadingButton>
        </div>
      </Field>
      <p id={`${id}-lookup-status`} aria-live="polite" className={cn("text-[13px] font-medium text-navy", message ? "mt-2" : "sr-only")}>
        {loading ? "Getting product details…" : message}
      </p>
    </div>
  );
}

/** "Filled" / "Edited" marker beside a field's label. */
export function LookupTag({ lookup, name, value }: { lookup: LineLookup | undefined; name: FillField; value: string | undefined }) {
  if (!lookup || lookup.status !== "done" || !lookup.filled.includes(name)) return null;
  const fetched = lookup.fetched[name] ?? "";
  const edited = !sameValue(name, String(value ?? ""), fetched);
  return (
    <span className={cn("ml-2 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide", edited ? "bg-gold/25 text-navy" : "bg-ministry-blue/10 text-ministry-blue")}>
      {edited ? "Edited" : "Filled"}
    </span>
  );
}

/** Offered under a field the requester had already filled in with a different value. */
export function FetchedValueButton({ lookup, name, value, currency, onUse }: { lookup: LineLookup | undefined; name: FillField; value: string | undefined; currency: string; onUse: () => void }) {
  if (!lookup || lookup.status !== "done" || lookup.filled.includes(name)) return null;
  const fetched = lookup.fetched[name];
  const current = String(value ?? "");
  if (!fetched || !current.trim() || sameValue(name, current, fetched)) return null;
  const shown = name === "estimated_unit_price" ? formatMoney(fetched, currency) : fetched;
  return (
    <button type="button" onClick={onUse} className="mt-1.5 min-h-10 text-left text-[13px] font-medium text-ministry-blue underline-offset-2 hover:underline">
      Use fetched value: {shown}
    </button>
  );
}
