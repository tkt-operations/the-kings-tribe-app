"use client";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { LoadingButton } from "@/components/ui/submit-button";

/** In-app replacement for window.confirm(), with a loading state on the confirm button. */
export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  pendingLabel,
  pending = false,
  danger = false,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel?: string;
  pending?: boolean;
  danger?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title} description={description}>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
        <LoadingButton variant={danger ? "danger" : "primary"} pending={pending} pendingLabel={pendingLabel} onClick={onConfirm}>
          {confirmLabel}
        </LoadingButton>
      </div>
    </Dialog>
  );
}
