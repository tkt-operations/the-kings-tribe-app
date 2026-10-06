"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { EmailOtpType } from "@supabase/supabase-js";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/submit-button";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { safeRedirectPath } from "@/lib/safe-redirect";

const OTP_TYPES: EmailOtpType[] = ["invite", "recovery", "signup", "magiclink", "email", "email_change"];

/**
 * Handles every Supabase email-link format:
 *   ?token_hash=…&type=invite|recovery   (recommended email templates)
 *   ?code=…                               (PKCE)
 *   #access_token=…&refresh_token=…       (default templates / implicit flow)
 */
export function AuthCallback() {
  const router = useRouter();
  const params = useSearchParams();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const next = safeRedirectPath(params.get("next"), "/auth/update-password");

    async function run() {
      const tokenHash = params.get("token_hash");
      const type = params.get("type") as EmailOtpType | null;
      const code = params.get("code");
      const hash = new URLSearchParams(window.location.hash.slice(1));

      let error: unknown = null;
      if (tokenHash && type && OTP_TYPES.includes(type)) {
        ({ error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type }));
      } else if (code) {
        ({ error } = await supabase.auth.exchangeCodeForSession(code));
      } else if (hash.get("access_token") && hash.get("refresh_token")) {
        ({ error } = await supabase.auth.setSession({
          access_token: hash.get("access_token")!,
          refresh_token: hash.get("refresh_token")!,
        }));
      } else {
        error = new Error("missing token");
      }
      if (error) {
        setFailed(true);
        return;
      }
      window.history.replaceState(null, "", window.location.pathname);
      router.replace(next);
      router.refresh();
    }
    void run();
  }, [params, router]);

  if (failed) {
    return (
      <div className="w-full max-w-md space-y-4">
        <Alert tone="error" title="This link is invalid or has expired">
          Ask an administrator to resend your invitation, or request a new password reset.
        </Alert>
        <a href="/login" className="block text-center font-medium underline decoration-gold decoration-2 underline-offset-4">Go to sign in</a>
      </div>
    );
  }
  return (
    <p className="flex items-center gap-3 text-navy/70">
      <Spinner className="size-5" /> Verifying your link…
    </p>
  );
}
