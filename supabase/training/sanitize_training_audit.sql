-- =============================================================================
-- The Kings Tribe — ONE-TIME TRAINING AUDIT CLEANUP (training project only)
--
-- Removes exactly four audit_logs rows in the TRAINING database that recorded
-- real-looking contact details entered before the training values were made
-- fictional. Run ONLY through the guarded wrapper:
--     scripts/training/training-db.sh sanitize-audit
--
-- Append-only protection: the trigger public.audit_logs.audit_logs_no_update
-- (BEFORE UPDATE OR DELETE -> private.audit_immutable(), SQLSTATE 42501).
-- This file disables ONLY that trigger, deletes ONLY the listed rows, and
-- re-enables the trigger inside the same statement. The wrapper sends the
-- file as one statement, so it is a single transaction: any failure —
-- including failing to restore the trigger — rolls everything back, and no
-- other session ever sees the trigger disabled (ALTER TABLE is transactional
-- and holds an exclusive lock until commit).
--
-- Refuses unless: the church name contains TRAINING, the live church email is
-- the fictional training@demo.invalid, each listed row still exists and still
-- contains the old domain, and no other audit row contains it.
-- =============================================================================
do $$
declare
  v_ids uuid[] := array[
    '33b795f6-8979-4517-bfb0-d3377ce7d227',  -- profile.updated (administrator email at setup)
    '22e3f36a-cd2e-4712-bdb2-d4212df64bd4',  -- church_settings.updated
    '0af7fc36-1121-4c71-8d25-1335dc4ee803',  -- church_settings.updated
    'a174c58a-5562-464b-810b-010bcf40b43a'   -- church_settings.updated
  ]::uuid[];
  v_pattern text := '%thekingstribe.org%';
  v_name text;
  v_email text;
  v_targets int;
  v_all int;
  v_deleted int;
  v_total_before int;
  v_total_after int;
  v_enabled "char";
begin
  -- ---- Guards ------------------------------------------------------------------
  select church_name, email into v_name, v_email from public.church_settings where id = 1;
  if v_name is null or position('TRAINING' in upper(v_name)) = 0 then
    raise exception 'TRAINING GUARD: refusing to continue. The church name does not contain "TRAINING", so this is not the training database.';
  end if;
  if v_email is distinct from 'training@demo.invalid' then
    raise exception 'TRAINING AUDIT CLEANUP: refusing. The church email is not the fictional training@demo.invalid.';
  end if;
  select count(*) into v_targets from public.audit_logs a where a.id = any (v_ids) and a::text ilike v_pattern;
  select count(*) into v_all from public.audit_logs a where a::text ilike v_pattern;
  if v_targets <> cardinality(v_ids) or v_all <> cardinality(v_ids) then
    raise exception 'TRAINING AUDIT CLEANUP: refusing. Expected exactly % matching rows, all listed; found % listed and % in total.',
      cardinality(v_ids), v_targets, v_all;
  end if;
  select count(*) into v_total_before from public.audit_logs;

  -- ---- Cleanup (trigger disabled only for these statements) -------------------
  alter table public.audit_logs disable trigger audit_logs_no_update;
  delete from public.audit_logs where id = any (v_ids);
  get diagnostics v_deleted = row_count;
  alter table public.audit_logs enable trigger audit_logs_no_update;

  -- ---- Checks before commit (any failure rolls everything back) ---------------
  if v_deleted <> cardinality(v_ids) then
    raise exception 'TRAINING AUDIT CLEANUP: expected to delete % rows, deleted %; rolled back.', cardinality(v_ids), v_deleted;
  end if;
  select count(*) into v_total_after from public.audit_logs;
  if v_total_after <> v_total_before - v_deleted then
    raise exception 'TRAINING AUDIT CLEANUP: other audit rows changed; rolled back.';
  end if;
  select t.tgenabled into v_enabled from pg_trigger t
   where t.tgrelid = 'public.audit_logs'::regclass and t.tgname = 'audit_logs_no_update';
  if v_enabled is distinct from 'O' then
    raise exception 'TRAINING AUDIT CLEANUP: append-only trigger was not restored; rolled back.';
  end if;
  if exists (select 1 from public.audit_logs a where a::text ilike v_pattern) then
    raise exception 'TRAINING AUDIT CLEANUP: matching rows remain; rolled back.';
  end if;

  raise notice 'Training audit cleanup: % row(s) deleted, % kept, append-only trigger restored.', v_deleted, v_total_after;
end $$;
