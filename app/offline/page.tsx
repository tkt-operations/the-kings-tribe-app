import { Logo } from "@/components/brand/logo";

export const metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main className="brand-pattern flex min-h-dvh items-center justify-center bg-navy px-6 text-center text-white">
      <div className="max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo variant="primary-gold-on-navy" height={96} />
        </div>
        <h1 className="font-serif text-3xl">You&rsquo;re offline</h1>
        <p className="mt-3 text-white/75">
          Financial information is never stored on this device. Reconnect to the internet to continue.
        </p>
      </div>
    </main>
  );
}
