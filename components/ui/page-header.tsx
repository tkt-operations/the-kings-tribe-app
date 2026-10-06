import { cn } from "@/lib/cn";

/** Serif page title with the brand's short gold rule. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-6 flex flex-wrap items-end justify-between gap-4 sm:mb-8", className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-navy/55">{eyebrow}</p> : null}
        <h1 className="gold-rule font-serif text-title text-navy sm:text-display">{title}</h1>
        {description ? <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-navy/70">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function SectionTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h2 className={cn("font-serif text-section text-navy", className)}>{children}</h2>;
}
