"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Accessible modal built on the native <dialog> element (focus trapping,
 * Escape to close). Renders as a bottom sheet on phones.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        "m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-hidden rounded-t-3xl bg-white p-0 text-navy backdrop:bg-navy/50 sm:m-auto sm:rounded-3xl",
        wide ? "sm:max-w-4xl" : "sm:max-w-xl",
      )}
    >
      {open ? (
        <div className="flex max-h-[92dvh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-navy/10 px-5 py-4 sm:px-6">
            <div>
              <h2 className="font-serif text-2xl">{title}</h2>
              {description ? <p className="mt-1 text-sm text-navy/65">{description}</p> : null}
            </div>
            <button type="button" onClick={onClose} className="flex size-11 shrink-0 items-center justify-center rounded-xl hover:bg-navy/5" aria-label="Close">
              <X className="size-5" aria-hidden />
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-5 sm:px-6" style={{ paddingBottom: "calc(var(--safe-bottom) + 1.25rem)" }}>
            {children}
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
