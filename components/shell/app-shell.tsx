"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LogOut, MoreHorizontal, X } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/cn";
import { BellButton, NotificationPanel, useNotificationBell } from "@/components/notifications/notification-bell";
import type { NavItem } from "./nav-config";
import { NavIcon } from "./nav-icon";

interface ShellUser {
  fullName: string;
  email: string;
  roleNames: string[];
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

export function AppShell({
  nav,
  user,
  notifications,
  children,
}: {
  nav: NavItem[];
  user: ShellUser;
  notifications: { userId: string; unread: number; timeZone?: string };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const bell = useNotificationBell(notifications.userId, notifications.unread);
  const [moreOpen, setMoreOpen] = useState(false);
  const primary = nav.filter((n) => n.mobilePrimary).slice(0, 3);
  const overflow = nav.filter((n) => !primary.includes(n));

  return (
    <div className="min-h-dvh lg:pl-72">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 flex-col bg-navy text-white lg:flex">
        <div className="px-7 pb-8 pt-8">
          <div className="flex items-start justify-between gap-2">
            <Link href="/dashboard" aria-label="The Kings Tribe — Dashboard">
              <Logo variant="landscape-gold-on-navy" height={46} />
            </Link>
            <BellButton bell={bell} className="-mr-3" />
          </div>
          <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.18em] text-white/45">Finance &amp; Operations</p>
        </div>
        <nav aria-label="Main" className="flex-1 space-y-0.5 overflow-y-auto px-4">
          {nav.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] transition-colors",
                  active ? "bg-white/[0.08] font-medium text-white" : "text-white/70 hover:bg-white/[0.05] hover:text-white",
                )}
              >
                <span
                  aria-hidden
                  className={cn("absolute left-0 top-2.5 h-6 w-[3px] rounded-r bg-gold transition-opacity", active ? "opacity-100" : "opacity-0")}
                />
                <NavIcon name={item.icon} className={cn("size-5", active ? "text-gold" : "text-white/60")} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <UserCard user={user} />
      </aside>

      {/* Mobile header */}
      <header
        className="sticky top-0 z-30 flex items-center justify-between bg-navy px-4 pb-3 text-white lg:hidden"
        style={{ paddingTop: "calc(var(--safe-top) + 0.75rem)" }}
      >
        <Link href="/dashboard" aria-label="The Kings Tribe — Dashboard">
          <Logo variant="landscape-gold-on-navy" height={32} />
        </Link>
        <div className="flex items-center gap-1">
          <BellButton bell={bell} />
          <form action="/auth/signout" method="post">
            <button type="submit" className="flex size-11 items-center justify-center rounded-xl text-white/80 hover:bg-white/10" aria-label="Sign out">
              <LogOut className="size-5" aria-hidden />
            </button>
          </form>
        </div>
      </header>

      <NotificationPanel bell={bell} timeZone={notifications.timeZone} />

      <main
        className="mx-auto w-full max-w-7xl px-4 pb-32 pt-6 sm:px-6 lg:px-10 lg:pb-16 lg:pt-10"
        style={{ paddingLeft: "max(1rem, var(--safe-left))", paddingRight: "max(1rem, var(--safe-right))" }}
      >
        {children}
      </main>

      {/* Mobile bottom navigation */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-navy/10 bg-white/95 backdrop-blur lg:hidden"
        style={{ paddingBottom: "var(--safe-bottom)" }}
      >
        <ul className="mx-auto grid max-w-lg grid-cols-4">
          {primary.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn("flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium", active ? "text-navy" : "text-navy/55")}
                >
                  <span className={cn("flex h-8 w-14 items-center justify-center rounded-full", active && "bg-gold/30")}>
                    <NavIcon name={item.icon} className="size-5" />
                  </span>
                  {item.label.replace(" Entry", "")}
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              className={cn(
                "flex min-h-16 w-full flex-col items-center justify-center gap-1 text-[11px] font-medium",
                overflow.some((i) => isActive(pathname, i.href)) ? "text-navy" : "text-navy/55",
              )}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
            >
              <span className="flex h-8 w-14 items-center justify-center rounded-full">
                <MoreHorizontal className="size-5" aria-hidden />
              </span>
              More
            </button>
          </li>
        </ul>
      </nav>

      {moreOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="More">
          <button type="button" className="absolute inset-0 bg-navy/40" aria-label="Close menu" onClick={() => setMoreOpen(false)} />
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-white px-4 pt-3"
            style={{ paddingBottom: "calc(var(--safe-bottom) + 1rem)" }}
          >
            <div className="mb-2 flex items-center justify-between px-2">
              <p className="font-serif text-xl">More</p>
              <button type="button" onClick={() => setMoreOpen(false)} className="flex size-11 items-center justify-center rounded-xl hover:bg-navy/5" aria-label="Close">
                <X className="size-5" aria-hidden />
              </button>
            </div>
            <ul className="grid grid-cols-1 gap-1">
              {overflow.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-[15px] hover:bg-navy/5"
                  >
                    <NavIcon name={item.icon} className="size-5 text-navy/70" />
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-3 border-t border-navy/10 px-3 pt-3 text-sm text-navy/60">
              Signed in as <span className="font-medium text-navy">{user.fullName}</span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function UserCard({ user }: { user: ShellUser }) {
  return (
    <div className="border-t border-white/10 p-4">
      <div className="flex items-center gap-3 rounded-xl px-3 py-2">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gold font-bold text-navy">
          {user.fullName.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{user.fullName}</p>
          <p className="truncate text-xs text-white/55">{user.roleNames.join(", ") || user.email}</p>
        </div>
        <form action="/auth/signout" method="post">
          <button type="submit" className="flex size-9 items-center justify-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white" aria-label="Sign out">
            <LogOut className="size-4" aria-hidden />
          </button>
        </form>
      </div>
    </div>
  );
}
