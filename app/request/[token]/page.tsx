import type { Metadata } from "next";
import { Logo } from "@/components/brand/logo";
import { loadFormContext } from "@/lib/data/form-context";
import { formatAddress } from "@/lib/data/settings";
import { issueFormStamp } from "@/lib/spam";
import { RequisitionForm } from "./requisition-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Requisition request",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function ExternalRequisitionPage({ params }: PageProps<"/request/[token]">) {
  const { token } = await params;
  const context = await loadFormContext(token);

  if (!context) {
    return (
      <Shell>
        <div className="mx-auto max-w-lg rounded-[var(--radius-card)] bg-white p-8 text-center">
          <h1 className="font-serif text-3xl">This link isn&rsquo;t active</h1>
          <p className="mt-3 text-navy/70">
            The requisition link may have expired or been replaced. Please ask the Finance team for a current link.
          </p>
        </div>
      </Shell>
    );
  }

  const address = formatAddress(context.church);
  return (
    <Shell
      header={
        <div className="mt-6 text-white">
          <h1 className="font-serif text-[2.1rem] leading-tight sm:text-5xl">Requisition request</h1>
          <p className="mt-3 max-w-xl text-white/70">{context.church.name}</p>
          <dl className="mt-4 grid gap-x-8 gap-y-1 text-sm text-white/65 sm:grid-cols-2">
            {address.length ? (
              <div>
                <dt className="sr-only">Address</dt>
                <dd>{address.join(", ")}</dd>
              </div>
            ) : null}
            {context.church.phone || context.church.email ? (
              <div>
                <dt className="sr-only">Contact</dt>
                <dd>{[context.church.phone, context.church.email].filter(Boolean).join(" · ")}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      }
    >
      <RequisitionForm token={token} context={context} stamp={issueFormStamp()} />
    </Shell>
  );
}

function Shell({ children, header }: { children: React.ReactNode; header?: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-neutral-gray">
      <header className="brand-pattern relative bg-navy" style={{ paddingTop: "calc(var(--safe-top) + 1.75rem)" }}>
        <div className="absolute inset-0 bg-navy/[0.93]" aria-hidden />
        <div className="relative mx-auto max-w-3xl px-5 pb-24 sm:px-8">
          <Logo variant="landscape-gold-on-navy" height={44} />
          {header}
        </div>
      </header>
      <main className="relative mx-auto -mt-16 max-w-3xl px-4 sm:px-8" style={{ paddingBottom: "calc(var(--safe-bottom) + 3rem)" }}>
        {children}
      </main>
    </div>
  );
}
