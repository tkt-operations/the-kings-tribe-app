-- =============================================================================
-- Migration 0400: workflow engine.
-- Every state-changing operation on financial / requisition data goes through
-- one of these SECURITY DEFINER functions. Each one:
--   1. checks the caller's permission (private.require_permission),
--   2. validates input (defence in depth behind the app's Zod validation),
--   3. performs all writes in the single transaction of the function call,
--   4. writes an audit record.
-- Money arrives as TEXT and is parsed strictly; arithmetic is numeric only.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Parsing / validation helpers
-- ---------------------------------------------------------------------------
create or replace function private.fail(p_message text)
returns void language plpgsql as $$
begin
  raise exception '%', p_message using errcode = 'P0001';
end $$;

-- Strict decimal parser: up to 2 decimal places, optional sign.
create or replace function private.parse_amount(p_value text, p_field text, p_allow_negative boolean default false)
returns numeric language plpgsql immutable as $$
declare
  v text := btrim(coalesce(p_value, ''));
begin
  if v !~ '^-?[0-9]{1,11}(\.[0-9]{1,2})?$' then
    raise exception '% must be a number with at most 2 decimal places', p_field using errcode = 'P0001';
  end if;
  if not p_allow_negative and v like '-%' then
    raise exception '% cannot be negative', p_field using errcode = 'P0001';
  end if;
  return v::numeric(14,2);
end $$;

create or replace function private.parse_quantity(p_value text, p_field text)
returns numeric language plpgsql immutable as $$
declare
  v text := btrim(coalesce(p_value, ''));
begin
  if v !~ '^[0-9]{1,6}(\.[0-9]{1,2})?$' or v::numeric <= 0 then
    raise exception '% must be a positive number with at most 2 decimal places', p_field using errcode = 'P0001';
  end if;
  return v::numeric(12,2);
end $$;

create or replace function private.clean_text(p_value text, p_max int)
returns text language sql immutable as $$
  select case when p_value is null or btrim(p_value) = '' then null
              else left(btrim(p_value), p_max) end
$$;

-- ---------------------------------------------------------------------------
-- Status transitions (mirrored in lib/workflow/transitions.ts for the UI)
-- ---------------------------------------------------------------------------
create or replace function private.transition_allowed(p_from public.requisition_status, p_to public.requisition_status)
returns boolean language sql immutable as $$
  select case p_from
    when 'submitted' then p_to in ('under_review', 'on_hold', 'approved', 'partially_approved', 'rejected')
    when 'under_review' then p_to in ('on_hold', 'approved', 'partially_approved', 'rejected')
    when 'on_hold' then p_to in ('under_review', 'approved', 'partially_approved', 'rejected')
    when 'approved' then p_to in ('po_issued', 'ordered', 'partially_purchased', 'purchased', 'closed')
    when 'partially_approved' then p_to in ('po_issued', 'ordered', 'partially_purchased', 'purchased', 'closed')
    when 'po_issued' then p_to in ('approved', 'partially_approved', 'ordered', 'partially_purchased', 'purchased', 'closed')
    when 'ordered' then p_to in ('approved', 'partially_approved', 'po_issued', 'partially_purchased', 'purchased', 'closed')
    when 'partially_purchased' then p_to in ('purchased', 'closed')
    when 'purchased' then p_to in ('closed')
    when 'rejected' then p_to in ('closed')
    else false
  end
$$;

create or replace function private.set_requisition_status(
  p_requisition_id uuid,
  p_to public.requisition_status,
  p_comment text
) returns public.requisition_status language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_from public.requisition_status;
begin
  select status into v_from from public.requisitions where id = p_requisition_id for update;
  if v_from is null then
    perform private.fail('Requisition not found');
  end if;
  if v_from = p_to then
    return v_from;
  end if;
  if not private.transition_allowed(v_from, p_to) then
    perform private.fail(format('A requisition cannot move from %s to %s', v_from, p_to));
  end if;
  update public.requisitions
     set status = p_to,
         status_changed_at = now(),
         closed_at = case when p_to = 'closed' then now() else closed_at end
   where id = p_requisition_id;
  insert into public.requisition_status_history (requisition_id, from_status, to_status, changed_by, changed_by_label, comment)
  values (p_requisition_id, v_from, p_to, auth.uid(), private.actor_label(), p_comment);
  perform private.write_audit('requisition.status_changed', 'requisition', p_requisition_id, p_requisition_id,
    jsonb_build_object('status', v_from), jsonb_build_object('status', p_to),
    jsonb_build_object('comment', p_comment));
  return v_from;
end $$;

-- Recompute derived quantities/totals and the purchasing-phase status.
-- A receipt arriving never changes anything here: only RECONCILED allocations
-- count as purchased.
create or replace function private.refresh_requisition_progress(p_requisition_id uuid)
returns public.requisition_status language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_req public.requisitions%rowtype;
  v_target public.requisition_status;
  v_any_purchased boolean;
  v_all_accounted boolean;
  v_any_ordered boolean;
  v_any_po boolean;
begin
  select * into v_req from public.requisitions where id = p_requisition_id for update;

  update public.requisition_items i set
    po_quantity = coalesce((
      select sum(poi.quantity) from public.purchase_order_items poi
      join public.purchase_orders po on po.id = poi.purchase_order_id
      where poi.requisition_item_id = i.id and po.status = 'issued'), 0),
    ordered_quantity = coalesce((
      select sum(voi.quantity) from public.vendor_order_items voi
      join public.vendor_orders vo on vo.id = voi.vendor_order_id
      where voi.requisition_item_id = i.id and vo.status = 'placed'), 0),
    purchased_quantity = coalesce((
      select sum(a.quantity) from public.receipt_item_allocations a
      join public.receipts r on r.id = a.receipt_id
      where a.requisition_item_id = i.id and r.status = 'reconciled'), 0),
    actual_total = coalesce((
      select sum(a.actual_amount) from public.receipt_item_allocations a
      join public.receipts r on r.id = a.receipt_id
      where a.requisition_item_id = i.id and r.status = 'reconciled'), 0)
  where i.requisition_id = p_requisition_id;

  update public.requisitions r set
    approved_total = coalesce((select sum(approved_total) from public.requisition_items where requisition_id = r.id), 0),
    actual_total = coalesce((select sum(actual_total) from public.requisition_items where requisition_id = r.id), 0),
    disbursed_total = coalesce((select sum(amount) from public.disbursements where requisition_id = r.id), 0)
  where r.id = p_requisition_id;

  if v_req.status not in ('approved', 'partially_approved', 'po_issued', 'ordered', 'partially_purchased', 'purchased') then
    return v_req.status;
  end if;

  select
    coalesce(bool_or(purchased_quantity > 0), false),
    coalesce(bool_and(purchased_quantity + cancelled_quantity >= approved_quantity), true),
    coalesce(bool_or(ordered_quantity > 0), false)
  into v_any_purchased, v_all_accounted, v_any_ordered
  from public.requisition_items
  where requisition_id = p_requisition_id and review_status = 'approved';

  select exists (select 1 from public.purchase_orders where requisition_id = p_requisition_id and status = 'issued')
  into v_any_po;

  v_target := case
    when v_any_purchased and v_all_accounted then 'purchased'
    when v_any_purchased then 'partially_purchased'
    when v_any_ordered then 'ordered'
    when v_any_po then 'po_issued'
    else coalesce(v_req.review_outcome, v_req.status)
  end;

  if v_target <> v_req.status then
    perform private.set_requisition_status(p_requisition_id, v_target, 'Updated automatically from purchasing activity');
    if v_target = 'purchased' then
      perform private.write_audit('requisition.purchase_completed', 'requisition', p_requisition_id, p_requisition_id,
        jsonb_build_object('status', v_req.status),
        jsonb_build_object('status', v_target,
                           'actual_total', (select actual_total from public.requisitions where id = p_requisition_id)),
        '{}'::jsonb);
    end if;
  end if;
  return v_target;
end $$;

-- ---------------------------------------------------------------------------
-- External form links
-- ---------------------------------------------------------------------------
create or replace function private.resolve_form_token(p_token text)
returns public.external_form_tokens language sql stable security definer set search_path = public, pg_temp as $$
  select t.* from public.external_form_tokens t
  where p_token ~ '^[A-Za-z0-9_-]{32,128}$'
    and t.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
    and t.is_active
    and t.revoked_at is null
    and (t.expires_at is null or t.expires_at > now())
    and (t.max_submissions is null or t.submission_count < t.max_submissions)
$$;

-- Public (anon) entry point: everything the form needs, nothing else.
create or replace function public.get_request_form_context(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_token public.external_form_tokens;
  v_settings public.church_settings;
begin
  v_token := private.resolve_form_token(p_token);
  if v_token.id is null then
    return null;
  end if;
  select * into v_settings from public.church_settings where id = 1;

  return jsonb_build_object(
    'church', jsonb_build_object(
      'name', v_settings.church_name,
      'address_line1', v_settings.address_line1,
      'address_line2', v_settings.address_line2,
      'city', v_settings.city,
      'region', v_settings.region,
      'postal_code', v_settings.postal_code,
      'country', v_settings.country,
      'phone', v_settings.phone,
      'email', v_settings.email
    ),
    'policy', v_settings.requisition_policy,
    'currency', v_settings.currency_code,
    'timezone', v_settings.timezone,
    'today', private.church_today(),
    'restricted_department_id', v_token.department_id,
    'departments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'name', d.name,
        'subcategories', coalesce((
          select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.sort_order, s.name)
          from public.department_subcategories s
          where s.department_id = d.id and s.is_active), '[]'::jsonb)
      ) order by d.sort_order, d.name)
      from public.departments d
      where d.is_active and (v_token.department_id is null or d.id = v_token.department_id)
    ), '[]'::jsonb),
    'request_types', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rt.id, 'key', rt.key, 'name', rt.name, 'description', rt.description,
        'help_text', rt.help_text, 'workflow', rt.workflow, 'is_default', rt.is_default,
        'requires_receipt_on_submission', rt.requires_receipt_on_submission,
        'requires_purchase_details', rt.requires_purchase_details,
        'requires_cost_center', rt.requires_cost_center,
        'max_total', rt.max_total::text
      ) order by rt.sort_order, rt.name)
      from public.request_types rt where rt.is_active
    ), '[]'::jsonb),
    'cost_centers', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name, 'department_id', c.department_id)
                       order by c.sort_order, c.code)
      from public.cost_centers c where c.is_active
    ), '[]'::jsonb)
  );
