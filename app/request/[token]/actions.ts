"use server";

import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { checkReceiptFile, RECEIPT_MAX_FILES } from "@/lib/receipt-files";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadFormContext, FORM_TOKEN_PATTERN } from "@/lib/data/form-context";
import { verifyFormStamp } from "@/lib/spam";
import { buildRequisitionSchema, toDatabasePayload } from "@/lib/validation/requisition";
import { notifyRequisitionSubmitted } from "@/lib/notify";
import type { ActionResult } from "@/lib/action-result";
import type { Priority } from "@/lib/priority";
import { classifyLookup, lookupPayload } from "@/lib/product/lookup-token";
import { schedulePushDispatch } from "@/lib/push/schedule";
import { clientFingerprint } from "./fingerprint";

const GENERIC = "We could not submit your request. Please check the form and try again.";

/** Issue short-lived signed URLs so receipts upload straight to private Storage. */
export async function prepareReceiptUploads(
  token: string,
  files: { name: string; type: string; size: number }[],
): Promise<ActionResult<{ path: string; signedToken: string; contentType: string; originalName: string }[]>> {
  if (!FORM_TOKEN_PATTERN.test(token)) return { ok: false, error: "This requisition link is invalid." };
  if (!Array.isArray(files) || files.length === 0) return { ok: true, data: [] };
  if (files.length > RECEIPT_MAX_FILES) return { ok: false, error: `Attach at most ${RECEIPT_MAX_FILES} files.` };
  const checked = files.map((f) => ({ f, r: checkReceiptFile({ name: String(f.name), type: String(f.type ?? ""), size: Number(f.size) }) }));
  const bad = checked.find((c) => !c.r.ok);
  if (bad && !bad.r.ok) return { ok: false, error: bad.r.error };

  const admin = createSupabaseAdminClient();
  const { data: tokenId } = await admin.rpc("resolve_form_token_id", { p_token: token });
  if (!tokenId) return { ok: false, error: "This requisition link is invalid or has expired." };
  const { data: allowed } = await admin.rpc("consume_rate_limit", { p_bucket: `upload:${await clientFingerprint()}`, p_max: 30, p_window_seconds: 3600 });
  if (!allowed) return { ok: false, error: "Too many uploads. Please try again later." };

  const out = [];
  for (const { f, r } of checked) {
    if (!r.ok) continue;
    const path = `external/${tokenId}/${randomUUID()}.${r.ext}`;
    const { data, error } = await admin.storage.from("receipts").createSignedUploadUrl(path);
    if (error || !data) return { ok: false, error: "Could not prepare the upload. Please try again." };
    out.push({ path, signedToken: data.token, contentType: r.mime, originalName: String(f.name).slice(0, 255) });
  }
  return { ok: true, data: out };
}

export interface SubmissionSummary {
  requisition_number: string;
  submitted_at: string;
  needed_by: string;
  department_name: string;
  subcategory_name: string;
  request_type_name: string;
  estimated_total: string;
  status: string;
  items: { line_number: number; description: string; quantity: string; estimated_total: string; priority: Priority; essential_justification: string | null }[];
}

export async function submitExternalRequisition(
  token: string,
  input: unknown,
  files: { path: string; original_filename: string }[],
  stamp: string,
  website: string, // honeypot: real people never fill this in
): Promise<ActionResult<SubmissionSummary>> {
  if (!FORM_TOKEN_PATTERN.test(token)) return { ok: false, error: "This requisition link is invalid." };
  if (website) return { ok: false, error: GENERIC };
  const stampCheck = verifyFormStamp(stamp);
  if (stampCheck === "expired") return { ok: false, error: "This form has been open for too long. Please refresh the page and submit again." };
  if (stampCheck !== "ok") return { ok: false, error: GENERIC };

  const context = await loadFormContext(token);
  if (!context) return { ok: false, error: "This requisition link is invalid or has expired." };

  const receiptCount = Array.isArray(files) ? files.length : 0;
  const schema = buildRequisitionSchema({ today: context.today, requestTypes: context.request_types });
  const parsed = schema.safeParse({ ...(input as object), receipt_count: receiptCount });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[issue.path.join(".")] ??= issue.message;
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors };
  }
  const cleanFiles = (Array.isArray(files) ? files : [])
    .slice(0, RECEIPT_MAX_FILES)
    .map((f) => ({ path: String(f.path), original_filename: String(f.original_filename ?? "receipt").slice(0, 255) }));

  const admin = createSupabaseAdminClient();
  const clientFp = await clientFingerprint();
  const payload = toDatabasePayload(parsed.data);

  // Classify each line's signed product lookup. Only a verified lookup keeps
  // source attribution; expired / changed-link / invalid ones keep the typed
  // values without it. The response is identical in every case.
  let formTokenId = "";
  if (parsed.data.items.some((i) => i.product_lookup)) {
    const { data: id } = await admin.rpc("resolve_form_token_id", { p_token: token });
    formTokenId = id ? String(id) : "";
  }
  const rejected: { line: number; reason: string }[] = [];
  const items = payload.items.map((line, index) => {
    const classification = classifyLookup(parsed.data.items[index].product_lookup, { formTokenId, vendorUrl: line.vendor_url });
    if (classification.status === "rejected") rejected.push({ line: index + 1, reason: classification.reason });
    return { ...line, lookup: lookupPayload(classification, line) };
  });
  if (rejected.length) console.warn("product lookup token rejected", { lines: rejected, fingerprint: clientFp });

  // Validates priorities, submits, then records each line's product snapshot —
  // one transaction (migrations 20261006000100 and 20261008000100).
  const { data, error } = await admin.rpc("submit_requisition_with_product", {
    p_token: token,
    p_payload: { ...payload, items },
    p_files: cleanFiles,
    p_fingerprint: clientFp,
  });
  if (error) {
    // Messages raised by our validation functions are user-facing; others are not.
    if (error.code !== "P0001") console.error("submit_requisition_with_product failed", { code: error.code, message: error.message });
    return { ok: false, error: error.code === "P0001" ? error.message : GENERIC };
  }
  const result = data as SubmissionSummary & { id: string };
  after(() => notifyRequisitionSubmitted(result.id));
  schedulePushDispatch();
  return {
    ok: true,
    data: {
      requisition_number: result.requisition_number,
      submitted_at: result.submitted_at,
      needed_by: result.needed_by,
      department_name: result.department_name,
      subcategory_name: result.subcategory_name,
      request_type_name: result.request_type_name,
      estimated_total: result.estimated_total,
      status: result.status,
      items: result.items,
    },
  };
}
