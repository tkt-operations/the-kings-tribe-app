"use client";

import { useRef, useState } from "react";
import { Copy, Link2, Mail, UserPlus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, FieldError, Input, RequiredMark, RequiredNote } from "@/components/ui/field";
import { useFieldErrors } from "@/components/ui/form-feedback";
import { LoadingButton } from "@/components/ui/submit-button";
import { useToast } from "@/components/ui/toast";
import { useAction } from "@/components/ui/use-action";
import { canReissueInvitation, userState } from "@/lib/user-state";
import { rules, validate } from "@/lib/validation/form";
import { inviteUser, resendInvitation, setUserActive, setUserRole } from "./actions";

interface Role { id: string; key: string; name: string; description: string | null }
interface UserRow { id: string; email: string; full_name: string; is_active: boolean; roleIds: string[]; lastSignIn: string | null; confirmed: boolean }

const REISSUE_FAILED = "Unable to create a new invitation.";

/**
 * Call resendInvitation with the right feedback. When the invitation succeeded
 * but its audit record could not be written, the server's warning is shown in
 * the more prominent (error-styled) toast instead of a plain success.
 */
function reissue(toast: ReturnType<typeof useToast>, userId: string, how: "email" | "link") {
  return async () => {
    const r = await resendInvitation(userId, how);
    if (r.ok) {
      const text = r.message ?? (how === "email" ? "Invitation sent." : "New invitation link created.");
      if (r.data.auditRecorded) toast.success(text); else toast.error(text);
    }
    return r;
  };
}

