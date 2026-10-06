-- =============================================================================
-- The Kings Tribe — REMOVE DEMO DATA
-- Deletes every row flagged is_demo (and their dependants). Real data is never
-- touched. Audit records of the demo remain, because the audit log is
-- append-only by design; they are labelled "demo-data".
-- =============================================================================
do $$
declare
  v_reqs uuid[];
begin
  perform set_config('app.actor_label', 'demo-data-removal', true);
  select coalesce(array_agg(id), '{}') into v_reqs from public.requisitions where is_demo;

  delete from public.receipt_item_allocations where receipt_id in (select id from public.receipts where requisition_id = any (v_reqs) or is_demo);
  delete from public.receipt_files where receipt_id in (select id from public.receipts where requisition_id = any (v_reqs) or is_demo);
  delete from public.receipts where requisition_id = any (v_reqs) or is_demo;
  delete from public.vendor_orders where requisition_id = any (v_reqs) or is_demo;          -- items cascade
  delete from public.purchase_orders where requisition_id = any (v_reqs) or is_demo;        -- items cascade
  delete from public.disbursements where requisition_id = any (v_reqs) or is_demo;
  delete from public.notifications where requisition_id = any (v_reqs);
  delete from public.inbound_emails where matched_requisition_id = any (v_reqs);
  delete from public.requisitions where id = any (v_reqs);                                 -- items, history, comments, prefs cascade
  delete from public.external_form_tokens where label = 'DEMO DATA link (inactive)';

  delete from public.finance_entries where is_demo or service_date_id in (select id from public.service_dates where is_demo);
  delete from public.attendance_entries where is_demo or service_date_id in (select id from public.service_dates where is_demo);
  delete from public.service_dates where is_demo;

  -- If no real requisitions / POs exist yet, restart numbering at 0001.
  if not exists (select 1 from public.requisitions) then
    delete from public.document_sequences where kind = 'REQ';
  end if;
  if not exists (select 1 from public.purchase_orders) then
    delete from public.document_sequences where kind = 'PO';
  end if;

  raise notice 'Demo data removed.';
end $$;
