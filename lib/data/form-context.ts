import "server-only";

import { createSupabaseAnonClient } from "@/lib/supabase/server";

export interface FormContext {
  church: {
    name: string;
    address_line1: string | null;
    address_line2: string | null;
    city: string | null;
    region: string | null;
    postal_code: string | null;
    country: string | null;
    phone: string | null;
    email: string | null;
  };
  policy: string;
  currency: string;
  timezone: string;
  today: string;
  restricted_department_id: string | null;
  departments: { id: string; name: string; subcategories: { id: string; name: string }[] }[];
  request_types: {
    id: string;
    key: string;
    name: string;
    description: string | null;
    help_text: string | null;
    workflow: string;
    is_default: boolean;
    requires_receipt_on_submission: boolean;
    requires_purchase_details: boolean;
    requires_cost_center: boolean;
    max_total: string | null;
  }[];
  cost_centers: { id: string; code: string; name: string; department_id: string | null }[];
}

export { FORM_TOKEN_PATTERN } from "@/lib/validation/form-token";
import { FORM_TOKEN_PATTERN } from "@/lib/validation/form-token";

/** Loads the public form context with the ANON key (database checks the token). */
export async function loadFormContext(token: string): Promise<FormContext | null> {
  if (!FORM_TOKEN_PATTERN.test(token)) return null;
  const { data, error } = await createSupabaseAnonClient().rpc("get_request_form_context", { p_token: token });
  if (error || !data) return null;
  return data as FormContext;
}
