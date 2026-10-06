import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const NOTICES: Record<string, string> = {
  "password-updated": "Your password has been updated. Please sign in.",
  "signed-out": "You have been signed out.",
  "link-invalid": "That link is invalid or has expired. Request a new one.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (!isSupabaseConfigured()) redirect("/setup");
  const params = await searchParams;
  const next = typeof params.next === "string" ? safeRedirectPath(params.next) : undefined;
  if (await getSessionUser()) redirect(next ?? "/dashboard");
  const notice = typeof params.notice === "string" ? NOTICES[params.notice] : undefined;
  return (
    <>
      <h1 className="gold-rule font-serif text-4xl text-navy">Sign in</h1>
      <p className="mb-8 mt-5 text-navy/65">For authorized church staff only. Department leads use the requisition link they were sent.</p>
      <LoginForm next={next} notice={notice} />
    </>
  );
}
