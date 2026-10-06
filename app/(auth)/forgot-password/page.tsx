import Link from "next/link";
import { ForgotForm } from "./forgot-form";

export const metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="gold-rule font-serif text-4xl text-navy">Reset password</h1>
      <p className="mb-8 mt-5 text-navy/65">Enter your email and we&rsquo;ll send you a secure link to choose a new password.</p>
      <ForgotForm />
      <p className="mt-6 text-center text-sm">
        <Link href="/login" className="font-medium underline decoration-gold decoration-2 underline-offset-4">Back to sign in</Link>
      </p>
    </>
  );
}
