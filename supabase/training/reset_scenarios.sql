-- =============================================================================
-- The Kings Tribe — TRAINING RESET (deletes training scenario data only)
-- See supabase/training/README.md.
--
-- Run ONLY through scripts/training/training-db.sh, which fills in the
-- scenario name, checks the target is the training project, asks you to type
-- the project ref, and then re-runs seed_training.sql for the same scenario:
--     scripts/training/training-db.sh reset <scenario>   (one scenario)
--     scripts/training/training-db.sh reset all          (every scenario)
-- Run directly, the placeholder below is not a valid scenario and this stops.
--
-- What it deletes
--   * <scenario>: the requisitions tagged "training:<scenario>" (or
--     "training:<scenario>:n") and everything hanging off them: line items,
--     history, comments, POs, vendor orders, receipts, disbursements, the
--     email log and in-app notifications. "sundays" deletes the services the
--     seed recorded (notes "Training data").
--   * all: every requisition, Sunday entry and revoked seed link in the
--     training database. Users, roles and settings are kept.
-- What it never deletes
--   * the audit log (append-only by design; old entries simply remain)
--   * users, roles, church settings, departments, categories, request types
-- =============================================================================
do $$
declare
  v_scenario text := '__TRAINING_SCENARIO__';
  v_scenarios text[] := array[
    'priority_mix', 'review_take_1', 'review_take_2', 'review_take_3', 'ready_for_po', 'ready_for_po_direct',
    'ready_to_order', 'receipt_pending', 'partial_purchase', 'advance_due', 'ready_to_close',
    'on_hold_example', 'rejected_example', 'partially_approved', 'history', 'sundays'];
  v_name text;
  v_reqs uuid[];
  v_services uuid[];
begin
  -- ---- Guard (identical rule to guard.sql) ----------------------------------
  select church_name into v_name from public.church_settings where id = 1;
  if v_name is null or position('TRAINING' in upper(v_name)) = 0 then
    raise exception 'TRAINING GUARD: refusing to continue. The church name does not contain "TRAINING", so this is not the training database.';
  end if;
  if v_scenario <> 'all' and not (v_scenario = any (v_scenarios)) then
    raise exception 'Training reset: unknown scenario "%". Run through scripts/training/training-db.sh with one of: all, %.',
      v_scenario, array_to_string(v_scenarios, ', ');
  end if;
  perform set_config('app.actor_label', 'training-reset', true);

  if v_scenario = 'all' then
    select coalesce(array_agg(id), '{}') into v_reqs from public.requisitions;
    select coalesce(array_agg(id), '{}') into v_services from public.service_dates;
  elsif v_scenario = 'sundays' then
    v_reqs := '{}';
    select coalesce(array_agg(id), '{}') into v_services from public.service_dates where notes = 'Training data';
  else
    select coalesce(array_agg(id), '{}') into v_reqs from public.requisitions
     where submission_fingerprint = 'training:' || v_scenario or submission_fingerprint like 'training:' || v_scenario || ':%';
    v_services := '{}';
  end if;

  delete from public.receipt_item_allocations where receipt_id in (select id from public.receipts where requisition_id = any (v_reqs));
  delete from public.receipt_files where receipt_id in (select id from public.receipts where requisition_id = any (v_reqs));
  delete from public.receipts where requisition_id = any (v_reqs);
  delete from public.vendor_orders where requisition_id = any (v_reqs);    -- items cascade
  delete from public.purchase_orders where requisition_id = any (v_reqs);  -- items cascade
  delete from public.disbursements where requisition_id = any (v_reqs);
  delete from public.notifications where requisition_id = any (v_reqs);    -- email log
  delete from public.inbound_emails where matched_requisition_id = any (v_reqs);
  delete from public.requisitions where id = any (v_reqs);                 -- items, history, comments, in-app notifications cascade

  delete from public.finance_entries where service_date_id = any (v_services);
  delete from public.attendance_entries where service_date_id = any (v_services);
  delete from public.service_dates where id = any (v_services);

  if v_scenario = 'all' then
    delete from public.external_form_tokens where label = 'Training seed link (revoked)' and not is_active;
  end if;

  raise notice 'Training reset "%": % requisition(s) and % service(s) removed.', v_scenario, cardinality(v_reqs), cardinality(v_services);
end $$;
