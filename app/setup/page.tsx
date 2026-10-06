import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Alert } from "@/components/ui/alert";
import { isSupabaseConfigured } from "@/lib/env";
import { createSupabaseAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/server-env";
import { SetupForm } from "./setup-form";

export const metadata = { title: "Set up" };
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const missing: string[] = [];
  if (!isSupabaseConfigured()) missing.push("NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  if (!isAdminClientConfigured()) missing.push("SUPABASE_SECRET_KEY");
  if (serverEnv().setupToken.length < 24) missing.push("SETUP_TOKEN (24+ characters)");

  let adminExists = false;
  let databaseError = false;
  if (missing.length === 0) {
    const { data, error } = await createSupabaseAdminClient().rpc("administrator_exists");
    adminExists = Boolean(data);
    databaseError = Boolean(error);
  }

  return (
    <main className="flex min-h-dvh items-start justify-center bg-neutral-gray px-5 py-12 sm:items-center">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo variant="primary-navy" height={84} />
        </div>
        <h1 className="gold-rule font-serif text-4xl text-navy">First-time setup</h1>
        {missing.length > 0 ? (
          <div className="mt-8 space-y-4">
            <Alert tone="warning" title="Server configuration is incomplete">
              Add these environment variables, then reload this page:
              <ul className="mt-2 list-disc pl-5 font-mono text-[13px]">
                {[...new Set(missing)].map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </Alert>
            <p className="text-sm text-navy/65">Step-by-step instructions are in SETUP-GUIDE.md.</p>
          </div>
        ) : databaseError ? (
          <Alert tone="error" title="The database is not ready" className="mt-8">
            The migrations have not been applied yet. Follow &ldquo;Database setup&rdquo; in SETUP-GUIDE.md.
          </Alert>
        ) : adminExists ? (
          <div className="mt-8 space-y-4">
            <Alert tone="success" title="Setup is complete">An administrator already exists.</Alert>
            <Link href="/login" className="font-medium underline decoration-gold decoration-2 underline-offset-4">Go to sign in</Link>
          </div>
        ) : (
          <>
            <p className="mb-8 mt-5 text-navy/65">
              Create the first Administrator account. This page only works once and requires the secret setup token.
            </p>
            <SetupForm />
          </>
        )}
      </div>
    </main>
  );
}
