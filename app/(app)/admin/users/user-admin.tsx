"use client";

import { useState } from "react";
import { Copy, UserPlus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input } from "@/components/ui/field";
import { Spinner } from "@/components/ui/submit-button";
import { useAction } from "@/components/ui/use-action";
import { inviteUser, setUserActive, setUserRole } from "./actions";

interface Role { id: string; key: string; name: string; description: string | null }
interface UserRow { id: string; email: string; full_name: string; is_active: boolean; roleIds: string[]; lastSignIn: string | null; confirmed: boolean }

export function UserAdmin({ users, roles, currentUserId }: { users: UserRow[]; roles: Role[]; currentUserId: string }) {
  const { pending, error, run } = useAction();
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><InviteDialog roles={roles} /></div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <ul className={`space-y-3 ${pending ? "opacity-70" : ""}`}>
        {users.map((u) => (
          <li key={u.id} className="rounded-[var(--radius-card)] bg-white p-4 ring-1 ring-navy/10 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-bold">{u.full_name || u.email}{u.id === currentUserId ? <span className="ml-2 text-xs font-medium text-navy/50">You</span> : null}</p>
                <p className="text-sm text-navy/60">{u.email}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {!u.is_active ? <Badge tone="negative">Deactivated</Badge> : null}
                  {!u.confirmed ? <Badge tone="attention">Invitation pending</Badge> : null}
                  {u.lastSignIn ? <span className="text-xs text-navy/50">Last sign-in {new Date(u.lastSignIn).toLocaleDateString()}</span> : null}
                </div>
              </div>
              {u.id !== currentUserId ? (
                <Button size="sm" variant={u.is_active ? "danger" : "secondary"} className="h-10" onClick={() => run(() => setUserActive(u.id, !u.is_active))}>
                  {u.is_active ? "Deactivate" : "Reactivate"}
                </Button>
              ) : null}
            </div>
            <fieldset className="mt-3">
              <legend className="sr-only">Roles for {u.full_name || u.email}</legend>
              <div className="flex flex-wrap gap-2">
                {roles.map((r) => {
                  const checked = u.roleIds.includes(r.id);
                  return (
                    <label key={r.id} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-3 text-sm ring-1 ${checked ? "bg-navy text-white ring-navy" : "ring-navy/15 hover:bg-navy/5"}`}>
                      <input type="checkbox" className="size-4 accent-gold" checked={checked} onChange={(e) => run(() => setUserRole(u.id, r.id, e.target.checked))} />
                      {r.name}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </li>
        ))}
      </ul>
    </div>
  );
}

function InviteDialog({ roles }: { roles: Role[] }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ email: "", full_name: "", role_ids: [] as string[], delivery: "email" as "email" | "link" });
  const [link, setLink] = useState<string | null>(null);
  const { pending, error, message, run } = useAction();
  return (
    <>
      <Button variant="gold" onClick={() => { setOpen(true); setLink(null); }}><UserPlus className="size-4" aria-hidden /> Invite user</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Invite a team member" description="They will choose their own password. Department leads do not need accounts — send them a requisition link instead.">
        {link ? (
          <div className="space-y-4">
            <Alert tone="success" title="Invitation link created">{message}</Alert>
            <Input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Invitation link" />
            <Button onClick={() => navigator.clipboard?.writeText(link)}><Copy className="size-4" aria-hidden /> Copy link</Button>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(() => inviteUser(v), (data) => { if (data?.link) setLink(data.link); else setOpen(false); }); }}>
            {error ? <Alert tone="error">{error}</Alert> : null}
            <Field label="Full name" htmlFor="inv_name"><Input id="inv_name" value={v.full_name} onChange={(e) => setV({ ...v, full_name: e.target.value })} required /></Field>
            <Field label="Email" htmlFor="inv_email"><Input id="inv_email" type="email" inputMode="email" autoCapitalize="none" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} required /></Field>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Roles</legend>
              <div className="space-y-2">
                {roles.map((r) => (
                  <label key={r.id} className="flex gap-3 rounded-xl p-2 hover:bg-navy/5">
                    <Checkbox checked={v.role_ids.includes(r.id)} onChange={(e) => setV({ ...v, role_ids: e.target.checked ? [...v.role_ids, r.id] : v.role_ids.filter((x) => x !== r.id) })} className="mt-0.5" />
                    <span><span className="block font-medium">{r.name}</span>{r.description ? <span className="block text-sm text-navy/60">{r.description}</span> : null}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">How should they receive it?</legend>
              <label className="flex items-center gap-2 text-sm"><input type="radio" className="accent-navy" checked={v.delivery === "email"} onChange={() => setV({ ...v, delivery: "email" })} /> Send an invitation email</label>
              <label className="mt-1 flex items-center gap-2 text-sm"><input type="radio" className="accent-navy" checked={v.delivery === "link"} onChange={() => setV({ ...v, delivery: "link" })} /> Give me a link to send myself</label>
            </fieldset>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={pending}>{pending ? <Spinner /> : null}Invite</Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
