-- =============================================================================
-- The Kings Tribe — REMOVE ONE CAPTURE REQUISITION (training project only)
--     scripts/training/training-db.sh remove-capture TKT-REQ-YYYY-NNNN
--
-- Removes a single requisition that was submitted through the training request
-- form for a screenshot or video (for example S53), and everything hanging off
-- it, in the same order as reset_scenarios.sql. It refuses unless:
--   * the church name contains TRAINING (same guard as every training file);
--   * exactly one requisition has that number;
--   * it is NOT a seeded scenario (its fingerprint does not start "training:");
--   * the requester email is a fictional .invalid address;
--   * it was created within the last 7 days and is still Submitted.
-- The append-only audit log is never touched; its entries for this request remain.
-- Run directly, the placeholder below is not a valid number and this stops.
-- =============================================================================
do $$
declare
  v_number text := '__CAPTURE_REQUISITION__';
  v_name text;
  v_req public.requisitions;
  v_count int;
begin
  select church_name into v_name from public.church_settings where id = 1;
  if v_name is null or position('TRAINING' in upper(v_name)) = 0 then
    raise exception 'TRAINING GUARD: refusing to continue. The church name does not contain "TRAINING", so this is not the training database.';
  end if;
  if v_number !~ '^TKT-REQ-[0-9]{4}-[0-9]{4}$' then
    raise exception 'Capture removal: "%" is not a requisition number. Run through scripts/training/training-db.sh remove-capture.', v_number;
  end if;
  select count(*) into v_count from public.requisitions where requisition_number = v_number;
  if v_count <> 1 then
    raise exception 'Capture removal: expected exactly one requisition %, found %.', v_number, v_count;
  end if;
  select * into v_req from public.requisitions where requisition_number = v_number;
  if coalesce(v_req.submission_fingerprint, '') like 'training:%' then
    raise exception 'Capture removal: % is a seeded training scenario. Use reset <scenario> instead.', v_number;
  end if;
  if v_req.requester_email !~* '\.invalid$' then
    raise exception 'Capture removal: % does not have a fictional .invalid requester email.', v_number;
  end if;
  if v_req.created_at < now() - interval '7 days' or v_req.status <> 'submitted' then
    raise exception 'Capture removal: % is older than 7 days or no longer Submitted; refusing.', v_number;
  end if;
  perform set_config('app.actor_label', 'training-capture-cleanup', true);

  delete from public.receipt_item_allocations where receipt_id in (select id from public.receipts where requisition_id = v_req.id);
  delete from public.receipt_files where receipt_id in (select id from public.receipts where requisition_id = v_req.id);
  delete from public.receipts where requisition_id = v_req.id;
  delete from public.vendor_orders where requisition_id = v_req.id;
  delete from public.purchase_orders where requisition_id = v_req.id;
  delete from public.disbursements where requisition_id = v_req.id;
  delete from public.notifications where requisition_id = v_req.id;    -- email/SMS log
  delete from public.inbound_emails where matched_requisition_id = v_req.id;
  delete from public.requisitions where id = v_req.id;                 -- items, history, comments, preferences, in-app notifications cascade

  raise notice 'Capture removal: % removed.', v_number;
end $$;
