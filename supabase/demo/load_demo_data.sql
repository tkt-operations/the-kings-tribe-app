-- =============================================================================
-- The Kings Tribe — DEMO DATA (fictional, clearly labelled, removable)
-- =============================================================================
-- What it creates (all flagged is_demo = true):
--   * 12 recent Sundays of attendance and finance (only on dates that have no
--     real data yet)
--   * 11 requisitions — one in every workflow status — with line items, review
--     decisions, Purchase Orders, vendor orders, receipts, reconciliations and
--     disbursements, created through the real workflow functions so their
--     history and audit trail are genuine.
--   * All people, vendors and amounts are FICTIONAL.
--
-- Requirements: run AFTER the migrations and AFTER the first administrator has
-- been created (the demo acts as that administrator).
-- Remove everything with supabase/demo/remove_demo_data.sql.
-- =============================================================================
do $$
declare
  v_admin uuid;
  v_token text := 'demo-' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_token_id uuid;
  v_today date := private.church_today();
  v_sunday date := private.church_today() - extract(dow from private.church_today())::int;
  v_week int;
  v_sd uuid;
  v_cat record;
  v_types jsonb;
  v_depts jsonb;
  v_r jsonb;
  v_req uuid;
  v_items uuid[];
  v_po jsonb;
  v_receipt uuid;
  v_i int;
  v_specs jsonb := '[
    {"key":"submitted","type":"order","dept":"Hospitality Team","sub":"Refreshments & Hospitality","name":"Avery Demo","items":[["Coffee beans (2 lb bag)","4","18.99"],["Compostable cups (pack of 100)","3","12.50"]]},
    {"key":"under_review","type":"order","dept":"Production Team","sub":"Audio Production","name":"Blake Sample","items":[["Wireless microphone batteries (AA, 48 pack)","2","29.99"]]},
    {"key":"on_hold","type":"direct_purchase","dept":"Children''s Ministry Team","sub":"Furniture & Equipment","name":"Casey Example","items":[["Folding classroom table","2","89.00"],["Stackable kids chairs","12","24.00"]]},
    {"key":"approved","type":"order","dept":"Children''s Ministry Team","sub":"Arts & Crafts","name":"Dana Placeholder","items":[["Washable markers (classroom pack)","3","21.75"],["Construction paper (500 sheets)","2","15.40"]]},
    {"key":"partially_approved","type":"order","dept":"Production Team","sub":"Video Production","name":"Emery Testcase","items":[["HDMI cable 25 ft","2","24.99"],["4K camera (premium)","1","1899.00"]]},
    {"key":"rejected","type":"advance_check","dept":"Hospitality Team","sub":"Events & Fellowship","name":"Finley Mock","items":[["Catering deposit for fellowship lunch","1","1200.00"]]},
    {"key":"po_issued","type":"direct_purchase","dept":"Hospitality Team","sub":"Facility Presentation","name":"Gray Specimen","items":[["Welcome banner (vinyl, 6 ft)","1","145.00"],["Banner stand","1","68.50"]]},
    {"key":"ordered","type":"order","dept":"Production Team","sub":"Live Sound","name":"Harper Fiction","items":[["XLR cable 25 ft","6","18.50"],["Gaffer tape 2 in","3","14.25"]]},
    {"key":"partially_purchased","type":"order","dept":"Children''s Ministry Team","sub":"Curriculum & Teaching Materials","name":"Indy Invented","items":[["Quarterly curriculum kit","1","249.00"],["Bible story flash cards","4","19.95"]]},
    {"key":"purchased","type":"order","dept":"Hospitality Team","sub":"Supplies & Consumables","name":"Jordan Example","items":[["Paper towels (12 rolls)","2","22.49"],["Hand soap refill","3","9.99"]]},
    {"key":"closed","type":"petty_cash","dept":"Children''s Ministry Team","sub":"Snacks & Refreshments","name":"Kai Pretend","items":[["Snacks for Sunday classes","1","45.00"]]}
  ]';
  v_spec jsonb;
  v_item jsonb;
  v_items_json jsonb;
  v_total numeric;
