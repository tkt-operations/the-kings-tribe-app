"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { CheckCircle2, CircleAlert, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { FLASH_COOKIE, flashMessage } from "@/lib/flash";

export type ToastTone = "success" | "error";

export interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

/** Long enough to read a sentence; errors stay a little longer. */
export const TOAST_DURATION: Record<ToastTone, number> = { success: 6000, error: 9000 };
const MAX_VISIBLE = 4;

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** No-op fallback so components still render outside the provider (tests, previews). */
const NOOP: ToastApi = { success: () => {}, error: () => {}, dismiss: () => {} };

export function useToast(): ToastApi {
  return useContext(ToastContext) ?? NOOP;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);
  const push = useCallback((tone: ToastTone, message: string) => {
    const text = message.trim();
    if (!text) return;
    setToasts((prev) => {
      // Collapse an identical message that is still showing (e.g. a double click).
      const rest = prev.filter((t) => !(t.tone === tone && t.message === text));
      return [...rest, { id: nextId.current++, tone, message: text }].slice(-MAX_VISIBLE);
    });
  }, []);

  const api = useMemo<ToastApi>(
    () => ({ success: (m) => push("success", m), error: (m) => push("error", m), dismiss }),
    [push, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Toaster toasts={toasts} onDismiss={dismiss} />
      <FlashToasts />
    </ToastContext.Provider>
  );
}

/**
 * Viewport. It becomes a manual popover so it sits in the browser's top layer —
 * above open modal <dialog>s — and it stays mounted so screen readers have
 * stable live regions: polite for success, assertive for errors.
 */
export function Toaster({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof el.showPopover !== "function") return; // unsupported: fixed positioning still applies
    try {
      // Added only where supported, so browsers without the API never hide the viewport.
      if (!el.hasAttribute("popover")) el.setAttribute("popover", "manual");
      // Re-show to move above anything that entered the top layer since (e.g. a dialog).
      if (el.matches(":popover-open")) el.hidePopover();
      el.showPopover();
    } catch {
      // Element detached mid-update — nothing to do.
    }
  }, [toasts]);

  const successes = toasts.filter((t) => t.tone === "success");
  const errors = toasts.filter((t) => t.tone === "error");

  return (
    <section ref={ref} className="toast-viewport" aria-label="Notifications">
      <div role="alert" aria-live="assertive" aria-atomic="false" className="flex flex-col gap-2">
        {errors.map((t) => <Toast key={t.id} toast={t} onDismiss={onDismiss} />)}
      </div>
      <div role="status" aria-live="polite" aria-atomic="false" className="flex flex-col gap-2">
        {successes.map((t) => <Toast key={t.id} toast={t} onDismiss={onDismiss} />)}
      </div>
    </section>
  );
}

function Toast({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(TOAST_DURATION[toast.tone]);
  const startedAt = useRef(0);

  useEffect(() => {
    if (paused) return;
    startedAt.current = Date.now();
    const timer = window.setTimeout(() => onDismiss(toast.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(1500, remaining.current - (Date.now() - startedAt.current));
    };
  }, [paused, toast.id, onDismiss]);

  const success = toast.tone === "success";
  return (
    <div
      data-tone={toast.tone}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={cn(
        "toast-item pointer-events-auto flex w-full items-start gap-3 rounded-2xl border-l-4 bg-white py-3 pl-4 pr-2 text-[15px] text-navy",
        "shadow-lg shadow-navy/15 ring-1 ring-navy/10",
        success ? "border-l-kingdom-green" : "border-l-energy-orange",
      )}
    >
      {success ? (
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-kingdom-green" aria-hidden />
      ) : (
        <CircleAlert className="mt-0.5 size-5 shrink-0 text-energy-orange" aria-hidden />
      )}
      <p className="min-w-0 flex-1 py-0.5 font-medium leading-snug">
        <span className="sr-only">{success ? "Success: " : "Error: "}</span>
        {toast.message}
      </p>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="flex size-9 shrink-0 items-center justify-center rounded-lg text-navy/55 hover:bg-navy/5 hover:text-navy"
        aria-label="Dismiss notification"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}

/**
 * Shows a message queued by a server action that redirected (the action can't
 * return a result). The cookie holds only a key from a fixed list.
 */
function FlashToasts() {
  const pathname = usePathname();
  const toast = useToast();
  useEffect(() => {
    const match = document.cookie.split("; ").find((c) => c.startsWith(`${FLASH_COOKIE}=`));
    if (!match) return;
    document.cookie = `${FLASH_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    const message = flashMessage(decodeURIComponent(match.slice(FLASH_COOKIE.length + 1)));
    if (message) toast.success(message);
  }, [pathname, toast]);
  return null;
}
