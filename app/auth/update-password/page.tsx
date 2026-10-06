import { redirect } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { UpdatePasswordForm } from "./update-password-form";

export const metadata = { title: "Choose a password" };

export default async function UpdatePasswordPage() {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login?notice=link-invalid");
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", auth.user.id).maybeSingle();

  return (
    <main className="flex min-h-dvh items-start justify-center bg-neutral-gray px-5 py-12 sm:items-center">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo variant="primary-navy" height={84} />
        </div>
        <h1 className="gold-rule font-serif text-4xl text-navy">Choose your password</h1>
        <p className="mb-8 mt-5 text-navy/65">Signed in as {auth.user.email}. Use at least 12 characters.</p>
        <UpdatePasswordForm defaultName={(profile?.full_name as string) ?? ""} />
      </div>
    </main>
  );
}
