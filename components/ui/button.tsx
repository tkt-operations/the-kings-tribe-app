import Link from "next/link";
import { forwardRef } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "gold" | "secondary" | "ghost" | "danger";
type Size = "md" | "sm" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors select-none " +
  "disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap";

const variants: Record<Variant, string> = {
  // Navy surface, Royal Gold call-to-action text (brand guidance)
  primary: "bg-navy text-gold hover:bg-navy/90 active:bg-navy",
  // Royal Gold surface with navy text — the most prominent action on a page
  gold: "bg-gold text-navy hover:bg-gold/90 active:bg-gold",
  secondary: "bg-white text-navy ring-1 ring-inset ring-navy/20 hover:bg-navy/5",
  ghost: "text-navy hover:bg-navy/5",
  danger: "bg-white text-navy ring-1 ring-inset ring-energy-orange hover:bg-energy-orange/10",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-4 text-[15px]",
  lg: "h-13 px-6 text-base",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", className, type = "button", ...props },
  ref,
) {
  return <button ref={ref} type={type} className={cn(base, variants[variant], sizes[size], className)} {...props} />;
});

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  className,
  children,
  ...props
}: { href: string; variant?: Variant; size?: Size } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  return (
    <Link href={href} className={cn(base, variants[variant], sizes[size], className)} {...props}>
      {children}
    </Link>
  );
}
