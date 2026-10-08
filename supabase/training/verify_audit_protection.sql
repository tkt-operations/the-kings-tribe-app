-- =============================================================================
-- The Kings Tribe — prove the audit log is append-only (changes nothing)
--     scripts/training/training-db.sh verify-audit
--
-- Checks the append-only trigger is present and enabled, then tries an
-- ordinary DELETE and UPDATE of one audit row inside a subtransaction that is
-- always rolled back. Passes only if Postgres refuses both with 42501.
-- =============================================================================
do $$
declare
  v_enabled "char";
  v_id uuid;
  v_refused_delete boolean := false;
  v_refused_update boolean := false;
begin
  select t.tgenabled into v_enabled from pg_trigger t
   where t.tgrelid = 'public.audit_logs'::regclass and t.tgname = 'audit_logs_no_update';
  if v_enabled is distinct from 'O' then
    raise exception 'AUDIT PROTECTION: the append-only trigger is missing or disabled.';
  end if;
  select id into v_id from public.audit_logs order by occurred_at limit 1;
  if v_id is null then
    raise exception 'AUDIT PROTECTION: no audit rows to test against.';
  end if;

  begin
    delete from public.audit_logs where id = v_id;
    raise exception using errcode = 'P0001', message = 'tkt_rollback_sentinel';
  exception
    when insufficient_privilege then v_refused_delete := true;
    when raise_exception then if sqlerrm <> 'tkt_rollback_sentinel' then raise; end if;
  end;
  begin
    update public.audit_logs set action = action where id = v_id;
    raise exception using errcode = 'P0001', message = 'tkt_rollback_sentinel';
  exception
    when insufficient_privilege then v_refused_update := true;
    when raise_exception then if sqlerrm <> 'tkt_rollback_sentinel' then raise; end if;
  end;

  if not (v_refused_delete and v_refused_update) then
    raise exception 'AUDIT PROTECTION FAILED: delete refused=%, update refused=% (test changes were rolled back).', v_refused_delete, v_refused_update;
  end if;
  raise notice 'Audit protection verified: trigger enabled; ordinary DELETE and UPDATE refused (nothing changed).';
end $$;
