"use client";

import { useState, useTransition } from "react";
import { Archive, ArchiveRestore, Pencil, Plus } from "lucide-react";
import { IconButton } from "@/components/config/manage-list";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { saveCostCenter, setCostCenterActive } from "./actions";

interface CostCenter {
  id: string;
  code: string;
  name: string;
  department_id: string | null;
  is_active: boolean;
}

export function CostCenterManager({ costCenters, departments }: { costCenters: CostCenter[]; departments: { id: string; name: string }[] }) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const deptName = (id: string | null) => departments.find((d) => d.id === id)?.name ?? "All departments";

  function submit(id: string | null, form: HTMLFormElement) {
    const fd = new FormData(form);
    setError(null);
    startTransition(async () => {
      const result = await saveCostCenter(id, {
        code: String(fd.get("code") ?? ""),
        name: String(fd.get("name") ?? ""),
        department_id: (fd.get("department_id") as string) || null,
      });
      if (result.ok) setEditing(null);
      else setError(result.error);
    });
  }

  const formFor = (cc: CostCenter | null) => (
    <form
      className="grid gap-2 sm:grid-cols-[8rem_1fr_14rem_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        submit(cc?.id ?? null, e.currentTarget);
      }}
    >
      <Input name="code" defaultValue={cc?.code} placeholder="Code" aria-label="Code" required maxLength={20} />
      <Input name="name" defaultValue={cc?.name} placeholder="Budget line name" aria-label="Name" required maxLength={80} />
      <Select name="department_id" defaultValue={cc?.department_id ?? ""} aria-label="Department">
        <option value="">All departments</option>
        {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </Select>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending} className="h-12">Save</Button>
        <Button type="button" variant="ghost" className="h-12" onClick={() => setEditing(null)}>Cancel</Button>
      </div>
    </form>
  );

  return (
    <div className="space-y-4">
      {error ? <Alert tone="error">{error}</Alert> : null}
      <ul className="divide-y divide-navy/10 rounded-2xl border border-navy/10 bg-white">
        {costCenters.map((cc) => (
          <li key={cc.id} className="p-3 sm:p-4">
            {editing === cc.id ? formFor(cc) : (
              <div className="flex flex-wrap items-center gap-3">
                <span className="tabular rounded-md bg-navy px-2 py-1 font-mono text-xs text-gold">{cc.code}</span>
                <span className={cc.is_active ? "font-bold" : "font-bold text-navy/45 line-through"}>{cc.name}</span>
                <span className="text-sm text-navy/55">{deptName(cc.department_id)}</span>
                {!cc.is_active ? <Badge>Archived</Badge> : null}
                <span className="ml-auto flex">
                  <IconButton label={`Edit ${cc.name}`} onClick={() => setEditing(cc.id)}><Pencil className="size-4" /></IconButton>
                  <IconButton
                    label={cc.is_active ? `Archive ${cc.name}` : `Restore ${cc.name}`}
                    onClick={() => startTransition(async () => {
                      const r = await setCostCenterActive(cc.id, !cc.is_active);
                      if (!r.ok) setError(r.error);
                    })}
                  >
                    {cc.is_active ? <Archive className="size-4" /> : <ArchiveRestore className="size-4" />}
                  </IconButton>
                </span>
              </div>
            )}
          </li>
        ))}
        {editing === "new" ? <li className="p-3 sm:p-4">{formFor(null)}</li> : null}
      </ul>
      {editing !== "new" ? (
        <Button onClick={() => setEditing("new")}><Plus className="size-4" aria-hidden /> Add cost center</Button>
      ) : null}
    </div>
  );
}
