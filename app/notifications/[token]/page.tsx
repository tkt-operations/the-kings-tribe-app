import type { Metadata } from "next";
import { Logo } from "@/components/brand/logo";
import { createSupabaseAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import { PreferencesForm } from "./preferences-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Update preferences", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function NotificationPreferencesPage({ params }: PageProps<"/notifications/[token]">) {
  const { token } = await params;
  type Prefs = { email_opt_in: boolean; sms_opt_in: boolean; requisitions: { requisition_number: string } | null };
  let prefs: Prefs | null = null;
  if (/^[0-9a-f]{48}$/.test(token) && isAdminClientConfigured()) {
    const { data } = await createSupabaseAdminClient()
      .from("notification_preferences")
      .select("email_opt_in, sms_opt_in, requisitions(requisition_number)")
      .eq("manage_token", token)
      .maybeSingle();
    prefs = (data as Prefs | null) ?? null;
  }
  return (
    <main className="flex min-h-dvh items-start justify-center bg-neutral-gray px-5 py-12 sm:items-center">
      <div className="w-full max-w-md rounded-[var(--radius-card)] bg-white p-8 ring-1 ring-navy/10">
        <Logo variant="primary-navy" height={72} className="mx-auto mb-6" />
        {prefs ? (
          <>
            <h1 className="gold-rule font-serif text-3xl">Update preferences</h1>
            <p className="mb-6 mt-4 text-navy/70">For requisition <strong className="tabular">{prefs.requisitions?.requisition_number}</strong>. Important messages such as Purchase Orders may still be sent by email.</p>
            <PreferencesForm token={token} email={prefs.email_opt_in} sms={prefs.sms_opt_in} />
          </>
        ) : (
          <>
            <h1 className="font-serif text-3xl">Link not valid</h1>
            <p className="mt-3 text-navy/70">This preferences link is not valid. Please use the link from your most recent email.</p>
          </>
        )}
      </div>
    </main>
  );
}
