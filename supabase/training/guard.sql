-- =============================================================================
-- TRAINING GUARD — read-only. See supabase/training/README.md.
--
-- Succeeds only on a database whose church name contains "TRAINING"
-- (Administration → Church settings → Church name, e.g. "The Kings Tribe (TRAINING)").
-- Production's church name never contains it, so every training script stops
-- here before writing anything if it is pointed at the wrong database.
--
-- The same check is repeated at the top of seed_training.sql and
-- reset_scenarios.sql, inside the block that does the writing, so those files
-- are safe even when run on their own.
-- =============================================================================
do $$
declare
  v_name text;
begin
  if to_regclass('public.church_settings') is null then
    raise exception 'TRAINING GUARD: public.church_settings does not exist. Apply the migrations to the training project first.';
  end if;
  select church_name into v_name from public.church_settings where id = 1;
  if v_name is null or position('TRAINING' in upper(v_name)) = 0 then
    raise exception 'TRAINING GUARD: refusing to continue. The church name does not contain "TRAINING", so this is not the training database.';
  end if;
  raise notice 'TRAINING GUARD: ok (church name contains TRAINING).';
end $$;
