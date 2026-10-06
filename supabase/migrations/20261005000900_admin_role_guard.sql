-- =============================================================================
-- Migration 0900: only Administrators may grant or revoke the Administrator
-- role, or change any role's permissions that would affect administrators.
-- Prevents a user who holds `users.manage` (but is not an administrator) from
-- escalating their own privileges.
-- =============================================================================
create or replace function private.is_administrator()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = auth.uid() and r.key = 'administrator' and p.is_active
  )
$$;
grant execute on function private.is_administrator() to authenticated;

drop policy if exists user_roles_insert on public.user_roles;
drop policy if exists user_roles_delete on public.user_roles;

create policy user_roles_insert on public.user_roles for insert to authenticated
  with check (
    private.has_permission('users.manage')
    and (role_id <> (select id from public.roles where key = 'administrator') or private.is_administrator())
  );
create policy user_roles_delete on public.user_roles for delete to authenticated
  using (
    private.has_permission('users.manage')
    and (role_id <> (select id from public.roles where key = 'administrator') or private.is_administrator())
  );

-- Granting `users.manage` (or any permission) to a role is itself an
-- escalation path, so role/permission edits are reserved for administrators.
drop policy if exists role_permissions_insert on public.role_permissions;
drop policy if exists role_permissions_delete on public.role_permissions;
create policy role_permissions_insert on public.role_permissions for insert to authenticated
  with check (private.is_administrator());
create policy role_permissions_delete on public.role_permissions for delete to authenticated
  using (private.is_administrator());
