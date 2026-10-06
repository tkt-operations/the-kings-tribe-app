import { Logo } from "@/components/brand/logo";

/** Split layout: navy brand panel with the official logo + light form panel. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <section
        className="brand-pattern relative flex flex-col justify-between bg-navy px-8 pb-10 text-white lg:px-14"
        style={{ paddingTop: "calc(var(--safe-top) + 2.5rem)" }}
      >
        <div className="absolute inset-0 bg-navy/[0.93]" aria-hidden />
        <div className="relative">
          <Logo variant="primary-gold-on-navy" height={112} />
        </div>
        <div className="relative mt-10 hidden lg:block">
          <p className="font-serif text-5xl leading-[1.05]">
            Faithful with
            <br />
            <span className="text-gold">every gift.</span>
          </p>
          <p className="mt-6 max-w-sm text-white/65">
            Sunday reporting, requisitions and purchasing for The Kings Tribe finance and operations team.
          </p>
        </div>
        <p className="relative mt-8 hidden text-xs uppercase tracking-[0.18em] text-white/40 lg:block">
          Faith · Formation · Leadership · Cultural Influence
        </p>
      </section>
      <main className="flex items-start justify-center bg-neutral-gray px-5 py-10 sm:items-center sm:px-10" style={{ paddingBottom: "calc(var(--safe-bottom) + 2.5rem)" }}>
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
