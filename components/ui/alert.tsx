import { cn } from "@/lib/cn";

type Tone = "info" | "success" | "warning" | "error";

const styles: Record<Tone, string> = {
  info: "border-ministry-blue/25 bg-ministry-blue/[0.06]",
  success: "border-kingdom-green/25 bg-kingdom-green/[0.07]",
  warning: "border-gold/60 bg-gold/15",
  error: "border-energy-orange/50 bg-energy-orange/[0.07]",
};

const markers: Record<Tone, string> = {
  info: "bg-ministry-blue",
  success: "bg-kingdom-green",
  warning: "bg-gold",
  error: "bg-energy-orange",
};

export function Alert({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: Tone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("flex gap-3 rounded-2xl border p-4 text-sm text-navy", styles[tone], className)}>
      <span aria-hidden className={cn("mt-1 size-2.5 shrink-0 rounded-full", markers[tone])} />
      <div className="min-w-0 space-y-1">
        {title ? <p className="font-bold">{title}</p> : null}
        {children ? <div className="leading-relaxed text-navy/80">{children}</div> : null}
      </div>
    </div>
  );
}