end $$;

-- Verify uploaded Storage objects and return normalised file metadata.
create or replace function private.verify_storage_files(p_files jsonb, p_prefix text)
returns table (storage_path text, original_filename text, mime_type text, size_bytes bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_file jsonb;
  v_obj record;
  v_mime text;
  v_size bigint;
begin
  if p_files is null or jsonb_typeof(p_files) <> 'array' then
    return;
  end if;
  if jsonb_array_length(p_files) > 10 then
    perform private.fail('No more than 10 files can be attached at once');
  end if;
  for v_file in select * from jsonb_array_elements(p_files) loop
    storage_path := v_file ->> 'path';
    if storage_path is null or left(storage_path, length(p_prefix)) <> p_prefix
       or storage_path ~ '\.\.' or storage_path !~ '\.(pdf|jpe?g|png|heic|heif)$' then
      perform private.fail('Invalid receipt file path');
    end if;
    select o.metadata into v_obj from storage.objects o
    where o.bucket_id = 'receipts' and o.name = storage_path;
    if not found then
      perform private.fail('Uploaded receipt file was not found. Please upload it again.');
    end if;
    if exists (select 1 from public.receipt_files rf where rf.storage_bucket = 'receipts' and rf.storage_path = v_file ->> 'path') then
      perform private.fail('This receipt file is already attached');
    end if;
    v_mime := lower(coalesce(v_obj.metadata ->> 'mimetype', ''));
    v_size := coalesce((v_obj.metadata ->> 'size')::bigint, 0);
    if v_mime not in ('application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif') then
      perform private.fail('Receipts must be PDF, JPEG, PNG or HEIC files');
    end if;
    if v_size <= 0 or v_size > 10485760 then
      perform private.fail('Receipt files must be 10 MB or smaller');
    end if;
    original_filename := left(coalesce(nullif(btrim(v_file ->> 'original_filename'), ''), 'receipt'), 255);
    mime_type := v_mime;
    size_bytes := v_size;
    return next;
  end loop;
end $$;

-- Called ONLY by trusted server code (service_role) after the app has validated
-- the request, rate-limited it, and uploaded any receipt files.
create or replace function public.submit_requisition(
  p_token text,
  p_payload jsonb,
  p_files jsonb default '[]'::jsonb,
  p_fingerprint text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_token public.external_form_tokens;
  v_type public.request_types;
  v_department public.departments;
  v_subcategory public.department_subcategories;
  v_cost_center_id uuid;
  v_today date := private.church_today();
  v_needed date;
  v_budget public.budget_status;
  v_item jsonb;
  v_line int := 0;
  v_qty numeric;
  v_price numeric;
  v_total numeric := 0;
  v_req_id uuid := gen_random_uuid();
  v_number text;
  v_actual numeric;
  v_purchase_date date;
  v_email text := lower(btrim(coalesce(p_payload ->> 'requester_email', '')));
  v_receipt_id uuid;
  v_file_count int := 0;
  v_req public.requisitions;
  v_pref public.notification_preferences;
begin
  perform set_config('app.actor_label', 'external:' || left(v_email, 200), true);

  v_token := private.resolve_form_token(p_token);
  if v_token.id is null then
    perform private.fail('This requisition link is invalid or has expired');
  end if;
  if not private.check_rate_limit('submit:token:' || v_token.id, 30, interval '1 hour') then
    perform private.fail('Too many submissions from this link. Please try again later.');
  end if;
  if p_fingerprint is not null and not private.check_rate_limit('submit:fp:' || left(p_fingerprint, 128), 10, interval '1 hour') then
    perform private.fail('Too many submissions. Please try again later.');
  end if;

  -- Request type
  select * into v_type from public.request_types
  where id = nullif(p_payload ->> 'request_type_id', '')::uuid and is_active;
  if v_type.id is null then perform private.fail('Please choose a valid request type'); end if;

  -- Department / subcategory
  select * into v_department from public.departments
  where id = nullif(p_payload ->> 'department_id', '')::uuid and is_active;
  if v_department.id is null then perform private.fail('Please choose a valid department'); end if;
  if v_token.department_id is not null and v_token.department_id <> v_department.id then
    perform private.fail('This link can only be used for its assigned department');
  end if;
  select * into v_subcategory from public.department_subcategories
  where id = nullif(p_payload ->> 'subcategory_id', '')::uuid and department_id = v_department.id and is_active;
  if v_subcategory.id is null then perform private.fail('Please choose a subcategory for the selected department'); end if;

  -- Cost center
  v_cost_center_id := nullif(p_payload ->> 'cost_center_id', '')::uuid;
  if v_cost_center_id is not null and not exists (select 1 from public.cost_centers where id = v_cost_center_id and is_active) then
    perform private.fail('Please choose a valid budget line / cost center');
  end if;
  if v_type.requires_cost_center and v_cost_center_id is null then
    perform private.fail('A budget line / cost center is required for this request type');
  end if;

  -- Dates
  begin
    v_needed := (p_payload ->> 'needed_by')::date;
  exception when others then
    perform private.fail('Please enter a valid date needed');
  end;
  if v_needed is null or v_needed < v_today or v_needed > v_today + 730 then
    perform private.fail('The date needed must be today or a future date');
  end if;

  -- Budget status
  if coalesce(p_payload ->> 'budget_status', '') not in ('yes', 'no', 'unsure') then
    perform private.fail('Please answer whether this purchase is within your approved budget');
  end if;
  v_budget := (p_payload ->> 'budget_status')::public.budget_status;
  if v_budget <> 'yes' and length(btrim(coalesce(p_payload ->> 'budget_explanation', ''))) < 5 then
    perform private.fail('Please explain the budget situation');
  end if;

  if coalesce((p_payload ->> 'certification_accepted')::boolean, false) is not true then
    perform private.fail('You must accept the requester certification');
  end if;

  -- Purchase details (e.g. Reimbursement)
  if v_type.requires_purchase_details then
    v_actual := private.parse_amount(p_payload ->> 'actual_purchase_amount', 'Actual purchase amount');
    if v_actual <= 0 then perform private.fail('Actual purchase amount must be greater than zero'); end if;
    if length(btrim(coalesce(p_payload ->> 'purchase_vendor', ''))) < 2 then
      perform private.fail('Vendor is required for this request type');
    end if;
    begin
      v_purchase_date := (p_payload ->> 'purchase_date')::date;
    exception when others then
      perform private.fail('Please enter a valid purchase date');
    end;
    if v_purchase_date is null or v_purchase_date > v_today or v_purchase_date < v_today - 365 then
      perform private.fail('Purchase date must be within the last 12 months and not in the future');
    end if;
  end if;

  -- Items
  if jsonb_typeof(p_payload -> 'items') <> 'array' or jsonb_array_length(p_payload -> 'items') = 0 then
    perform private.fail('Add at least one item');
  end if;
  if jsonb_array_length(p_payload -> 'items') > 50 then
    perform private.fail('A requisition can contain at most 50 items');
  end if;

  v_number := private.next_document_number('REQ');

  insert into public.requisitions (
    id, requisition_number, status, form_token_id, request_type_id, department_id, subcategory_id,
    cost_center_id, requester_name, requester_email, requester_phone, department_head_name,
    needed_by, budget_status, budget_explanation, justification, certification_accepted,
    certification_name, certified_at, actual_purchase_amount, purchase_vendor, purchase_date,
    submission_fingerprint, estimated_total
  ) values (
    v_req_id, v_number, 'submitted', v_token.id, v_type.id, v_department.id, v_subcategory.id,
    v_cost_center_id,
    btrim(p_payload ->> 'requester_name'), v_email, btrim(p_payload ->> 'requester_phone'),
    btrim(p_payload ->> 'department_head_name'),
    v_needed, v_budget,
    case when v_budget = 'yes' then null else private.clean_text(p_payload ->> 'budget_explanation', 2000) end,
    btrim(p_payload ->> 'justification'), true,
    btrim(coalesce(p_payload ->> 'certification_name', p_payload ->> 'requester_name')), now(),
    v_actual,
    case when v_type.requires_purchase_details then private.clean_text(p_payload ->> 'purchase_vendor', 200) end,
    v_purchase_date,
    left(p_fingerprint, 128), 0
  );

  for v_item in select * from jsonb_array_elements(p_payload -> 'items') loop
    v_line := v_line + 1;
    v_qty := private.parse_quantity(v_item ->> 'quantity', format('Item %s quantity', v_line));
    v_price := private.parse_amount(v_item ->> 'estimated_unit_price', format('Item %s unit price', v_line));
    insert into public.requisition_items (
      requisition_id, line_number, description, specifications, color, size, quantity,
      estimated_unit_price, estimated_total, vendor_name, vendor_url, notes
    ) values (
      v_req_id, v_line, btrim(v_item ->> 'description'),
      private.clean_text(v_item ->> 'specifications', 2000),
      private.clean_text(v_item ->> 'color', 60),
      private.clean_text(v_item ->> 'size', 60),
      v_qty, v_price, round(v_qty * v_price, 2),
      private.clean_text(v_item ->> 'vendor_name', 200),
      private.clean_text(v_item ->> 'vendor_url', 2000),
      private.clean_text(v_item ->> 'notes', 2000)
    );
    v_total := v_total + round(v_qty * v_price, 2);
  end loop;

  if v_type.max_total is not null and v_total > v_type.max_total then
    perform private.fail(format('%s requests are limited to %s', v_type.name, v_type.max_total));
  end if;

  update public.requisitions set estimated_total = v_total where id = v_req_id;

  -- Receipts submitted with the request
  if p_files is not null and jsonb_typeof(p_files) = 'array' and jsonb_array_length(p_files) > 0 then
    insert into public.receipts (requisition_id, source, status, vendor_name, purchase_date, total_amount, submitted_by_label)
    values (v_req_id, 'submission', 'pending',
            case when v_type.requires_purchase_details then private.clean_text(p_payload ->> 'purchase_vendor', 200) end,
            v_purchase_date, v_actual, 'external:' || v_email)
    returning id into v_receipt_id;
    insert into public.receipt_files (receipt_id, storage_path, original_filename, mime_type, size_bytes)
    select v_receipt_id, f.storage_path, f.original_filename, f.mime_type, f.size_bytes
    from private.verify_storage_files(p_files, 'external/' || v_token.id || '/') f;
    get diagnostics v_file_count = row_count;
  end if;
  if v_type.requires_receipt_on_submission and v_file_count = 0 then
    perform private.fail('A receipt upload is required for this request type');
  end if;

  insert into public.requisition_status_history (requisition_id, from_status, to_status, changed_by_label, comment)
  values (v_req_id, null, 'submitted', 'external:' || v_email, 'Submitted through external requisition form');

  insert into public.notification_preferences (requisition_id, email, phone, email_opt_in, sms_opt_in, sms_consent_at)
  values (v_req_id, v_email, btrim(p_payload ->> 'requester_phone'), true,
          coalesce((p_payload ->> 'sms_opt_in')::boolean, false),
          case when coalesce((p_payload ->> 'sms_opt_in')::boolean, false) then now() end)
  returning * into v_pref;

  update public.external_form_tokens
     set submission_count = submission_count + 1, last_used_at = now()
   where id = v_token.id;

  select * into v_req from public.requisitions where id = v_req_id;

  perform private.write_audit('requisition.submitted', 'requisition', v_req_id, v_req_id, null,
    jsonb_build_object('requisition_number', v_number, 'estimated_total', v_total, 'request_type', v_type.key,
                       'department', v_department.name, 'items', v_line, 'receipt_files', v_file_count),
    jsonb_build_object('form_token_id', v_token.id));

  return jsonb_build_object(
    'id', v_req.id,
    'requisition_number', v_req.requisition_number,
    'status', v_req.status,
    'submitted_at', v_req.submitted_at,
    'needed_by', v_req.needed_by,
    'department_name', v_department.name,
    'subcategory_name', v_subcategory.name,
    'request_type_name', v_type.name,
    'estimated_total', v_req.estimated_total::text,
    'requester_name', v_req.requester_name,
    'requester_email', v_req.requester_email,
    'reply_token', v_req.reply_token,
    'manage_token', v_pref.manage_token,
    'items', (select jsonb_agg(jsonb_build_object('line_number', line_number, 'description', description,
                                                  'quantity', quantity::text, 'estimated_total', estimated_total::text)
                               order by line_number)
              from public.requisition_items where requisition_id = v_req_id)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Sunday Entry
-- ---------------------------------------------------------------------------
create or replace function public.save_sunday_entry(
  p_service_date date,
  p_service_name text default 'Sunday Service',
  p_attendance jsonb default null,   -- [{category_id, count|null}]
  p_finance jsonb default null,      -- [{category_id, subcategory_id|null, amount|null, notes}]
  p_notes text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_service_id uuid;
  v_row jsonb;
  v_count int;
  v_amount numeric;
  v_category uuid;
  v_sub uuid;
  v_existing public.finance_entries;
  v_allows_negative boolean;
  v_name text := coalesce(nullif(btrim(p_service_name), ''), 'Sunday Service');
begin
  if p_attendance is null and p_finance is null then
    perform private.fail('Nothing to save');
  end if;
  if p_attendance is not null then perform private.require_permission('attendance.enter'); end if;
  if p_finance is not null then perform private.require_permission('finance.enter'); end if;
  if p_service_date is null or p_service_date > private.church_today() + 1 or p_service_date < date '2000-01-01' then
    perform private.fail('Please choose a valid service date (not in the future)');
  end if;

  insert into public.service_dates (service_date, service_name, notes, created_by)
  values (p_service_date, left(v_name, 80), private.clean_text(p_notes, 1000), auth.uid())
  on conflict (service_date, service_name) do update
    set notes = coalesce(private.clean_text(excluded.notes, 1000), public.service_dates.notes)
  returning id into v_service_id;

  if p_attendance is not null then
    for v_row in select * from jsonb_array_elements(p_attendance) loop
      v_category := (v_row ->> 'category_id')::uuid;
      if not exists (select 1 from public.categories where id = v_category and type = 'attendance') then
        perform private.fail('Unknown attendance category');
      end if;
      if v_row ->> 'count' is null or btrim(v_row ->> 'count') = '' then
        delete from public.attendance_entries where service_date_id = v_service_id and category_id = v_category;
        continue;
      end if;
      if btrim(v_row ->> 'count') !~ '^[0-9]{1,7}$' then
        perform private.fail('Attendance counts must be whole numbers of 0 or more');
      end if;
      v_count := (v_row ->> 'count')::int;
      if not exists (select 1 from public.categories where id = v_category and is_active)
         and not exists (select 1 from public.attendance_entries where service_date_id = v_service_id and category_id = v_category) then
        perform private.fail('This attendance category is archived');
      end if;
      insert into public.attendance_entries (service_date_id, category_id, count, entered_by, updated_by)
      values (v_service_id, v_category, v_count, auth.uid(), auth.uid())
      on conflict (service_date_id, category_id) do update
        set count = excluded.count, updated_by = auth.uid()
        where public.attendance_entries.count is distinct from excluded.count;
    end loop;
  end if;

  if p_finance is not null then
    for v_row in select * from jsonb_array_elements(p_finance) loop
      v_category := (v_row ->> 'category_id')::uuid;
      v_sub := nullif(v_row ->> 'subcategory_id', '')::uuid;
      if not exists (select 1 from public.categories where id = v_category and type = 'finance' and parent_id is null) then
        perform private.fail('Unknown finance category');
      end if;
      select * into v_existing from public.finance_entries
      where service_date_id = v_service_id and category_id = v_category
        and subcategory_id is not distinct from v_sub and voided_at is null;

      if v_row ->> 'amount' is null or btrim(v_row ->> 'amount') = '' then
        if v_existing.id is not null then
          update public.finance_entries
             set voided_at = now(), voided_by = auth.uid(), void_reason = 'Cleared in Sunday Entry', updated_by = auth.uid()
           where id = v_existing.id;
        end if;
        continue;
      end if;

      select bool_or(allows_negative) into v_allows_negative from public.categories where id in (v_category, v_sub);
      v_amount := private.parse_amount(v_row ->> 'amount', 'Amount', coalesce(v_allows_negative, false));

      if v_existing.id is null then
        if not exists (select 1 from public.categories where id = v_category and is_active)
           or (v_sub is not null and not exists (select 1 from public.categories where id = v_sub and is_active)) then
          perform private.fail('This finance category is archived');
        end if;
        insert into public.finance_entries (service_date_id, category_id, subcategory_id, amount, notes, entered_by, updated_by)
        values (v_service_id, v_category, v_sub, v_amount, private.clean_text(v_row ->> 'notes', 1000), auth.uid(), auth.uid());
      elsif v_existing.amount <> v_amount or v_existing.notes is distinct from private.clean_text(v_row ->> 'notes', 1000) then
        update public.finance_entries
           set amount = v_amount, notes = private.clean_text(v_row ->> 'notes', 1000), updated_by = auth.uid()
         where id = v_existing.id;
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'service_date_id', v_service_id,
    'attendance_total', (select coalesce(sum(count), 0) from public.attendance_entries where service_date_id = v_service_id),
    'finance_total', (select coalesce(sum(amount), 0)::text from public.finance_entries where service_date_id = v_service_id and voided_at is null)
  );
end $$;

create or replace function public.void_finance_entry(p_entry_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform private.require_permission('finance.void');
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    perform private.fail('A reason is required to void a finance entry');
  end if;
  update public.finance_entries
     set voided_at = now(), voided_by = auth.uid(), void_reason = left(btrim(p_reason), 500), updated_by = auth.uid()
   where id = p_entry_id and voided_at is null;
  if not found then perform private.fail('Finance entry not found or already voided'); end if;
end $$;

-- ---------------------------------------------------------------------------
-- Finance review
-- ---------------------------------------------------------------------------
create or replace function public.start_requisition_review(p_requisition_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_prev public.requisition_status;
begin
  perform private.require_permission('requisitions.review');
  v_prev := private.set_requisition_status(p_requisition_id, 'under_review', 'Review started');
  update public.requisitions set assigned_reviewer_id = coalesce(assigned_reviewer_id, auth.uid())
  where id = p_requisition_id;
  return jsonb_build_object('previous_status', v_prev, 'status', 'under_review');
end $$;

create or replace function public.assign_requisition_reviewer(p_requisition_id uuid, p_reviewer_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_before uuid;
begin
  perform private.require_permission('requisitions.review');
  if p_reviewer_id is not null and not exists (select 1 from public.profiles where id = p_reviewer_id and is_active) then
    perform private.fail('Reviewer must be an active user');
  end if;
  select assigned_reviewer_id into v_before from public.requisitions where id = p_requisition_id for update;
  if not found then perform private.fail('Requisition not found'); end if;
  update public.requisitions set assigned_reviewer_id = p_reviewer_id where id = p_requisition_id;
  perform private.write_audit('requisition.reviewer_assigned', 'requisition', p_requisition_id, p_requisition_id,
    jsonb_build_object('assigned_reviewer_id', v_before), jsonb_build_object('assigned_reviewer_id', p_reviewer_id));
end $$;

-- p_decision: approve | partial | hold | reject
-- p_items: [{item_id, decision: approved|held|rejected, approved_quantity?, approved_unit_price?, comment?}]
create or replace function public.review_requisition(
  p_requisition_id uuid,
  p_decision text,
  p_items jsonb default '[]'::jsonb,
  p_comment text default null,
  p_cost_center_id uuid default null,
  p_expense_category_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_req public.requisitions;
  v_item public.requisition_items;
  v_input jsonb;
  v_decision text;
  v_qty numeric;
  v_price numeric;
  v_comment text := private.clean_text(p_comment, 2000);
  v_line_comment text;
  v_approved int := 0;
  v_not_approved int := 0;
  v_reduced int := 0;
  v_target public.requisition_status;
  v_prev public.requisition_status;
begin
  perform private.require_permission('requisitions.review');
  select * into v_req from public.requisitions where id = p_requisition_id for update;
  if v_req.id is null then perform private.fail('Requisition not found'); end if;
  if v_req.status not in ('submitted', 'under_review', 'on_hold') then
    perform private.fail('Only submitted, under-review or on-hold requisitions can be reviewed');
  end if;
  if p_decision not in ('approve', 'partial', 'hold', 'reject') then
    perform private.fail('Unknown review decision');
  end if;
  if p_decision in ('hold', 'reject') and v_comment is null then
    perform private.fail('A comment is required when holding or rejecting a requisition');
  end if;
  if p_cost_center_id is not null and not exists (select 1 from public.cost_centers where id = p_cost_center_id) then
    perform private.fail('Unknown cost center');
  end if;
  if p_expense_category_id is not null and not exists (
    select 1 from public.categories where id = p_expense_category_id and type = 'requisition') then
    perform private.fail('Unknown expense category');
  end if;

  if p_decision = 'hold' then
    -- Optional per-line notes; quantities are not approved while on hold.
    for v_input in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
      update public.requisition_items
         set review_status = case when v_input ->> 'decision' = 'rejected' then 'rejected'::public.item_review_status
                                  else 'held'::public.item_review_status end,
             review_comment = coalesce(private.clean_text(v_input ->> 'comment', 1000), review_comment)
       where id = (v_input ->> 'item_id')::uuid and requisition_id = p_requisition_id;
    end loop;
    v_target := 'on_hold';
  else
    for v_item in select * from public.requisition_items where requisition_id = p_requisition_id order by line_number loop
      v_input := null;
      select e into v_input from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
      where e ->> 'item_id' = v_item.id::text;

      v_decision := case p_decision
        when 'reject' then 'rejected'
        when 'approve' then coalesce(v_input ->> 'decision', 'approved')
        else v_input ->> 'decision'
      end;
      if v_decision is null or v_decision not in ('approved', 'held', 'rejected') then
        perform private.fail(format('Choose approve, hold or reject for line %s', v_item.line_number));
      end if;
      if p_decision = 'approve' and v_decision <> 'approved' then
        perform private.fail('Use Partial Approval when some lines are not approved');
      end if;
      v_line_comment := coalesce(private.clean_text(v_input ->> 'comment', 1000), v_comment);

      if v_decision = 'approved' then
        v_qty := case when v_input ? 'approved_quantity' and nullif(v_input ->> 'approved_quantity', '') is not null
                      then private.parse_quantity(v_input ->> 'approved_quantity', format('Line %s approved quantity', v_item.line_number))
                      else v_item.quantity end;
        v_price := case when v_input ? 'approved_unit_price' and nullif(v_input ->> 'approved_unit_price', '') is not null
                        then private.parse_amount(v_input ->> 'approved_unit_price', format('Line %s approved unit price', v_item.line_number))
                        else v_item.estimated_unit_price end;
        if v_qty > v_item.quantity then
          perform private.fail(format('Line %s: approved quantity cannot exceed the requested quantity', v_item.line_number));
        end if;
        if v_qty < v_item.quantity then v_reduced := v_reduced + 1; end if;
        update public.requisition_items
           set review_status = 'approved', approved_quantity = v_qty, approved_unit_price = v_price,
               approved_total = round(v_qty * v_price, 2), review_comment = private.clean_text(v_input ->> 'comment', 1000)
         where id = v_item.id;
        v_approved := v_approved + 1;
      else
        if v_line_comment is null then
          perform private.fail(format('Line %s: a comment is required when holding or rejecting', v_item.line_number));
        end if;
        update public.requisition_items
           set review_status = v_decision::public.item_review_status, approved_quantity = null,
               approved_unit_price = null, approved_total = 0, review_comment = v_line_comment
         where id = v_item.id;
        v_not_approved := v_not_approved + 1;
      end if;
    end loop;

    if v_approved = 0 and p_decision <> 'reject' then
      if exists (select 1 from public.requisition_items where requisition_id = p_requisition_id and review_status = 'held') then
        v_target := 'on_hold';
      else
        v_target := 'rejected';
      end if;
    elsif p_decision = 'reject' then
      v_target := 'rejected';
    elsif v_not_approved = 0 and v_reduced = 0 then
      v_target := 'approved';
    else
      v_target := 'partially_approved';
    end if;
    if p_decision = 'partial' and v_target = 'approved' then
      perform private.fail('Every line is fully approved — use Approve instead of Partial Approval');
    end if;
  end if;

  update public.requisitions
     set reviewed_by = auth.uid(), reviewed_at = now(), review_comment = v_comment,
         assigned_reviewer_id = coalesce(assigned_reviewer_id, auth.uid()),
         review_outcome = case when v_target in ('approved', 'partially_approved') then v_target else null end,
         cost_center_id = coalesce(p_cost_center_id, cost_center_id),
         expense_category_id = coalesce(p_expense_category_id, expense_category_id)
   where id = p_requisition_id;

  v_prev := private.set_requisition_status(p_requisition_id, v_target, v_comment);
  perform private.refresh_requisition_progress(p_requisition_id);

  perform private.write_audit(
    case v_target when 'approved' then 'requisition.approved' when 'partially_approved' then 'requisition.partially_approved'
                  when 'rejected' then 'requisition.rejected' else 'requisition.held' end,
    'requisition', p_requisition_id, p_requisition_id,
    jsonb_build_object('status', v_prev),
    jsonb_build_object('status', v_target,
                       'approved_total', (select approved_total from public.requisitions where id = p_requisition_id),
                       'items', (select jsonb_agg(jsonb_build_object('line', line_number, 'decision', review_status,
                                   'approved_quantity', approved_quantity, 'approved_unit_price', approved_unit_price,
                                   'comment', review_comment) order by line_number)
                                 from public.requisition_items where requisition_id = p_requisition_id)),
    jsonb_build_object('comment', v_comment));

  return jsonb_build_object('previous_status', v_prev, 'status', v_target,
    'approved_total', (select approved_total::text from public.requisitions where id = p_requisition_id));
end $$;

-- ---------------------------------------------------------------------------
-- Purchase orders
-- ---------------------------------------------------------------------------
create or replace function public.issue_purchase_order(
  p_requisition_id uuid,
  p_items jsonb default null,      -- [{requisition_item_id, quantity, unit_price}] or null = all remaining
  p_vendor jsonb default '{}'::jsonb,
  p_notes text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_req public.requisitions;
  v_type public.request_types;
  v_po_id uuid := gen_random_uuid();
  v_number text;
  v_item public.requisition_items;
  v_input jsonb;
  v_qty numeric;
  v_price numeric;
  v_remaining numeric;
  v_line int := 0;
  v_total numeric := 0;
  v_prev public.requisition_status;
  v_status public.requisition_status;
  v_vendor_url text := private.clean_text(p_vendor ->> 'url', 2000);
begin
  perform private.require_permission('purchase_orders.issue');
  select * into v_req from public.requisitions where id = p_requisition_id for update;
  if v_req.id is null then perform private.fail('Requisition not found'); end if;
  select * into v_type from public.request_types where id = v_req.request_type_id;
  if not v_type.issues_purchase_order then
    perform private.fail(format('%s requests do not use Purchase Orders', v_type.name));
  end if;
  if v_req.status not in ('approved', 'partially_approved', 'po_issued', 'ordered', 'partially_purchased') then
    perform private.fail('A Purchase Order can only be issued for an approved requisition');
  end if;
  if v_vendor_url is not null and v_vendor_url !~* '^https?://' then
    perform private.fail('Vendor website must start with http:// or https://');
  end if;

  perform private.refresh_requisition_progress(p_requisition_id);
  v_prev := v_req.status;
  v_number := private.next_document_number('PO');

  insert into public.purchase_orders (id, po_number, requisition_id, vendor_name, vendor_contact, vendor_email,
                                      vendor_phone, vendor_address, vendor_url, notes, issued_by, is_demo)
  values (v_po_id, v_number, p_requisition_id,
          private.clean_text(p_vendor ->> 'name', 200), private.clean_text(p_vendor ->> 'contact', 200),
          private.clean_text(p_vendor ->> 'email', 254), private.clean_text(p_vendor ->> 'phone', 40),
          private.clean_text(p_vendor ->> 'address', 500), v_vendor_url,
          private.clean_text(p_notes, 2000), auth.uid(), v_req.is_demo);

  for v_item in select * from public.requisition_items
                where requisition_id = p_requisition_id and review_status = 'approved' order by line_number loop
    v_remaining := v_item.approved_quantity - v_item.po_quantity - v_item.cancelled_quantity;
    if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
      continue when v_remaining <= 0;
      v_qty := v_remaining;
      v_price := v_item.approved_unit_price;
    else
      v_input := null;
      select e into v_input from jsonb_array_elements(p_items) e where e ->> 'requisition_item_id' = v_item.id::text;
      continue when v_input is null;
      v_qty := private.parse_quantity(v_input ->> 'quantity', format('Line %s quantity', v_item.line_number));
      v_price := case when nullif(v_input ->> 'unit_price', '') is null then v_item.approved_unit_price
                      else private.parse_amount(v_input ->> 'unit_price', format('Line %s unit price', v_item.line_number)) end;
      if v_qty > v_remaining then
        perform private.fail(format('Line %s: only %s remain to be placed on a Purchase Order', v_item.line_number, v_remaining));
      end if;
    end if;
    v_line := v_line + 1;
    insert into public.purchase_order_items (purchase_order_id, requisition_item_id, line_number, description,
                                             quantity, unit_price, line_total)
    values (v_po_id, v_item.id, v_line, v_item.description, v_qty, v_price, round(v_qty * v_price, 2));
    v_total := v_total + round(v_qty * v_price, 2);
  end loop;

  if p_items is not null and jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) > 0
     and v_line <> jsonb_array_length(p_items) then
    perform private.fail('Every Purchase Order line must be an approved line of this requisition');
  end if;
  if v_line = 0 then
    perform private.fail('There are no approved quantities left to place on a Purchase Order');
  end if;

  update public.purchase_orders set total = v_total where id = v_po_id;
  v_status := private.refresh_requisition_progress(p_requisition_id);

  perform private.write_audit('purchase_order.issued', 'purchase_order', v_po_id, p_requisition_id, null,
    jsonb_build_object('po_number', v_number, 'total', v_total, 'lines', v_line), '{}'::jsonb);

  return jsonb_build_object('id', v_po_id, 'po_number', v_number, 'total', v_total::text,
                            'previous_status', v_prev, 'status', v_status);
end $$;

create or replace function public.set_purchase_order_pdf(p_purchase_order_id uuid, p_path text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform private.require_permission('purchase_orders.issue');
  if p_path !~ '^[0-9a-f-]{36}/TKT-PO-[0-9]{4}-[0-9]{4,}(-v[0-9]+)?\.pdf$' then
    perform private.fail('Invalid Purchase Order PDF path');
  end if;
  update public.purchase_orders set pdf_path = p_path, pdf_generated_at = now() where id = p_purchase_order_id;
  if not found then perform private.fail('Purchase Order not found'); end if;
  perform private.write_audit('purchase_order.pdf_generated', 'purchase_order', p_purchase_order_id,
    (select requisition_id from public.purchase_orders where id = p_purchase_order_id), null,
    jsonb_build_object('pdf_path', p_path), '{}'::jsonb);
end $$;

create or replace function public.void_purchase_order(p_purchase_order_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_po public.purchase_orders;
  v_status public.requisition_status;
begin
  perform private.require_permission('purchase_orders.issue');
  if length(btrim(coalesce(p_reason, ''))) < 3 then perform private.fail('A reason is required to void a Purchase Order'); end if;
  select * into v_po from public.purchase_orders where id = p_purchase_order_id for update;
  if v_po.id is null or v_po.status <> 'issued' then perform private.fail('Purchase Order not found or already void'); end if;
  if exists (select 1 from public.receipt_item_allocations a join public.receipts r on r.id = a.receipt_id
             where a.purchase_order_item_id in (select id from public.purchase_order_items where purchase_order_id = v_po.id)
               and r.status = 'reconciled') then
    perform private.fail('This Purchase Order has reconciled receipts and cannot be voided');
  end if;
  update public.purchase_orders set status = 'void', voided_at = now(), voided_by = auth.uid(),
         void_reason = left(btrim(p_reason), 500) where id = v_po.id;
  v_status := private.refresh_requisition_progress(v_po.requisition_id);
  perform private.write_audit('purchase_order.voided', 'purchase_order', v_po.id, v_po.requisition_id,
    jsonb_build_object('status', 'issued'), jsonb_build_object('status', 'void'), jsonb_build_object('reason', p_reason));
  return jsonb_build_object('status', v_status);
end $$;

-- ---------------------------------------------------------------------------
-- Vendor orders (Order workflow)
-- ---------------------------------------------------------------------------
create or replace function public.record_vendor_order(
  p_requisition_id uuid,
  p_order jsonb,   -- {vendor_name, vendor_reference, order_date, expected_delivery_date, notes, purchase_order_id}
  p_items jsonb    -- [{requisition_item_id, quantity, unit_price}]
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_req public.requisitions;
  v_type public.request_types;
  v_order_id uuid := gen_random_uuid();
  v_item public.requisition_items;
  v_input jsonb;
  v_qty numeric;
  v_price numeric;
  v_total numeric := 0;
  v_lines int := 0;
  v_po_id uuid := nullif(p_order ->> 'purchase_order_id', '')::uuid;
  v_order_date date;
  v_expected date;
  v_prev public.requisition_status;
  v_status public.requisition_status;
begin
  perform private.require_permission('orders.record');
  select * into v_req from public.requisitions where id = p_requisition_id for update;
  if v_req.id is null then perform private.fail('Requisition not found'); end if;
  select * into v_type from public.request_types where id = v_req.request_type_id;
  if not v_type.allows_vendor_orders then
    perform private.fail(format('%s requests do not record vendor orders', v_type.name));
  end if;
  if v_req.status not in ('approved', 'partially_approved', 'po_issued', 'ordered', 'partially_purchased') then
    perform private.fail('Orders can only be recorded for approved requisitions');
  end if;
  if length(btrim(coalesce(p_order ->> 'vendor_name', ''))) < 1 then perform private.fail('Vendor is required'); end if;
  begin
    v_order_date := (p_order ->> 'order_date')::date;
    v_expected := nullif(p_order ->> 'expected_delivery_date', '')::date;
  exception when others then
    perform private.fail('Please enter valid dates');
  end;
  if v_order_date is null or v_order_date > private.church_today() then
    perform private.fail('Order date is required and cannot be in the future');
  end if;
  if v_po_id is not null and not exists (
    select 1 from public.purchase_orders where id = v_po_id and requisition_id = p_requisition_id and status = 'issued') then
    perform private.fail('Purchase Order does not belong to this requisition');
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    perform private.fail('Select at least one item that was ordered');
  end if;

  perform private.refresh_requisition_progress(p_requisition_id);
  v_prev := v_req.status;

  insert into public.vendor_orders (id, requisition_id, purchase_order_id, vendor_name, vendor_reference, order_date,
                                    expected_delivery_date, notes, created_by, is_demo)
  values (v_order_id, p_requisition_id, v_po_id, btrim(p_order ->> 'vendor_name'),
          private.clean_text(p_order ->> 'vendor_reference', 120), v_order_date, v_expected,
          private.clean_text(p_order ->> 'notes', 2000), auth.uid(), v_req.is_demo);

  for v_input in select * from jsonb_array_elements(p_items) loop
    select * into v_item from public.requisition_items
    where id = (v_input ->> 'requisition_item_id')::uuid and requisition_id = p_requisition_id;
    if v_item.id is null or v_item.review_status <> 'approved' then
      perform private.fail('Only approved lines of this requisition can be ordered');
    end if;
    v_qty := private.parse_quantity(v_input ->> 'quantity', format('Line %s quantity', v_item.line_number));
    v_price := case when nullif(v_input ->> 'unit_price', '') is null then v_item.approved_unit_price
                    else private.parse_amount(v_input ->> 'unit_price', format('Line %s price', v_item.line_number)) end;
    if v_item.ordered_quantity + v_qty + v_item.cancelled_quantity > v_item.approved_quantity then
      perform private.fail(format('Line %s: only %s remain to be ordered', v_item.line_number,
        v_item.approved_quantity - v_item.ordered_quantity - v_item.cancelled_quantity));
    end if;
    insert into public.vendor_order_items (vendor_order_id, requisition_item_id, quantity, unit_price, line_total)
    values (v_order_id, v_item.id, v_qty, v_price, round(v_qty * v_price, 2));
    v_total := v_total + round(v_qty * v_price, 2);
    v_lines := v_lines + 1;
  end loop;

  update public.vendor_orders set total = v_total where id = v_order_id;
  v_status := private.refresh_requisition_progress(p_requisition_id);

  perform private.write_audit('vendor_order.recorded', 'vendor_order', v_order_id, p_requisition_id, null,
    jsonb_build_object('vendor', p_order ->> 'vendor_name', 'reference', p_order ->> 'vendor_reference',
                       'total', v_total, 'lines', v_lines), '{}'::jsonb);

  return jsonb_build_object('id', v_order_id, 'total', v_total::text, 'previous_status', v_prev, 'status', v_status);
end $$;

create or replace function public.cancel_vendor_order(p_vendor_order_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order public.vendor_orders;
  v_status public.requisition_status;
begin
  perform private.require_permission('orders.record');
  if length(btrim(coalesce(p_reason, ''))) < 3 then perform private.fail('A reason is required to cancel an order'); end if;
  select * into v_order from public.vendor_orders where id = p_vendor_order_id for update;
  if v_order.id is null or v_order.status <> 'placed' then perform private.fail('Order not found or already cancelled'); end if;
  update public.vendor_orders set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
         cancel_reason = left(btrim(p_reason), 500) where id = v_order.id;
  v_status := private.refresh_requisition_progress(v_order.requisition_id);
  perform private.write_audit('vendor_order.cancelled', 'vendor_order', v_order.id, v_order.requisition_id,
    jsonb_build_object('status', 'placed'), jsonb_build_object('status', 'cancelled'), jsonb_build_object('reason', p_reason));
  return jsonb_build_object('status', v_status);
end $$;

-- ---------------------------------------------------------------------------
-- Receipts
-- ---------------------------------------------------------------------------
create or replace function public.register_receipt(
  p_requisition_id uuid,
  p_purchase_order_id uuid,
  p_details jsonb,   -- {vendor_name, purchase_date, total_amount, reference, notes}
  p_files jsonb      -- [{path, original_filename}]
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_req public.requisitions;
  v_receipt_id uuid;
  v_count int;
  v_total numeric;
  v_date date;
begin
  perform private.require_permission('receipts.upload');
  select * into v_req from public.requisitions where id = p_requisition_id;
  if v_req.id is null then perform private.fail('Requisition not found'); end if;
  if v_req.status in ('rejected', 'closed') then
    perform private.fail('Receipts cannot be added to a rejected or closed requisition');
  end if;
  if p_purchase_order_id is not null and not exists (
    select 1 from public.purchase_orders where id = p_purchase_order_id and requisition_id = p_requisition_id) then
    perform private.fail('Purchase Order does not belong to this requisition');
  end if;
  if p_files is null or jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) = 0 then
    perform private.fail('Attach at least one receipt file');
  end if;
  if nullif(p_details ->> 'total_amount', '') is not null then
    v_total := private.parse_amount(p_details ->> 'total_amount', 'Receipt total');
  end if;
  begin
    v_date := nullif(p_details ->> 'purchase_date', '')::date;
  exception when others then
    perform private.fail('Please enter a valid purchase date');
  end;

  insert into public.receipts (requisition_id, purchase_order_id, source, status, vendor_name, purchase_date,
                               total_amount, reference, notes, uploaded_by, is_demo)
  values (p_requisition_id, p_purchase_order_id, 'upload', 'pending',
          private.clean_text(p_details ->> 'vendor_name', 200), v_date, v_total,
          private.clean_text(p_details ->> 'reference', 200), private.clean_text(p_details ->> 'notes', 2000),
          auth.uid(), v_req.is_demo)
  returning id into v_receipt_id;

  insert into public.receipt_files (receipt_id, storage_path, original_filename, mime_type, size_bytes)
  select v_receipt_id, f.storage_path, f.original_filename, f.mime_type, f.size_bytes
  from private.verify_storage_files(p_files, 'requisitions/' || p_requisition_id || '/') f;
  get diagnostics v_count = row_count;

  perform private.write_audit('receipt.uploaded', 'receipt', v_receipt_id, p_requisition_id, null,
    jsonb_build_object('files', v_count, 'total_amount', v_total, 'purchase_order_id', p_purchase_order_id), '{}'::jsonb);
  return v_receipt_id;
end $$;

-- Trusted server code only (inbound email webhook). Idempotent on provider message id.
create or replace function public.ingest_inbound_email(
  p_email jsonb,    -- {provider, provider_message_id, message_id_header, from, to[], subject, text_excerpt}
  p_match jsonb,    -- {requisition_id, purchase_order_id, method} (nulls when unmatched)
  p_files jsonb     -- [{path, original_filename}] already uploaded under inbound/<provider_message_id>/
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_email_id uuid;
  v_receipt_id uuid;
  v_req_id uuid := nullif(p_match ->> 'requisition_id', '')::uuid;
  v_po_id uuid := nullif(p_match ->> 'purchase_order_id', '')::uuid;
  v_status public.inbound_email_status;
  v_file_count int := coalesce(jsonb_array_length(p_files), 0);
  v_prefix text := 'inbound/' || regexp_replace(coalesce(p_email ->> 'provider_message_id', ''), '[^A-Za-z0-9_-]', '', 'g') || '/';
begin
  perform set_config('app.actor_label', 'system:inbound-email', true);

  if v_req_id is not null and not exists (select 1 from public.requisitions where id = v_req_id) then
    v_req_id := null; v_po_id := null;
  end if;
  if v_po_id is not null and not exists (select 1 from public.purchase_orders where id = v_po_id and requisition_id = v_req_id) then
    v_po_id := null;
  end if;
  v_status := case when v_file_count = 0 then 'ignored'
                   when v_req_id is null then 'unmatched' else 'matched' end;

  insert into public.inbound_emails (provider, provider_message_id, message_id_header, from_address, to_addresses,
                                     subject, text_excerpt, status, match_method, matched_requisition_id,
                                     matched_purchase_order_id, attachment_count, processed_at,
                                     error)
  values (p_email ->> 'provider', p_email ->> 'provider_message_id', left(p_email ->> 'message_id_header', 500),
          left(lower(p_email ->> 'from'), 254),
          coalesce((select array_agg(left(lower(x), 254)) from jsonb_array_elements_text(coalesce(p_email -> 'to', '[]'::jsonb)) x), '{}'),
          left(p_email ->> 'subject', 500), left(p_email ->> 'text_excerpt', 4000), v_status,
          p_match ->> 'method', v_req_id, v_po_id, v_file_count, now(),
          case when v_file_count = 0 then 'No supported receipt attachments' end)
  on conflict (provider, provider_message_id) do nothing
  returning id into v_email_id;

  if v_email_id is null then
    return jsonb_build_object('duplicate', true);
  end if;

  if v_file_count > 0 then
    insert into public.receipts (requisition_id, purchase_order_id, source, status, inbound_email_id, submitted_by_label, notes)
    values (v_req_id, v_po_id, 'email', case when v_req_id is null then 'unmatched'::public.receipt_status else 'pending' end,
            v_email_id, 'email:' || left(lower(p_email ->> 'from'), 200),
            left('Email subject: ' || coalesce(p_email ->> 'subject', ''), 2000))
    returning id into v_receipt_id;
    insert into public.receipt_files (receipt_id, storage_path, original_filename, mime_type, size_bytes)
    select v_receipt_id, f.storage_path, f.original_filename, f.mime_type, f.size_bytes
    from private.verify_storage_files(p_files, v_prefix) f;

    perform private.write_audit('receipt.received_by_email', 'receipt', v_receipt_id, v_req_id, null,
      jsonb_build_object('files', v_file_count, 'match_method', p_match ->> 'method', 'from', p_email ->> 'from'),
      jsonb_build_object('inbound_email_id', v_email_id));
  end if;

  return jsonb_build_object('duplicate', false, 'inbound_email_id', v_email_id, 'receipt_id', v_receipt_id,
                            'status', v_status, 'requisition_id', v_req_id);
end $$;

create or replace function public.assign_receipt(p_receipt_id uuid, p_requisition_id uuid, p_purchase_order_id uuid default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_receipt public.receipts;
begin
  perform private.require_permission('receipts.reconcile');
  select * into v_receipt from public.receipts where id = p_receipt_id for update;
  if v_receipt.id is null or v_receipt.status not in ('unmatched', 'pending') then
    perform private.fail('Only unmatched or pending receipts can be reassigned');
  end if;
  if not exists (select 1 from public.requisitions where id = p_requisition_id and status not in ('rejected', 'closed')) then
    perform private.fail('Choose an open requisition');
  end if;
  if p_purchase_order_id is not null and not exists (
    select 1 from public.purchase_orders where id = p_purchase_order_id and requisition_id = p_requisition_id) then
    perform private.fail('Purchase Order does not belong to this requisition');
  end if;
  update public.receipts set requisition_id = p_requisition_id, purchase_order_id = p_purchase_order_id, status = 'pending'
  where id = p_receipt_id;
  perform private.write_audit('receipt.assigned', 'receipt', p_receipt_id, p_requisition_id,
    jsonb_build_object('requisition_id', v_receipt.requisition_id, 'status', v_receipt.status),
    jsonb_build_object('requisition_id', p_requisition_id, 'purchase_order_id', p_purchase_order_id), '{}'::jsonb);
end $$;

-- Finance confirms what a receipt actually covers. Only this marks quantities purchased.
create or replace function public.reconcile_receipt(
  p_receipt_id uuid,
  p_allocations jsonb,   -- [{requisition_item_id, quantity, actual_amount, purchase_order_item_id?}]
  p_details jsonb default '{}'::jsonb  -- {vendor_name, purchase_date, total_amount, reference, notes}
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_receipt public.receipts;
  v_req public.requisitions;
  v_item public.requisition_items;
  v_input jsonb;
  v_qty numeric;
  v_amount numeric;
  v_poi uuid;
  v_sum numeric := 0;
  v_lines int := 0;
  v_date date;
  v_prev public.requisition_status;
  v_status public.requisition_status;
begin
  perform private.require_permission('receipts.reconcile');
  select * into v_receipt from public.receipts where id = p_receipt_id for update;
  if v_receipt.id is null then perform private.fail('Receipt not found'); end if;
  if v_receipt.status <> 'pending' or v_receipt.requisition_id is null then
    perform private.fail('Only pending receipts assigned to a requisition can be reconciled');
  end if;
  select * into v_req from public.requisitions where id = v_receipt.requisition_id for update;
  if v_req.status not in ('approved', 'partially_approved', 'po_issued', 'ordered', 'partially_purchased', 'purchased') then
    perform private.fail('Receipts can only be reconciled after the requisition is approved');
  end if;
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations) = 0 then
    perform private.fail('Match the receipt to at least one approved line');
  end if;
  begin
    v_date := nullif(p_details ->> 'purchase_date', '')::date;
  exception when others then
    perform private.fail('Please enter a valid purchase date');
  end;

  perform private.refresh_requisition_progress(v_req.id);
  v_prev := v_req.status;

  for v_input in select * from jsonb_array_elements(p_allocations) loop
    select * into v_item from public.requisition_items
    where id = (v_input ->> 'requisition_item_id')::uuid and requisition_id = v_req.id;
    if v_item.id is null or v_item.review_status <> 'approved' then
      perform private.fail('Receipts can only be matched to approved lines of this requisition');
    end if;
    v_qty := private.parse_quantity(v_input ->> 'quantity', format('Line %s purchased quantity', v_item.line_number));
    v_amount := private.parse_amount(v_input ->> 'actual_amount', format('Line %s actual amount', v_item.line_number));
    if v_item.purchased_quantity + v_item.cancelled_quantity + v_qty > v_item.approved_quantity then
      perform private.fail(format('Line %s: purchased quantity would exceed the approved quantity (%s remaining)',
        v_item.line_number, v_item.approved_quantity - v_item.purchased_quantity - v_item.cancelled_quantity));
    end if;
    v_poi := nullif(v_input ->> 'purchase_order_item_id', '')::uuid;
    if v_poi is not null and not exists (
      select 1 from public.purchase_order_items poi join public.purchase_orders po on po.id = poi.purchase_order_id
      where poi.id = v_poi and poi.requisition_item_id = v_item.id and po.requisition_id = v_req.id) then
      perform private.fail('Purchase Order line does not match the requisition line');
    end if;
    insert into public.receipt_item_allocations (receipt_id, requisition_item_id, purchase_order_item_id, quantity, actual_amount, created_by)
    values (p_receipt_id, v_item.id, v_poi, v_qty, v_amount, auth.uid());
    v_sum := v_sum + v_amount;
    v_lines := v_lines + 1;
  end loop;

  update public.receipts set
    status = 'reconciled', reconciled_at = now(), reconciled_by = auth.uid(),
    vendor_name = coalesce(private.clean_text(p_details ->> 'vendor_name', 200), vendor_name),
    purchase_date = coalesce(v_date, purchase_date),
    total_amount = coalesce(case when nullif(p_details ->> 'total_amount', '') is not null
                                 then private.parse_amount(p_details ->> 'total_amount', 'Receipt total') end,
                            total_amount, v_sum),
    reference = coalesce(private.clean_text(p_details ->> 'reference', 200), reference),
    reconciliation_notes = private.clean_text(p_details ->> 'notes', 2000)
  where id = p_receipt_id;

  v_status := private.refresh_requisition_progress(v_req.id);

  perform private.write_audit('receipt.reconciled', 'receipt', p_receipt_id, v_req.id,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', 'reconciled', 'allocated_amount', v_sum, 'lines', v_lines,
                       'allocations', p_allocations),
    '{}'::jsonb);
  return jsonb_build_object('previous_status', v_prev, 'status', v_status, 'allocated_amount', v_sum::text);
end $$;

create or replace function public.reject_receipt(p_receipt_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_receipt public.receipts;
begin
  perform private.require_permission('receipts.reconcile');
  if length(btrim(coalesce(p_reason, ''))) < 3 then perform private.fail('A reason is required'); end if;
  select * into v_receipt from public.receipts where id = p_receipt_id for update;
  if v_receipt.id is null or v_receipt.status not in ('pending', 'unmatched') then
    perform private.fail('Only pending or unmatched receipts can be rejected');
  end if;
  update public.receipts set status = 'rejected', rejected_reason = left(btrim(p_reason), 500),
         reconciled_by = auth.uid(), reconciled_at = now() where id = p_receipt_id;
  perform private.write_audit('receipt.rejected', 'receipt', p_receipt_id, v_receipt.requisition_id,
    jsonb_build_object('status', v_receipt.status), jsonb_build_object('status', 'rejected'),
    jsonb_build_object('reason', p_reason));
end $$;

-- Mark approved quantity that will NOT be purchased, so the request can complete.
create or replace function public.cancel_item_remaining(p_item_id uuid, p_quantity text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_item public.requisition_items;
  v_qty numeric;
  v_status public.requisition_status;
begin
  perform private.require_permission('receipts.reconcile');
  if length(btrim(coalesce(p_reason, ''))) < 3 then perform private.fail('A reason is required'); end if;
  select * into v_item from public.requisition_items where id = p_item_id for update;
  if v_item.id is null or v_item.review_status <> 'approved' then perform private.fail('Approved line not found'); end if;
  if not exists (select 1 from public.requisitions where id = v_item.requisition_id
                 and status in ('approved', 'partially_approved', 'po_issued', 'ordered', 'partially_purchased')) then
    perform private.fail('Remaining quantities can only be cancelled while purchasing is in progress');
  end if;
  v_qty := private.parse_quantity(p_quantity, 'Quantity');
  if v_item.purchased_quantity + v_item.cancelled_quantity + v_qty > v_item.approved_quantity then
    perform private.fail('Cannot cancel more than the remaining approved quantity');
  end if;
  update public.requisition_items set cancelled_quantity = cancelled_quantity + v_qty,
         cancel_reason = left(btrim(p_reason), 500) where id = p_item_id;
  v_status := private.refresh_requisition_progress(v_item.requisition_id);
  perform private.write_audit('requisition_item.remaining_cancelled', 'requisition_item', p_item_id, v_item.requisition_id,
    jsonb_build_object('cancelled_quantity', v_item.cancelled_quantity),
    jsonb_build_object('cancelled_quantity', v_item.cancelled_quantity + v_qty), jsonb_build_object('reason', p_reason));
  return jsonb_build_object('status', v_status);
end $$;

-- ---------------------------------------------------------------------------
-- Disbursements (Reimbursement / Petty Cash / Advance Check)
-- ---------------------------------------------------------------------------
create or replace function public.record_disbursement(
  p_requisition_id uuid,
  p_amount text,
  p_method public.disbursement_method,
  p_paid_on date,
  p_reference text default null,
  p_notes text default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_req public.requisitions;
  v_type public.request_types;
  v_amount numeric;
  v_id uuid;
begin
  perform private.require_permission('disbursements.record');
  select * into v_req from public.requisitions where id = p_requisition_id for update;
  if v_req.id is null then perform private.fail('Requisition not found'); end if;
  select * into v_type from public.request_types where id = v_req.request_type_id;
  if not v_type.requires_disbursement then
    perform private.fail(format('%s requests do not use disbursements', v_type.name));
  end if;
  if v_req.status not in ('approved', 'partially_approved', 'partially_purchased', 'purchased') then
    perform private.fail('Funds can only be disbursed for an approved requisition');
  end if;
  v_amount := private.parse_amount(p_amount, 'Amount');
  if v_amount <= 0 then perform private.fail('Amount must be greater than zero'); end if;
  if v_req.disbursed_total + v_amount > v_req.approved_total then
    perform private.fail(format('Total disbursed cannot exceed the approved amount (%s)', v_req.approved_total));
  end if;
  if p_paid_on is null or p_paid_on > private.church_today() then
    perform private.fail('Payment date is required and cannot be in the future');
  end if;
  insert into public.disbursements (requisition_id, amount, method, paid_on, reference, notes, recorded_by, is_demo)
  values (p_requisition_id, v_amount, p_method, p_paid_on, private.clean_text(p_reference, 120),
          private.clean_text(p_notes, 2000), auth.uid(), v_req.is_demo)
  returning id into v_id;
  perform private.refresh_requisition_progress(p_requisition_id);
  perform private.write_audit('disbursement.recorded', 'disbursement', v_id, p_requisition_id, null,
    jsonb_build_object('amount', v_amount, 'method', p_method, 'paid_on', p_paid_on, 'reference', p_reference), '{}'::jsonb);
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Close / comment
-- ---------------------------------------------------------------------------
create or replace function public.close_requisition(p_requisition_id uuid, p_comment text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_req public.requisitions;
  v_prev public.requisition_status;
begin
  perform private.require_permission('requisitions.review');
  select * into v_req from public.requisitions where id = p_requisition_id for update;
  if v_req.id is null then perform private.fail('Requisition not found'); end if;
  if v_req.status not in ('purchased', 'rejected') and length(btrim(coalesce(p_comment, ''))) < 3 then
    perform private.fail('A comment is required to close a requisition before purchasing is complete');
  end if;
  if exists (select 1 from public.receipts where requisition_id = p_requisition_id and status = 'pending') then
    perform private.fail('Reconcile or reject all pending receipts before closing');
  end if;
  v_prev := private.set_requisition_status(p_requisition_id, 'closed', private.clean_text(p_comment, 2000));
  perform private.write_audit('requisition.closed', 'requisition', p_requisition_id, p_requisition_id,
    jsonb_build_object('status', v_prev), jsonb_build_object('status', 'closed'), jsonb_build_object('comment', p_comment));
  return jsonb_build_object('previous_status', v_prev, 'status', 'closed');
end $$;

create or replace function public.add_requisition_comment(p_requisition_id uuid, p_body text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  perform private.require_permission('requisitions.view');
  if length(btrim(coalesce(p_body, ''))) = 0 then perform private.fail('Comment cannot be empty'); end if;
  if not exists (select 1 from public.requisitions where id = p_requisition_id) then
    perform private.fail('Requisition not found');
  end if;
  insert into public.requisition_comments (requisition_id, author_id, body)
  values (p_requisition_id, auth.uid(), left(btrim(p_body), 4000)) returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- First administrator bootstrap (trusted server code only)
-- ---------------------------------------------------------------------------
create or replace function public.bootstrap_first_administrator(p_user_id uuid, p_full_name text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_admin_role uuid;
begin
  perform set_config('app.actor_label', 'system:setup', true);
  select id into v_admin_role from public.roles where key = 'administrator';
  if exists (select 1 from public.user_roles where role_id = v_admin_role) then
    perform private.fail('An administrator already exists');
  end if;
  update public.profiles set full_name = left(btrim(p_full_name), 120), is_active = true where id = p_user_id;
  if not found then perform private.fail('User profile not found'); end if;
  insert into public.user_roles (user_id, role_id) values (p_user_id, v_admin_role);
end $$;

create or replace function public.administrator_exists()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id where r.key = 'administrator')
$$;

-- ---------------------------------------------------------------------------
-- Reporting helpers (SECURITY INVOKER: RLS decides what each user can see)
-- ---------------------------------------------------------------------------
create or replace function public.service_category_totals(p_from date, p_to date)
returns table (
  service_date date,
  service_date_id uuid,
  service_name text,
  kind text,
  category_id uuid,
  category_name text,
  sort_order int,
  total numeric
) language sql stable security invoker set search_path = public, pg_temp as $$
  select sd.service_date, sd.id, sd.service_name, 'attendance', c.id, c.name, c.sort_order, sum(ae.count)::numeric
  from public.service_dates sd
  join public.attendance_entries ae on ae.service_date_id = sd.id
  join public.categories c on c.id = ae.category_id
  where sd.service_date between p_from and p_to
  group by sd.service_date, sd.id, sd.service_name, c.id, c.name, c.sort_order
  union all
  select sd.service_date, sd.id, sd.service_name, 'finance', c.id, c.name, c.sort_order, sum(fe.amount)
  from public.service_dates sd
  join public.finance_entries fe on fe.service_date_id = sd.id and fe.voided_at is null
  join public.categories c on c.id = fe.category_id
  where sd.service_date between p_from and p_to
  group by sd.service_date, sd.id, sd.service_name, c.id, c.name, c.sort_order
$$;
