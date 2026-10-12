"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { LoadingButton, Spinner } from "@/components/ui/submit-button";
import { callbackNext, classifyAuthError, parseAuthLink, type CallbackFailure, type SetupLinkType } from "@/lib/auth/callback-link";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type View =
  | { step: "checking" }
  | { step: "confirm"; type: SetupLinkType }
  | { step: "verifying" }
  | { step: "done" }
  | { step: "failed"; reason: CallbackFailure };

const FAILURES: Record<CallbackFailure, { title: string; body: string }> = {
  expired: {
    title: "This link has expired or has already been used",
    body: "Only the most recent link works, and each link can be used once. Ask an administrator for a new link, or request a new password reset.",
  },
  malformed: {
    title: "This link is incomplete",
    body: "Open the link from your email again, making sure the whole link is used, or request a new one.",
  },
  other_browser: {
    title: "Open this link in the browser you requested it from",
    body: "For security, this password reset link only works in the browser where you asked for it. Request a new password reset if you are on a different device.",
  },
  rate_limited: {
    title: "Too many attempts",
    body: "Please wait a minute, then try again.",
  },
  failed: {
    title: "We could not verify this link",
    body: "Please try again. If it keeps happening, ask an administrator for a new link.",
  },
};

/**
 * The single owner of auth-link processing (the SDK's detectSessionInUrl is
 * off — see lib/supabase/browser.ts). Each link is processed at most once per
 * page load: a ref guards the effect (React Strict Mode runs effects twice in
 * development) and the Continue button.
 *
 *  - token_hash (canonical): nothing is verified on load. The person presses
 *    Continue, which calls verifyOtp once. Link-preview bots never press it.
 *  - ?code= (PKCE Forgot password): exchanged once, automatically — it only
 *    succeeds with the verifier stored in the requesting browser, so a bot
 *    cannot use it.
 *  - #access_token (raw Supabase links already sent): session set once.
 *
 * The secret part of the URL is removed from the address bar immediately.
 */
export function AuthCallback() {
  const router = useRouter();
  const [view, setView] = useState<View>({ step: "checking" });
  const started = useRef(false);
  const pending = useRef<{ tokenHash: string; type: SetupLinkType } | null>(null);
  const nextRef = useRef("/auth/update-password");

  function succeed() {
    setView({ step: "done" });
    router.replace(nextRef.current);
    router.refresh();
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const search = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const next = callbackNext(search.get("next"));
    nextRef.current = next;
    const link = parseAuthLink(search, hash);
    // Keep only the non-secret destination in the address bar and history.
    window.history.replaceState(null, "", `${window.location.pathname}?next=${encodeURIComponent(next)}`);

    const supabase = createSupabaseBrowserClient();
    void (async () => {
      switch (link.kind) {
        case "token_hash":
          pending.current = { tokenHash: link.tokenHash, type: link.type };
          setView({ step: "confirm", type: link.type });
          return;
        case "code": {
          const { error } = await supabase.auth.exchangeCodeForSession(link.code, link.flowId ? { flowId: link.flowId } : undefined);
          if (error) return setView({ step: "failed", reason: classifyAuthError(error) });
          return succeed();
        }
        case "implicit": {
          const { error } = await supabase.auth.setSession({ access_token: link.accessToken, refresh_token: link.refreshToken });
          if (error) return setView({ step: "failed", reason: classifyAuthError(error) });
          return succeed();
        }
        case "error":
          return setView({ step: "failed", reason: link.reason === "expired" ? "expired" : "failed" });
        case "malformed":
          return setView({ step: "failed", reason: "malformed" });
        case "none": {
          // Reloaded after the secret was removed: continue if already signed in.
          const { data } = await supabase.auth.getSession();
          if (data.session) return succeed();
          return setView({ step: "failed", reason: "malformed" });
        }
      }
    })();
    // Runs once per page load by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function confirm() {
    const link = pending.current;
    if (!link) return;
    pending.current = null; // one verification attempt per page load
    setView({ step: "verifying" });
    const { error } = await createSupabaseBrowserClient().auth.verifyOtp({ token_hash: link.tokenHash, type: link.type });
    if (error) return setView({ step: "failed", reason: classifyAuthError(error) });
    succeed();
  }

  if (view.step === "confirm" || view.step === "verifying") {
    const invite = view.step === "confirm" ? view.type === "invite" : false;
    return (
      <div className="w-full max-w-md space-y-5 text-center">
        <h1 className="font-serif text-3xl text-navy">{invite ? "Set up your account" : "Choose a new password"}</h1>
        <p className="text-navy/70">Press Continue to verify your link. You will then choose your password.</p>
        <LoadingButton size="lg" className="w-full" pending={view.step === "verifying"} pendingLabel="Verifying…" onClick={() => void confirm()}>Continue</LoadingButton>
      </div>
    );
  }
  if (view.step === "failed") {
    const f = FAILURES[view.reason];
    return (
      <div className="w-full max-w-md space-y-4">
        <Alert tone="error" title={f.title}>{f.body}</Alert>
        <div className="flex flex-col gap-2 text-center">
          <a href="/forgot-password" className="font-medium underline decoration-gold decoration-2 underline-offset-4">Request a new password reset</a>
          <a href="/login" className="font-medium underline decoration-gold decoration-2 underline-offset-4">Go to sign in</a>
        </div>
      </div>
    );
  }
  return (
    <p className="flex items-center gap-3 text-navy/70" role="status">
      <Spinner className="size-5" /> {view.step === "done" ? "Link verified. Taking you to choose your password…" : "Checking your link…"}
    </p>
  );
}
