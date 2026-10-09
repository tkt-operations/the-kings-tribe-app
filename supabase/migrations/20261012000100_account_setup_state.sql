-- Durable "account setup completed" state.
--
-- Supabase marks an invited user confirmed (email_confirmed_at), gives them a
-- random temporary password and a session (last_sign_in_at) the moment the
-- invitation link is opened — before they choose a password in this app. So
-- neither field says whether setup was finished. This column does:
--
--   null  setup not completed (invited; may or may not have opened the link)
--   set   the person chose a password here, or signed in with a password
--
-- is_active (deactivation) stays separate.

alter table public.profiles add column account_setup_completed_at timestamptz;

comment on column public.profiles.account_setup_completed_at is
  'Set once the person has chosen their own password (or signed in with one). Only public.mark_account_setup_complete() sets it.';

-- Profiles are self-editable (name, phone). The new column is not: only the
-- function below may change it, and only for the signed-in user. Service-role
-- and migration updates (no auth.uid()) are unaffected, as for is_active.
create or replace function private.guard_profile_self_update()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.is_active is distinct from old.is_active and not private.has_permission('users.manage')
     and auth.uid() is not null then
    raise exception 'permission denied: users.manage' using errcode = '42501';
  end if;
  if new.account_setup_completed_at is distinct from old.account_setup_completed_at
     and auth.uid() is not null
     and coalesce(current_setting('app.account_setup_marking', true), '') <> 'on' then
    raise exception 'permission denied: account setup state' using errcode = '42501';
  end if;
  return new;
end $$;

-- Called by the server with the person's own session, only after Supabase has
-- accepted their new password or a password sign-in. Takes no user id, so it
-- can only ever mark the caller. Never clears the value; idempotent.
create or replace function public.mark_account_setup_complete(p_method text)
returns timestamptz language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_at timestamptz;
begin
  if v_user is null then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_method is null or p_method not in ('password_set', 'password_sign_in') then
    raise exception 'Invalid setup method.' using errcode = 'P0001';
  end if;
  perform set_config('app.account_setup_marking', 'on', true);
  update public.profiles set account_setup_completed_at = now()
   where id = v_user and account_setup_completed_at is null
  returning account_setup_completed_at into v_at;
  perform set_config('app.account_setup_marking', '', true);
  if v_at is not null then
    perform private.write_audit('user.account_setup_completed', 'profile', v_user, null, null, null,
      jsonb_build_object('method', p_method));
  end if;
  return (select account_setup_completed_at from public.profiles where id = v_user);
end $$;

-- Audit for recovery links issued to invited users whose setup is incomplete
-- (Supabase no longer accepts a re-invitation once the email is confirmed).
-- Like log_invitation_reissued: no URL, token or email can be passed in.
create or replace function public.log_account_recovery_issued(p_user_id uuid, p_delivery text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform private.require_permission('users.manage');
  if p_delivery is null or p_delivery not in ('email', 'link') then
    raise exception 'Invalid recovery delivery.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'User not found.' using errcode = 'P0001';
  end if;
  perform private.write_audit(
    case p_delivery when 'email' then 'user.recovery_email_sent' else 'user.recovery_link_created' end,
    'profile', p_user_id, null, null, null,
    jsonb_build_object('delivery', p_delivery)
  );
end $$;

revoke all on function public.mark_account_setup_complete(text) from public, anon, authenticated;
revoke all on function public.log_account_recovery_issued(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_account_setup_complete(text) to authenticated;
grant execute on function public.log_account_recovery_issued(uuid, text) to authenticated;

-- Backfill: only where completion is provable. Everyone else stays null and is
-- marked automatically when they next set a password or sign in with one.
--  1. Accounts created with a password rather than invited (e.g. the first
--     administrator from /setup): invited_at is null and a password exists.
--  2. Accounts with a live session that was started by a password sign-in.
-- Invited users who merely opened their link (temporary random password,
-- otp/recovery sessions only) are deliberately NOT marked.
update public.profiles p
   set account_setup_completed_at = now()
 where p.account_setup_completed_at is null
   and exists (
     select 1 from auth.users u
      where u.id = p.id
        and (
          (u.invited_at is null and coalesce(u.encrypted_password, '') <> '')
          or exists (
            select 1 from auth.sessions s
              join auth.mfa_amr_claims c on c.session_id = s.id
             where s.user_id = u.id and c.authentication_method = 'password'
          )
        )
   );
