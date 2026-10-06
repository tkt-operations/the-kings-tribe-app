import { RequisitionForm } from "@/app/request/[token]/requisition-form";
import { Logo } from "@/components/brand/logo";
import { previewFormContext } from "../fixtures";
import { devOnly } from "../guard";

export default function PreviewRequest() {
  devOnly();
  return (
    <div className="min-h-dvh bg-neutral-gray">
      <header className="brand-pattern relative bg-navy" style={{ paddingTop: "calc(var(--safe-top) + 1.75rem)" }}>
        <div className="relative mx-auto max-w-3xl px-5 pb-24 sm:px-8">
          <Logo variant="landscape-gold-on-navy" height={44} />
          <div className="mt-6 text-white">
            <h1 className="font-serif text-[2.1rem] leading-tight sm:text-5xl">Requisition request</h1>
            <p className="mt-3 text-white/70">The Kings Tribe</p>
            <p className="mt-4 text-sm text-white/65">100 Example Avenue, Springfield, IL 62701 · (555) 010-0000 · finance@example.org</p>
          </div>
        </div>
      </header>
      <main className="relative mx-auto -mt-16 max-w-3xl px-4 pb-12 sm:px-8">
        <RequisitionForm token={"x".repeat(43)} context={previewFormContext} stamp="0.preview" />
      </main>
    </div>
  );
}
