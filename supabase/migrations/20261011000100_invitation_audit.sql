-- Audit entries for re-issued invitations.
--
-- Resending an invitation email or replacing an invitation link happens in the
-- Supabase Auth admin API (server only), which writes nothing to
-- public.audit_logs. The server action calls this function afterwards, with the
-- manager's own session, so the entry records who did it.
--
-- Deliberately takes no URL, token or email: only the user id and how the
-- invitation was delivered can ever reach the audit log.
-- Reactivation is already audited by the profiles_audit trigger (is_active).

create or replace function public.log_invitation_reissued(p_user_id uuid, p_delivery text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform private.require_permission('users.manage');
  if p_delivery is null or p_delivery not in ('email', 'link') then
    raise exception 'Invalid invitation delivery.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'User not found.' using errcode = 'P0001';
  end if;
  perform private.write_audit(
    case p_delivery when 'email' then 'user.invitation_resent' else 'user.invitation_link_replaced' end,
    'profile', p_user_id, null, null, null,
    jsonb_build_object('delivery', p_delivery)
  );
end $$;

revoke all on function public.log_invitation_reissued(uuid, text) from public, anon, authenticated;
grant execute on function public.log_invitation_reissued(uuid, text) to authenticated;
