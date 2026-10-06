"use client";

import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Archive, ArchiveRestore, Pencil, Plus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import type { ActionResult } from "@/lib/action-result";

export interface ManageItem {
  id: string;
  name: string;
  isActive: boolean;
  badges?: string[];
  children?: ManageItem[];
}

export interface ManageActions {
  create: (name: string, parentId: string | null) => Promise<ActionResult>;
  rename: (id: string, name: string) => Promise<ActionResult>;
  setActive: (id: string, active: boolean) => Promise<ActionResult>;
  move: (id: string, direction: "up" | "down") => Promise<ActionResult>;
}

/**
 * Create / rename / archive / reorder for any configurable list
 * (categories, departments, subcategories). Records are never deleted.
 */
export function ManageList({
  items,
  actions,
  itemNoun,
  childNoun,
  allowChildren,
  extraItemControls,
}: {
  items: ManageItem[];
  actions: ManageActions;
  itemNoun: string;
  childNoun?: string;
  allowChildren: boolean;
  extraItemControls?: (item: ManageItem) => React.ReactNode;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<ActionResult>) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) setError(result.error);
    });
  };

  return (
    <div className={cn("space-y-4", pending && "opacity-70")} aria-busy={pending}>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <ul className="divide-y divide-navy/10 rounded-2xl border border-navy/10 bg-white">
        {items.length === 0 ? <li className="p-5 text-sm text-navy/60">Nothing here yet.</li> : null}
        {items.map((item, index) => (
          <li key={item.id} className="p-3 sm:p-4">
            <Row
              item={item}
              first={index === 0}
              last={index === items.length - 1}
              onRename={(name) => run(() => actions.rename(item.id, name))}
              onToggle={() => run(() => actions.setActive(item.id, !item.isActive))}
              onMove={(d) => run(() => actions.move(item.id, d))}
              extra={extraItemControls?.(item)}
            />
            {allowChildren ? (
              <div className="mt-3 space-y-2 border-l-2 border-gold/60 pl-3 sm:ml-4 sm:pl-5">
                {(item.children ?? []).map((child, ci, arr) => (
                  <Row
                    key={child.id}
                    item={child}
                    small
                    first={ci === 0}
                    last={ci === arr.length - 1}
                    onRename={(name) => run(() => actions.rename(child.id, name))}
                    onToggle={() => run(() => actions.setActive(child.id, !child.isActive))}
                    onMove={(d) => run(() => actions.move(child.id, d))}
                  />
                ))}
                <AddForm placeholder={`Add ${childNoun ?? "subcategory"} to ${item.name}`} onAdd={(name) => run(() => actions.create(name, item.id))} small />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <AddForm placeholder={`New ${itemNoun} name`} buttonLabel={`Add ${itemNoun}`} onAdd={(name) => run(() => actions.create(name, null))} />
    </div>
  );
}

function Row({
  item,
  first,
  last,
  small,
  onRename,
  onToggle,
  onMove,
  extra,
}: {
  item: ManageItem;
  first: boolean;
  last: boolean;
  small?: boolean;
  onRename: (name: string) => void;
  onToggle: () => void;
  onMove: (d: "up" | "down") => void;
  extra?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {editing ? (
        <form
          className="flex min-w-0 flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && name.trim() !== item.name) onRename(name.trim());
            setEditing(false);
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus className="h-11" aria-label="Name" />
          <Button type="submit" size="sm" className="h-11">Save</Button>
          <Button type="button" size="sm" variant="ghost" className="h-11" onClick={() => { setName(item.name); setEditing(false); }}>Cancel</Button>
        </form>
      ) : (
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span className={cn(small ? "text-[15px]" : "text-base font-bold", !item.isActive && "text-navy/45 line-through decoration-navy/30")}>
            {item.name}
          </span>
          {!item.isActive ? <Badge>Archived</Badge> : null}
          {item.badges?.map((b) => <Badge key={b} tone="info">{b}</Badge>)}
        </div>
      )}
      {!editing ? (
        <div className="flex items-center gap-0.5">
          {extra}
          <IconButton label="Move up" disabled={first} onClick={() => onMove("up")}><ArrowUp className="size-4" /></IconButton>
          <IconButton label="Move down" disabled={last} onClick={() => onMove("down")}><ArrowDown className="size-4" /></IconButton>
          <IconButton label={`Rename ${item.name}`} onClick={() => setEditing(true)}><Pencil className="size-4" /></IconButton>
          <IconButton label={item.isActive ? `Archive ${item.name}` : `Restore ${item.name}`} onClick={onToggle}>
            {item.isActive ? <Archive className="size-4" /> : <ArchiveRestore className="size-4" />}
          </IconButton>
        </div>
      ) : null}
    </div>
  );
}

export function IconButton({ label, children, ...props }: { label: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="flex size-10 items-center justify-center rounded-lg text-navy/60 hover:bg-navy/5 hover:text-navy disabled:opacity-25 disabled:hover:bg-transparent"
      {...props}
    >
      {children}
    </button>
  );
}

function AddForm({ placeholder, buttonLabel = "Add", onAdd, small }: { placeholder: string; buttonLabel?: string; onAdd: (name: string) => void; small?: boolean }) {
  const [name, setName] = useState("");
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onAdd(name.trim());
        setName("");
      }}
    >
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder} maxLength={80} className={small ? "h-11" : undefined} aria-label={placeholder} />
      <Button type="submit" variant={small ? "secondary" : "primary"} className={small ? "h-11" : "h-12"}>
        <Plus className="size-4" aria-hidden />
        <span className={small ? "sr-only sm:not-sr-only" : undefined}>{buttonLabel}</span>
      </Button>
    </form>
  );
}