begin
  select ur.user_id into v_admin
  from public.user_roles ur join public.roles r on r.id = ur.role_id join public.profiles p on p.id = ur.user_id
  where r.key = 'administrator' and p.is_active order by ur.granted_at limit 1;
  if v_admin is null then
    raise exception 'Create the first administrator before loading demo data.';
  end if;
  -- Act as the administrator so workflow permission checks pass and audit records the actor.
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('app.actor_label', 'demo-data', true);

  -- ---------------------------------------------------------------------------
  -- Sundays: attendance + finance for the last 12 weeks (skip dates with real data)
  -- ---------------------------------------------------------------------------
  for v_week in 0 .. 11 loop
    if exists (select 1 from public.service_dates where service_date = v_sunday - v_week * 7) then
      continue;
    end if;
    insert into public.service_dates (service_date, service_name, notes, is_demo, created_by)
    values (v_sunday - v_week * 7, 'Sunday Service', 'DEMO DATA', true, v_admin)
    returning id into v_sd;
    for v_cat in select id, name from public.categories where type = 'attendance' and parent_id is null and is_active loop
      insert into public.attendance_entries (service_date_id, category_id, count, entered_by, updated_by, is_demo)
      values (v_sd, v_cat.id,
              case when v_cat.name ilike 'adult%' then 118 + ((v_week * 37) % 29) + (11 - v_week) * 2
                   when v_cat.name ilike 'child%' then 31 + ((v_week * 13) % 11)
                   else 8 + (v_week % 5) end,
              v_admin, v_admin, true);
    end loop;
    for v_cat in select id, name from public.categories where type = 'finance' and parent_id is null and is_active and not allows_negative loop
      insert into public.finance_entries (service_date_id, category_id, amount, notes, entered_by, updated_by, is_demo)
      values (v_sd, v_cat.id,
              round((case when v_cat.name ilike 'tithe%' then 2850 + ((v_week * 173) % 640)
                          when v_cat.name ilike 'offering%' then 690 + ((v_week * 97) % 260)
                          else 140 + ((v_week * 41) % 95) end
                     + ((v_week * 7) % 100) / 100.0)::numeric, 2),
              'DEMO DATA', v_admin, v_admin, true);
    end loop;
  end loop;

  -- ---------------------------------------------------------------------------
  -- Requisitions through the real workflow
  -- ---------------------------------------------------------------------------
  insert into public.external_form_tokens (label, token_hash, token_hint, is_active, created_by)
  values ('DEMO DATA link (inactive)', encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), left(v_token, 6), true, v_admin)
  returning id into v_token_id;

  select jsonb_object_agg(key, id) into v_types from public.request_types;
  for v_spec in select * from jsonb_array_elements(v_specs) loop
    v_items_json := (select jsonb_agg(jsonb_build_object('description', x ->> 0, 'quantity', x ->> 1, 'estimated_unit_price', x ->> 2,
                                                          'vendor_name', 'Demo Supply Co.', 'notes', 'DEMO DATA'))
                     from jsonb_array_elements(v_spec -> 'items') x);
    select coalesce(sum(round((x ->> 1)::numeric * (x ->> 2)::numeric, 2)), 0) into v_total from jsonb_array_elements(v_spec -> 'items') x;
    v_r := public.submit_requisition(
      v_token,
      jsonb_build_object(
        'request_type_id', v_types ->> (v_spec ->> 'type'),
        'department_id', (select id from public.departments where name = v_spec ->> 'dept'),
        'subcategory_id', (select s.id from public.department_subcategories s join public.departments d on d.id = s.department_id
                           where d.name = v_spec ->> 'dept' and s.name = v_spec ->> 'sub'),
        'requester_name', (v_spec ->> 'name') || ' (DEMO)',
        'requester_email', lower(replace(v_spec ->> 'name', ' ', '.')) || '@demo.invalid',
        'requester_phone', '+1 555 010 0' || lpad((jsonb_array_length(v_specs))::text, 3, '0'),
        'department_head_name', (v_spec ->> 'name') || ' (DEMO)',
        'needed_by', (v_today + 10)::text,
        'budget_status', case when v_spec ->> 'key' = 'partially_approved' then 'unsure' else 'yes' end,
        'budget_explanation', case when v_spec ->> 'key' = 'partially_approved' then 'Camera may exceed this quarter''s budget (DEMO)' end,
        'justification', 'DEMO DATA — fictional request used to illustrate the ' || (v_spec ->> 'key') || ' status.',
        'certification_accepted', true,
        'certification_name', (v_spec ->> 'name') || ' (DEMO)',
        'actual_purchase_amount', case when v_spec ->> 'type' = 'reimbursement' then v_total::text end,
        'purchase_vendor', case when v_spec ->> 'type' = 'reimbursement' then 'Demo Supply Co.' end,
        'purchase_date', case when v_spec ->> 'type' = 'reimbursement' then (v_today - 3)::text end,
        'items', v_items_json
      ),
      '[]'::jsonb,
      null
    );
    v_req := (v_r ->> 'id')::uuid;
    update public.requisitions set is_demo = true, submitted_at = now() - ((10 - (select count(*) from public.requisitions where is_demo)) || ' days')::interval
    where id = v_req;
    select array_agg(id order by line_number) into v_items from public.requisition_items where requisition_id = v_req;

    case v_spec ->> 'key'
      when 'submitted' then null;
      when 'under_review' then
        perform public.start_requisition_review(v_req);
      when 'on_hold' then
        perform public.review_requisition(v_req, 'hold', '[]'::jsonb, 'DEMO: please attach a vendor quote for the tables.');
      when 'rejected' then
        perform public.review_requisition(v_req, 'reject', '[]'::jsonb, 'DEMO: the fellowship lunch is covered by the events budget.');
      when 'partially_approved' then
        perform public.review_requisition(v_req, 'partial', jsonb_build_array(
          jsonb_build_object('item_id', v_items[1], 'decision', 'approved'),
          jsonb_build_object('item_id', v_items[2], 'decision', 'rejected', 'comment', 'DEMO: camera purchase deferred to next quarter.')));
      else
        perform public.review_requisition(v_req, 'approve');
    end case;

    if v_spec ->> 'key' in ('po_issued', 'ordered', 'partially_purchased') then
      v_po := public.issue_purchase_order(v_req, null, jsonb_build_object('name', 'Demo Supply Co.', 'email', 'orders@demo.invalid'), 'DEMO DATA');
    end if;

    if v_spec ->> 'key' in ('ordered', 'partially_purchased') then
      perform public.record_vendor_order(v_req,
        jsonb_build_object('vendor_name', 'Demo Supply Co.', 'vendor_reference', 'DEMO-' || left(v_req::text, 6), 'order_date', (v_today - 2)::text,
                           'expected_delivery_date', (v_today + 3)::text, 'purchase_order_id', v_po ->> 'id', 'notes', 'DEMO DATA'),
        (select jsonb_agg(jsonb_build_object('requisition_item_id', i.id, 'quantity', i.approved_quantity::text))
         from public.requisition_items i where i.requisition_id = v_req and i.review_status = 'approved'));
    end if;

    if v_spec ->> 'key' = 'partially_purchased' then
      insert into public.receipts (requisition_id, purchase_order_id, source, status, vendor_name, purchase_date, total_amount, reference, notes, uploaded_by, is_demo)
      values (v_req, (v_po ->> 'id')::uuid, 'upload', 'pending', 'Demo Supply Co.', v_today - 1, 249.00, 'DEMO-INV-1', 'DEMO DATA (no file attached)', v_admin, true)
      returning id into v_receipt;
      perform public.reconcile_receipt(v_receipt, jsonb_build_array(jsonb_build_object('requisition_item_id', v_items[1], 'quantity', '1', 'actual_amount', '239.00')));
    end if;

    if v_spec ->> 'key' = 'purchased' then
      insert into public.receipts (requisition_id, source, status, vendor_name, purchase_date, total_amount, reference, notes, uploaded_by, is_demo)
      values (v_req, 'upload', 'pending', 'Demo Supply Co.', v_today - 3, v_total, 'DEMO-INV-2', 'DEMO DATA (no file attached)', v_admin, true)
      returning id into v_receipt;
      perform public.reconcile_receipt(v_receipt,
        (select jsonb_agg(jsonb_build_object('requisition_item_id', i.id, 'quantity', i.approved_quantity::text, 'actual_amount', i.approved_total::text))
         from public.requisition_items i where i.requisition_id = v_req));
    end if;

    if v_spec ->> 'key' = 'closed' then
      perform public.record_disbursement(v_req, '45.00', 'cash', v_today - 6, null, 'DEMO DATA');
      insert into public.receipts (requisition_id, source, status, vendor_name, purchase_date, total_amount, reference, notes, uploaded_by, is_demo)
      values (v_req, 'upload', 'pending', 'Demo Grocery', v_today - 5, 41.37, 'DEMO-INV-3', 'DEMO DATA (no file attached) — $3.63 change returned', v_admin, true)
      returning id into v_receipt;
      perform public.reconcile_receipt(v_receipt, jsonb_build_array(jsonb_build_object('requisition_item_id', v_items[1], 'quantity', '1', 'actual_amount', '41.37')));
      perform public.close_requisition(v_req, 'DEMO: receipts reconciled, change returned to petty cash.');
    end if;
  end loop;

  -- The demo link is only a vehicle for creating demo requests: deactivate it.
  update public.external_form_tokens set is_active = false, revoked_at = now(), revoked_by = v_admin where id = v_token_id;

  raise notice 'Demo data loaded: % demo Sundays, % demo requisitions.',
    (select count(*) from public.service_dates where is_demo), (select count(*) from public.requisitions where is_demo);
end $$;
