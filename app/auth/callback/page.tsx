import { Suspense } from "react";
import { AuthCallback } from "./auth-callback";

export const metadata = { title: "Verify your link", robots: { index: false, follow: false } };

export default function AuthCallbackPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-gray px-6">
      <Suspense>
        <AuthCallback />
      </Suspense>
    </main>
  );
}
