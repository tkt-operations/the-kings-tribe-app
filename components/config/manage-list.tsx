"use client";

import { useId, useState } from "react";
import { ArrowDown, ArrowUp, Archive, ArchiveRestore, Pencil, Plus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { LoadingButton } from "@/components/ui/submit-button";
import { useAction } from "@/components/ui/use-action";
import { cn } from "@/lib/cn";
import type { ActionResult } from "@/lib/action-result";
import { rules, validate } from "@/lib/validation/form";

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Same rule as the server's nameSchema. */
function nameError(name: string): string | null {
  return validate({ name: [name, rules.required("Name is required."), rules.maxLength(80, "Keep names under 80 characters.")] }).name ?? null;
}

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
  const { pending, error, run: runAction } = useAction();
  // Which control started the running request, so only it shows a spinner.
  const [active, setActive] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionResult>, successMessage: string, onSuccess?: () => void, key: string | null = null) => {
    if (runAction(fn, { successMessage, onSuccess: () => { setActive(null); onSuccess?.(); }, onError: () => setActive(null) })) setActive(key);
  };
  const busy = (key: string) => pending && active === key;
  const childLabel = childNoun ?? "subcategory";

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
              pending={pending}
              saving={busy(`rename:${item.id}`)}
              onRename={(name, done) => run(() => actions.rename(item.id, name), `${capitalize(itemNoun)} renamed successfully.`, done, `rename:${item.id}`)}
              onToggle={() => run(() => actions.setActive(item.id, !item.isActive), `${item.name} ${item.isActive ? "archived" : "restored"} successfully.`)}
              onMove={(d) => run(() => actions.move(item.id, d), "Order updated successfully.")}
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
                    pending={pending}
                    saving={busy(`rename:${child.id}`)}
                    onRename={(name, done) => run(() => actions.rename(child.id, name), `${capitalize(childLabel)} renamed successfully.`, done, `rename:${child.id}`)}
                    onToggle={() => run(() => actions.setActive(child.id, !child.isActive), `${child.name} ${child.isActive ? "archived" : "restored"} successfully.`)}
                    onMove={(d) => run(() => actions.move(child.id, d), "Order updated successfully.")}
                  />
                ))}
                <AddForm label={`Add ${childLabel} to ${item.name}`} placeholder={`New ${childLabel} name`} pending={pending} saving={busy(`add:${item.id}`)}
                  onAdd={(name, done) => run(() => actions.create(name, item.id), `${capitalize(childLabel)} added successfully.`, done, `add:${item.id}`)} small />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <AddForm label={`New ${itemNoun} name`} placeholder={`e.g. ${itemNoun === "department" ? "Hospitality" : "Building fund"}`} buttonLabel={`Add ${itemNoun}`} pending={pending} saving={busy("add:root")}
        onAdd={(name, done) => run(() => actions.create(name, null), `${capitalize(itemNoun)} added successfully.`, done, "add:root")} />
    </div>
  );
}

function Row({
  item,
  first,
  last,
  small,
  pending,
  saving,
  onRename,
  onToggle,
  onMove,
  extra,
}: {
  item: ManageItem;
  first: boolean;
  last: boolean;
  small?: boolean;
  pending: boolean;
  saving: boolean;
  onRename: (name: string, done: () => void) => void;
  onToggle: () => void;
  onMove: (d: "up" | "down") => void;
  extra?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {editing ? (
        <form
          className="flex min-w-0 flex-1 flex-wrap items-start gap-2"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const problem = nameError(name);
            if (problem) {
              setError(problem);
              (e.currentTarget.elements.namedItem("name") as HTMLInputElement | null)?.focus();
              return;
            }
            if (name.trim() === item.name) {
              setEditing(false);
              return;
            }
            // Stay in edit mode until the save succeeds, so a failure keeps the typed name.
            onRename(name.trim(), () => setEditing(false));
          }}
        >
          <Field label="Name" htmlFor={`${id}-name`} required error={error} className="min-w-0 flex-1">
            <Input name="name" value={name} onChange={(e) => { setName(e.target.value); setError(null); }} maxLength={80} autoFocus className="h-11" />
          </Field>
          <div className="flex gap-2 pt-7">
            <LoadingButton type="submit" size="sm" className="h-11" pending={saving} disabled={pending}>Save</LoadingButton>
            <Button type="button" size="sm" variant="ghost" className="h-11" onClick={() => { setName(item.name); setError(null); setEditing(false); }}>Cancel</Button>
          </div>
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
          <IconButton label="Move up" disabled={first || pending} onClick={() => onMove("up")}><ArrowUp className="size-4" /></IconButton>
          <IconButton label="Move down" disabled={last || pending} onClick={() => onMove("down")}><ArrowDown className="size-4" /></IconButton>
          <IconButton label={`Rename ${item.name}`} onClick={() => { setName(item.name); setEditing(true); }}><Pencil className="size-4" /></IconButton>
          <IconButton label={item.isActive ? `Archive ${item.name}` : `Restore ${item.name}`} disabled={pending} onClick={onToggle}>
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

function AddForm({
  label,
  placeholder,
  buttonLabel = "Add",
  pending,
  saving,
  onAdd,
  small,
}: {
  label: string;
  placeholder: string;
  buttonLabel?: string;
  pending: boolean;
  saving: boolean;
  onAdd: (name: string, done: () => void) => void;
  small?: boolean;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  return (
    <form
      className="flex items-start gap-2"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const problem = nameError(name);
        if (problem) {
          setError(problem);
          (e.currentTarget.elements.namedItem("name") as HTMLInputElement | null)?.focus();
          return;
        }
        // Clear only after success so a failed save keeps what was typed.
        onAdd(name.trim(), () => setName(""));
      }}
    >
      <Field label={label} htmlFor={`${id}-name`} required error={error} className="min-w-0 flex-1">
        <Input name="name" value={name} onChange={(e) => { setName(e.target.value); setError(null); }} placeholder={placeholder} maxLength={80} className={small ? "h-11" : undefined} />
      </Field>
      <LoadingButton type="submit" variant={small ? "secondary" : "primary"} className={cn("mt-7", small ? "h-11" : "h-12")} pending={saving} disabled={pending} icon={<Plus className="size-4" aria-hidden />}>
        <span className={small ? "sr-only sm:not-sr-only" : undefined}>{buttonLabel}</span>
      </LoadingButton>
    </form>
  );
}
