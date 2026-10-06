"use client";

import { useState } from "react";
import { Archive, ArchiveRestore, Pencil, Plus } from "lucide-react";
import { IconButton } from "@/components/config/manage-list";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, RequiredNote, Select } from "@/components/ui/field";
import { useFieldErrors } from "@/components/ui/form-feedback";
import { LoadingButton } from "@/components/ui/submit-button";
import { useAction } from "@/components/ui/use-action";
import { rules, validate } from "@/lib/validation/form";
import { saveCostCenter, setCostCenterActive } from "./actions";

const CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/;

interface CostCenter {
  id: string;
  code: string;
  name: string;
  department_id: string | null;
  is_active: boolean;
}

export function CostCenterManager({ costCenters, departments }: { costCenters: CostCenter[]; departments: { id: string; name: string }[] }) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const { pending, error, run } = useAction();
  const fields = useFieldErrors();
  const deptName = (id: string | null) => departments.find((d) => d.id === id)?.name ?? "All departments";
  const startEditing = (key: string | "new" | null) => {
    fields.setErrors({});
    setEditing(key);
  };

  function submit(id: string | null, form: HTMLFormElement) {
    const fd = new FormData(form);
    const code = String(fd.get("code") ?? "");
    const name = String(fd.get("name") ?? "");
    const errors = validate({
      cc_code: [code, rules.required("Code is required."), (v) => (CODE.test(v.trim()) ? null : "Codes use letters, numbers, dot, dash or underscore (max 20).")],
      cc_name: [name, rules.required("Name is required."), rules.maxLength(80, "Keep names under 80 characters.")],
    });
    if (!fields.check(errors, form)) return;
    run(() => saveCostCenter(id, { code, name, department_id: (fd.get("department_id") as string) || null }), {
      successMessage: id ? "Cost center updated successfully." : "Cost center created successfully.",
      onSuccess: () => setEditing(null),
    });
  }

  const formFor = (cc: CostCenter | null) => (
    <form
      className="space-y-2"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit(cc?.id ?? null, e.currentTarget);
      }}
    >
      <RequiredNote className="text-[13px]" />
      <div className="grid items-start gap-2 sm:grid-cols-[8rem_1fr_14rem_auto]">
        <Field label="Code" htmlFor="cc_code" required error={fields.errors.cc_code}>
          <Input name="code" defaultValue={cc?.code} placeholder="e.g. 4100" maxLength={20} onChange={() => fields.clear("cc_code")} />
        </Field>
        <Field label="Budget line name" htmlFor="cc_name" required error={fields.errors.cc_name}>
          <Input name="name" defaultValue={cc?.name} maxLength={80} onChange={() => fields.clear("cc_name")} />
        </Field>
        <Field label="Department" htmlFor="cc_department">
          <Select name="department_id" defaultValue={cc?.department_id ?? ""}>
            <option value="">All departments</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </Field>
        <div className="flex gap-2 sm:pt-7">
          <LoadingButton type="submit" pending={pending} pendingLabel="Saving…" className="h-12">Save</LoadingButton>
          <Button type="button" variant="ghost" className="h-12" onClick={() => startEditing(null)}>Cancel</Button>
        </div>
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
                  <IconButton label={`Edit ${cc.name}`} onClick={() => startEditing(cc.id)}><Pencil className="size-4" /></IconButton>
                  <IconButton
                    label={cc.is_active ? `Archive ${cc.name}` : `Restore ${cc.name}`}
                    disabled={pending}
                    onClick={() => run(() => setCostCenterActive(cc.id, !cc.is_active), { successMessage: `${cc.name} ${cc.is_active ? "archived" : "restored"} successfully.` })}
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
        <Button onClick={() => startEditing("new")}><Plus className="size-4" aria-hidden /> Add cost center</Button>
      ) : null}
    </div>
  );
}
