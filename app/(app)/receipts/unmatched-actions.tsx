"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { useAction } from "@/components/ui/use-action";
import { assignUnmatchedReceipt, rejectUnmatchedReceipt } from "./actions";

export function UnmatchedActions({ receiptId }: { receiptId: string }) {
  const [number, setNumber] = useState("");
  const { pending, error, message, run } = useAction();
  return (
    <div className="mt-3 space-y-2">
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); run(() => assignUnmatchedReceipt(receiptId, number)); }}>
        <Input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="TKT-REQ-2026-0001" aria-label="Requisition number" className="h-11 max-w-xs uppercase" autoCapitalize="characters" />
        <Button type="submit" size="sm" className="h-11" disabled={pending || !number.trim()}>Assign</Button>
        <Button type="button" size="sm" variant="ghost" className="h-11" disabled={pending}
          onClick={() => { const reason = window.prompt("Why reject this receipt? (e.g. spam, duplicate)"); if (reason) run(() => rejectUnmatchedReceipt(receiptId, reason)); }}>
          Reject
        </Button>
      </form>
      {error || message ? <p className="text-sm font-medium">{error ?? message}</p> : null}
    </div>
  );
}