export function UserAdmin({ users, roles, currentUserId }: { users: UserRow[]; roles: Role[]; currentUserId: string }) {
  const { pending, error, run } = useAction();
  const toast = useToast();
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><InviteDialog roles={roles} /></div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <ul className={`space-y-3 ${pending ? "opacity-70" : ""}`}>
        {users.map((u) => {
          const state = userState({ activated: u.confirmed, isActive: u.is_active });
          const name = u.full_name || u.email;
          return (
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
                {state === "pending_deactivated" ? <p className="mt-1 text-xs text-navy/60">Reactivate this user before sending a new invitation.</p> : null}
                {canReissueInvitation(state) && u.id !== currentUserId ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" className="h-10" disabled={pending}
                      onClick={() => run(reissue(toast, u.id, "email"), { toast: false, errorMessage: REISSUE_FAILED, onError: (e) => toast.error(e) })}>
                      <Mail className="size-4" aria-hidden /> Resend invitation
                    </Button>
                    <ReplaceLinkDialog userId={u.id} name={name} disabled={pending} />
                  </div>
                ) : null}
              </div>
              {u.id !== currentUserId ? (
                <Button size="sm" variant={u.is_active ? "danger" : "secondary"} className="h-10" disabled={pending}
                  onClick={() => run(() => setUserActive(u.id, !u.is_active), { successMessage: u.is_active ? `${name} deactivated successfully.` : `${name} reactivated successfully.` })}>
                  {u.is_active ? "Deactivate" : "Reactivate"}
                </Button>
              ) : null}
            </div>
            <fieldset className="mt-3">
              <legend className="sr-only">Roles for {name}</legend>
              <div className="flex flex-wrap gap-2">
                {roles.map((r) => {
                  const checked = u.roleIds.includes(r.id);
                  return (
                    <label key={r.id} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-3 text-sm ring-1 ${checked ? "bg-navy text-white ring-navy" : "ring-navy/15 hover:bg-navy/5"}`}>
                      <input type="checkbox" className="size-4 accent-gold" checked={checked} disabled={pending}
                        onChange={(e) => {
                          const granted = e.target.checked;
                          run(() => setUserRole(u.id, r.id, granted), { successMessage: granted ? `${r.name} role added successfully.` : `${r.name} role removed successfully.` });
                        }} />
                      {r.name}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Copy-to-clipboard for a one-time invitation link, with a manual fallback. */
function CopyLinkButton({ link }: { link: string }) {
  const toast = useToast();
  return (
    <Button onClick={async () => {
      try {
        await navigator.clipboard.writeText(link);
        toast.success("Invitation link copied to the clipboard.");
      } catch {
        toast.error("Unable to copy automatically. Select the link and copy it manually.");
      }
    }}><Copy className="size-4" aria-hidden /> Copy link</Button>
  );
}

/**
 * Replace a pending user's invitation link. The new link is shown once, kept
 * only in this dialog's state, and forgotten when the dialog closes.
 */
function ReplaceLinkDialog({ userId, name, disabled }: { userId: string; name: string; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [audited, setAudited] = useState(true);
  const toast = useToast();
  const { pending, error, message, run } = useAction();
  function close() { setOpen(false); setLink(null); }
  return (
    <>
      <Button size="sm" variant="secondary" className="h-10" disabled={disabled} onClick={() => { setLink(null); setOpen(true); }}>
        <Link2 className="size-4" aria-hidden /> Replace invitation link
      </Button>
      <Dialog open={open} onClose={close} title="Replace invitation link" description={`Create a new invitation link for ${name}. Any earlier invitation link or email will stop working.`}>
        {link ? (
          <div className="space-y-4">
            {audited
              ? <Alert tone="success" title="New invitation link created">{message} Send it to them privately — it can only be used once and will not be shown again.</Alert>
              : <Alert tone="warning" title="Audit record not written">{message} The link below still works. Send it to them privately — it can only be used once and will not be shown again.</Alert>}
            <Input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Invitation link" />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={close}>Done</Button>
              <CopyLinkButton link={link} />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {error ? <Alert tone="error">{error}</Alert> : null}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={close}>Cancel</Button>
              <LoadingButton pending={pending} pendingLabel="Creating…"
                onClick={() => run(reissue(toast, userId, "link"), {
                  toast: false,
                  errorMessage: REISSUE_FAILED,
                  refresh: false,
                  onError: (e) => toast.error(e),
                  onSuccess: (data) => { setAudited(data.auditRecorded); if (data.link) setLink(data.link); },
                })}>Create new link</LoadingButton>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}

function InviteDialog({ roles }: { roles: Role[] }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ email: "", full_name: "", role_ids: [] as string[], delivery: "email" as "email" | "link" });
  const [link, setLink] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const fields = useFieldErrors();
  const { pending, error, message, run } = useAction();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const errors = validate({
      inv_name: [v.full_name, rules.required("Full name is required."), rules.minLength(2, "Enter the person's full name.")],
      inv_email: [v.email, rules.required("Email address is required."), rules.email()],
      inv_roles: [v.role_ids.length ? "ok" : "", rules.required("Choose at least one role.")],
    });
    if (!fields.check(errors, formRef.current)) return;
    run(() => inviteUser(v), {
      successMessage: "Invitation sent successfully.",
      errorMessage: "Unable to invite this person. Please try again.",
      onSuccess: (data) => { if (data?.link) setLink(data.link); else setOpen(false); },
    });
  }
  return (
    <>
      <Button variant="gold" onClick={() => { setOpen(true); setLink(null); setV({ email: "", full_name: "", role_ids: [], delivery: "email" }); fields.setErrors({}); }}><UserPlus className="size-4" aria-hidden /> Invite user</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Invite a team member" description="They will choose their own password. Department leads do not need accounts — send them a requisition link instead.">
        {link ? (
          <div className="space-y-4">
            <Alert tone="success" title="Invitation link created">{message}</Alert>
            <Input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Invitation link" />
            <CopyLinkButton link={link} />
          </div>
        ) : (
          <form ref={formRef} className="space-y-4" onSubmit={submit} noValidate>
            {error ? <Alert tone="error">{error}</Alert> : null}
            <RequiredNote />
            <Field label="Full name" htmlFor="inv_name" required error={fields.errors.inv_name}><Input value={v.full_name} maxLength={120} onChange={(e) => { setV({ ...v, full_name: e.target.value }); fields.clear("inv_name"); }} /></Field>
            <Field label="Email address" htmlFor="inv_email" required error={fields.errors.inv_email}><Input type="email" inputMode="email" autoCapitalize="none" value={v.email} onChange={(e) => { setV({ ...v, email: e.target.value }); fields.clear("inv_email"); }} /></Field>
            <fieldset id="inv_roles" data-invalid={fields.errors.inv_roles ? true : undefined} aria-describedby={fields.errors.inv_roles ? "inv_roles-error" : undefined}>
              <legend className="mb-2 text-sm font-medium">Roles<RequiredMark /><span className="sr-only"> (choose at least one; required)</span></legend>
              <div className="space-y-2">
                {roles.map((r) => (
                  <label key={r.id} className="flex gap-3 rounded-xl p-2 hover:bg-navy/5">
                    <Checkbox checked={v.role_ids.includes(r.id)} onChange={(e) => { setV({ ...v, role_ids: e.target.checked ? [...v.role_ids, r.id] : v.role_ids.filter((x) => x !== r.id) }); fields.clear("inv_roles"); }} className="mt-0.5" />
                    <span><span className="block font-medium">{r.name}</span>{r.description ? <span className="block text-sm text-navy/60">{r.description}</span> : null}</span>
                  </label>
                ))}
              </div>
              <FieldError id="inv_roles-error" message={fields.errors.inv_roles} />
            </fieldset>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">How should they receive it?</legend>
              <label className="flex items-center gap-2 text-sm"><input type="radio" className="accent-navy" checked={v.delivery === "email"} onChange={() => setV({ ...v, delivery: "email" })} /> Send an invitation email</label>
              <label className="mt-1 flex items-center gap-2 text-sm"><input type="radio" className="accent-navy" checked={v.delivery === "link"} onChange={() => setV({ ...v, delivery: "link" })} /> Give me a link to send myself</label>
            </fieldset>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <LoadingButton type="submit" pending={pending} pendingLabel="Inviting…">Invite</LoadingButton>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
