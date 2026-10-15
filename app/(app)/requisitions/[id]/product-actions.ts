"use server";

import { z } from "zod";
import { assertPermission } from "@/lib/auth";
import { toActionError, type ActionResult } from "@/lib/action-result";
import { LOOKUP_INVALID_URL, LOOKUP_RATE_LIMITED, runProductLookup } from "@/lib/product/lookup-service";
import { LOOKUP_RATE_LIMITS, type ProductLookupResponse } from "@/lib/product/types";
import { checkProductUrl } from "@/lib/product/url";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * "Get details" inside the amendment form: the same best-effort lookup as the
 * request form (lib/product/lookup-service), for staff who may amend. Rate
 * limited per user and per vendor domain. Amendments record no lookup
 * evidence, so no token is issued.
 */
export async function getAmendmentProductDetails(requisitionId: string, url: string): Promise<ActionResult<ProductLookupResponse>> {
  try {
    const user = await assertPermission("requisitions.amend");
    if (!user.permissions.has("requisitions.view")) return { ok: false, error: "You do not have permission to do that." };
    z.uuid().parse(requisitionId);
    if (typeof url !== "string" || !checkProductUrl(url).ok) return { ok: false, error: LOOKUP_INVALID_URL };

    const admin = createSupabaseAdminClient();
    const allow = async (bucket: string, max: number) => {
      const { data, error } = await admin.rpc("consume_rate_limit", { p_bucket: bucket, p_max: max, p_window_seconds: LOOKUP_RATE_LIMITS.windowSeconds });
      return !error && data === true;
    };
    if (!(await allow(`product:user:${user.id}`, LOOKUP_RATE_LIMITS.perClient))) return { ok: false, error: LOOKUP_RATE_LIMITED };
    return runProductLookup(url, allow, () => null);
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: "Requisition not found." };
    return toActionError(e);
  }
}
