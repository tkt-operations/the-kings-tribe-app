-- =============================================================================
-- Migration 20261006000050: fix auditing of church_settings updates
--
-- Bug: private.audit_row_change() cast every audited row's `id` to uuid.
-- church_settings is a singleton keyed by smallint id = 1, so EVERY update to
-- church_settings raised 22P02 (invalid input syntax for type uuid: "1") and
-- rolled back. Saving church information, notification email/policies and
-- "Mark setup complete" therefore always failed ("Something went wrong").
--
-- Fix: only use `id` / `requisition_id` as uuids when they are uuids; keep a
-- non-uuid key in the audit metadata instead. Behaviour for every other
-- audited table is unchanged. CREATE OR REPLACE keeps the function's owner
-- and privileges. No data is changed.
-- =============================================================================

create or replace function private.audit_row_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_key text;
  v_id uuid;
  v_req_text text;
  v_req uuid;
  v_meta jsonb := '{}'::jsonb;
  i int;
  c_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if tg_op <> 'INSERT' then v_before := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_after := to_jsonb(new); end if;
  if tg_nargs > 1 then
    for i in 1 .. tg_nargs - 1 loop
      v_before := v_before - tg_argv[i];
      v_after := v_after - tg_argv[i];
    end loop;
  end if;
  if tg_op = 'UPDATE' and v_before = v_after then
    return new;
  end if;
  -- Tables with composite keys (user_roles, role_permissions) have no `id`;
  -- singletons (church_settings) have a non-uuid id.
  v_key := coalesce(v_after ->> 'id', v_before ->> 'id');
  if v_key ~ c_uuid then
    v_id := v_key::uuid;
  elsif v_key is not null then
    v_meta := jsonb_build_object('row_key', v_key);
  end if;
  v_req_text := nullif(coalesce(v_after ->> 'requisition_id', v_before ->> 'requisition_id'), '');
  if v_req_text ~ c_uuid then v_req := v_req_text::uuid; end if;
  perform private.write_audit(
    lower(tg_argv[0] || '.' || case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end),
    tg_argv[0], v_id, v_req, v_before, v_after, v_meta);
  return coalesce(new, old);
end $$;
