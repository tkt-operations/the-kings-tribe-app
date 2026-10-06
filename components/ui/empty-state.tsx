export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-[var(--radius-card)] border border-dashed border-navy/20 bg-white/60 px-6 py-12 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element -- official logomark, original file */}
      <img src="/brand/logomark-navy.svg" alt="" className="mb-4 h-10 w-auto opacity-20" />
      <p className="font-serif text-xl text-navy">{title}</p>
      {children ? <div className="mt-2 max-w-md text-sm text-navy/60">{children}</div> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
