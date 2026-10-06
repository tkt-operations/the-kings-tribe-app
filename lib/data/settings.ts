import "server-only";

import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface ChurchSettings {
  church_name: string;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  currency_code: string;
  timezone: string;
  finance_notification_email: string | null;
  requisition_policy: string;
  po_instructions: string;
  po_footer: string;
  setup_completed_at: string | null;
}

export const SETTINGS_COLUMNS =
  "church_name, address_line1, address_line2, city, region, postal_code, country, phone, email, website, currency_code, timezone, finance_notification_email, requisition_policy, po_instructions, po_footer, setup_completed_at";

/** Church settings as visible to the signed-in user (RLS applies). */
export const getChurchSettings = cache(async (): Promise<ChurchSettings | null> => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("church_settings").select(SETTINGS_COLUMNS).eq("id", 1).maybeSingle();
  return (data as ChurchSettings | null) ?? null;
});

export function formatAddress(s: Pick<ChurchSettings, "address_line1" | "address_line2" | "city" | "region" | "postal_code" | "country">): string[] {
  const cityLine = [s.city, [s.region, s.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [s.address_line1, s.address_line2, cityLine, s.country].filter((v): v is string => Boolean(v && v.trim()));
}
