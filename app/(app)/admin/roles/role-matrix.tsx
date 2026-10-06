"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { useAction } from "@/components/ui/use-action";
import { createRole, setRolePermission } from "./actions";

interface Role { id: string; key: string; name: string }
interface Perm { key: string; group_name: string; description: string }

export function RoleMatrix({ roles, permissions, grants }: { roles: Role[]; permissions: Perm[]; grants: Record<string, string[]> }) {
  const { pending, error, run } = useAction();
  const [name, setName] = useState("");
  const groups = [...new Set(permissions.map((p) => p.group_name))];
  return (
    <div className="space-y-4">
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className={`overflow-x-auto rounded-[var(--radius-card)] bg-white ring-1 ring-navy/10 ${pending ? "opacity-70" : ""}`}>
        <table className="w-full min-w-[760px] text-sm">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-navy/10">
              <th scope="col" className="px-4 py-3 text-left font-medium text-navy/60">Permission</th>
              {roles.map((r) => <th key={r.id} scope="col" className="px-3 py-3 text-center font-bold">{r.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Group key={g} name={g} perms={permissions.filter((p) => p.group_name === g)} roles={roles} grants={grants}
                onToggle={(roleId, perm, granted) => run(() => setRolePermission(roleId, perm, granted))} />
            ))}
          </tbody>
        </table>
      </div>
      <form className="flex max-w-lg gap-2" onSubmit={(e) => { e.preventDefault(); run(() => createRole({ name }), () => setName("")); }}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New role name (e.g. Campus Lead)" aria-label="New role name" />
        <Button type="submit" disabled={!name.trim() || pending} className="h-12"><Plus className="size-4" aria-hidden /> Add role</Button>
      </form>
    </div>
  );
}

function Group({ name, perms, roles, grants, onToggle }: { name: string; perms: Perm[]; roles: Role[]; grants: Record<string, string[]>; onToggle: (roleId: string, perm: string, granted: boolean) => void }) {
  return (
    <>
      <tr className="bg-neutral-gray/60"><th colSpan={roles.length + 1} scope="rowgroup" className="px-4 py-2 text-left text-xs font-bold uppercase tracking-[0.12em] text-navy/60">{name}</th></tr>
      {perms.map((p) => (
        <tr key={p.key} className="border-b border-navy/5">
          <th scope="row" className="px-4 py-2.5 text-left font-normal">{p.description}<span className="block font-mono text-[11px] text-navy/45">{p.key}</span></th>
          {roles.map((r) => {
            const isAdmin = r.key === "administrator";
            const checked = isAdmin || (grants[r.id] ?? []).includes(p.key);
            return (
              <td key={r.id} className="px-3 py-2.5 text-center">
                <input type="checkbox" className="size-5 accent-navy" checked={checked} disabled={isAdmin} aria-label={`${r.name}: ${p.description}`}
                  onChange={(e) => onToggle(r.id, p.key, e.target.checked)} />
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
