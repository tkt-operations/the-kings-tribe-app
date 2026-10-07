-- =============================================================================
-- Migration 20261008000100: product URL auto-fill (V1) — ADDITIVE
--
-- Each requisition line keeps an ORIGINAL SUBMITTED SNAPSHOT that is written
-- once, by the submission transaction, and never changes afterwards:
--   A1  what the requester submitted: the existing requester columns
--       (description … notes) plus requested_brand / requested_model /
--       requested_sku (typed, or prefilled from a product link and reviewed)
--   A2  the product-lookup evidence captured at submission (lookup_*)
--
-- Only a lookup the server signed AND verified at submission carries source
-- attribution (lookup_status = 'verified'). Expired, URL-changed and rejected
-- (tampered / invalid) lookups keep the requester's typed values but never any
-- attribution; their status records why. No lookup at all = 'none'.
--
-- Future/current/reference product information (Finance corrections, product
-- images, vendor APIs, "check current product information") will live in
-- separate columns/tables and must never write these columns.
--
-- Existing rows: lookup_status = 'none', everything else empty. No backfill.
-- =============================================================================

create type public.product_lookup_status as enum ('none', 'verified', 'expired', 'url_changed', 'rejected');
create type public.product_lookup_method as enum ('structured_data', 'open_graph', 'url_hint');

alter table public.requisition_items
  -- A1: requester-submitted identity
  add column requested_brand      text,
  add column requested_model      text,
  add column requested_sku        text,
  -- A2: lookup evidence captured at submission
  add column lookup_status        public.product_lookup_status not null default 'none',
  add column lookup_method        public.product_lookup_method,
  add column lookup_domain        text,
  add column lookup_fetched_at    timestamptz,
  add column lookup_price         numeric(14,2),
  add column lookup_currency      text,
  -- Verified fetched text values (title, brand, model, sku, vendor_name, color, size).
  add column lookup_values        jsonb,
  add column lookup_edited_fields text[] not null default '{}';

alter table public.requisition_items
  add constraint requisition_items_requested_brand_check check (requested_brand is null or length(requested_brand) between 1 and 120),
  add constraint requisition_items_requested_model_check check (requested_model is null or length(requested_model) between 1 and 100),
  add constraint requisition_items_requested_sku_check   check (requested_sku   is null or length(requested_sku)   between 1 and 100),
  add constraint requisition_items_lookup_domain_check   check (lookup_domain is null or (length(lookup_domain) <= 253 and lookup_domain ~ '^[a-z0-9.-]+$')),
  add constraint requisition_items_lookup_price_check    check (lookup_price is null or (lookup_price >= 0 and lookup_price <= 10000000)),
  add constraint requisition_items_lookup_currency_check check (lookup_currency is null or lookup_currency ~ '^[A-Z]{3}$'),
  add constraint requisition_items_lookup_price_pair_check check ((lookup_price is null) = (lookup_currency is null)),
  add constraint requisition_items_lookup_values_check   check (lookup_values is null
      or (jsonb_typeof(lookup_values) = 'object' and octet_length(lookup_values::text) <= 4096)),
  add constraint requisition_items_lookup_edited_check   check (lookup_edited_fields <@ array[
      'description','vendor_name','estimated_unit_price','requested_brand','requested_model','requested_sku','color','size']::text[]),
  add constraint requisition_items_lookup_hint_no_price_check check (lookup_method is distinct from 'url_hint' or lookup_price is null),
  -- Only a verified lookup carries attribution; every other status carries none.
  add constraint requisition_items_lookup_consistency_check check (
      (lookup_status = 'verified'
         and lookup_method is not null and lookup_domain is not null and lookup_fetched_at is not null and vendor_url is not null)
   or (lookup_status <> 'verified'
         and lookup_method is null and lookup_domain is null and lookup_fetched_at is null
         and lookup_price is null and lookup_values is null and lookup_edited_fields = '{}'));

-- ---------------------------------------------------------------------------
-- Snapshot guard. Applies to every role, including service_role.
--  * The existing requester columns can never change after insert (no
--    workflow function writes them: review, approval, PO, vendor orders,
--    receipts, reconciliation, cancellation and priority use other columns).
--  * requested_* / lookup_* can be written only by submit_requisition_with_product,
--    in the same transaction that inserted the row: it sets
--    app.product_initializing to the requisition id (transaction-local), and
--    the row must have been created in this transaction (created_at = now()).
--    Once that transaction commits, the snapshot is final.
--  * Columns not listed here (priority, review/approval, progress caches,
--    cancellation, and any column added by a later migration) are unaffected.
-- ---------------------------------------------------------------------------
create or replace function private.requisition_item_snapshot_guard()
returns trigger language plpgsql as $$
declare
  v_initializing boolean := coalesce(current_setting('app.product_initializing', true), '') = new.requisition_id::text;
begin
  if tg_op = 'INSERT' then
    if (new.requested_brand, new.requested_model, new.requested_sku, new.lookup_method, new.lookup_domain,
        new.lookup_fetched_at, new.lookup_price, new.lookup_currency, new.lookup_values) is distinct from
       (null::text, null::text, null::text, null::public.product_lookup_method, null::text,
        null::timestamptz, null::numeric, null::text, null::jsonb)
       or new.lookup_status <> 'none' or new.lookup_edited_fields <> '{}' then
      raise exception 'Product details can only be recorded when a requisition is submitted' using errcode = '42501';
    end if;
    return new;
  end if;

  if (new.description, new.specifications, new.color, new.size, new.quantity, new.estimated_unit_price,
      new.estimated_total, new.vendor_name, new.vendor_url, new.notes) is distinct from
     (old.description, old.specifications, old.color, old.size, old.quantity, old.estimated_unit_price,
      old.estimated_total, old.vendor_name, old.vendor_url, old.notes) then
    raise exception 'The submitted line item cannot be changed' using errcode = '42501';
  end if;

  if (new.requested_brand, new.requested_model, new.requested_sku, new.lookup_status, new.lookup_method,
      new.lookup_domain, new.lookup_fetched_at, new.lookup_price, new.lookup_currency, new.lookup_values,
      new.lookup_edited_fields) is distinct from
     (old.requested_brand, old.requested_model, old.requested_sku, old.lookup_status, old.lookup_method,
      old.lookup_domain, old.lookup_fetched_at, old.lookup_price, old.lookup_currency, old.lookup_values,
      old.lookup_edited_fields)
     and not (v_initializing and old.created_at = now()) then
    raise exception 'The submitted line item cannot be changed' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger requisition_items_snapshot_guard
  before insert or update on public.requisition_items
  for each row execute function private.requisition_item_snapshot_guard();

-- ---------------------------------------------------------------------------
-- Submission with product details. The server action has already classified
-- every line's signed lookup token (items[n].lookup.status); only 'verified'
-- lines carry attribution. Delegates to the existing (unchanged)
-- submit_requisition_with_priority, then records the snapshot and the audit
-- entries — one transaction, so a failure leaves nothing behind.
-- Called ONLY by trusted server code (service_role).
-- ---------------------------------------------------------------------------
create or replace function public.submit_requisition_with_product(
  p_token text,
  p_payload jsonb,
  p_files jsonb default '[]'::jsonb,
  p_fingerprint text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_result jsonb;
  v_req_id uuid;
  v_item jsonb;
  v_lookup jsonb;
  v_status text;
  v_verified boolean;
  v_reason text;
  v_line int := 0;
  v_counts jsonb := jsonb_build_object('verified', 0, 'expired', 0, 'url_changed', 0, 'rejected', 0);
  v_methods jsonb := jsonb_build_object('structured_data', 0, 'open_graph', 0, 'url_hint', 0);
  v_edited_lines int := 0;
  v_rejected_lines int[] := '{}';
  v_reasons text[] := '{}';
begin
  -- Validate every line's lookup status before creating anything.
  if jsonb_typeof(p_payload -> 'items') = 'array' then
    for v_item in select value from jsonb_array_elements(p_payload -> 'items') loop
      v_status := coalesce(nullif(v_item -> 'lookup' ->> 'status', ''), 'none');
      if v_status not in ('none', 'verified', 'expired', 'url_changed', 'rejected') then
        raise exception 'Invalid product lookup status' using errcode = '22023';
      end if;
    end loop;
  end if;

  v_result := public.submit_requisition_with_priority(p_token, p_payload, p_files, p_fingerprint);
  v_req_id := (v_result ->> 'id')::uuid;

  perform set_config('app.product_initializing', v_req_id::text, true);
  for v_item in select value from jsonb_array_elements(p_payload -> 'items') loop
    v_line := v_line + 1;
    v_lookup := case when jsonb_typeof(v_item -> 'lookup') = 'object' then v_item -> 'lookup' else '{}'::jsonb end;
    v_status := coalesce(nullif(v_lookup ->> 'status', ''), 'none');
    v_verified := v_status = 'verified';

    update public.requisition_items
       set requested_brand = private.clean_text(v_item ->> 'requested_brand', 120),
           requested_model = private.clean_text(v_item ->> 'requested_model', 100),
           requested_sku = private.clean_text(v_item ->> 'requested_sku', 100),
           lookup_status = v_status::public.product_lookup_status,
           lookup_method = case when v_verified then (v_lookup ->> 'method')::public.product_lookup_method end,
           lookup_domain = case when v_verified then lower(v_lookup ->> 'domain') end,
           lookup_fetched_at = case when v_verified then (v_lookup ->> 'fetched_at')::timestamptz end,
           lookup_price = case when v_verified and v_lookup ->> 'price' is not null
                               then private.parse_amount(v_lookup ->> 'price', format('Item %s reference price', v_line)) end,
           lookup_currency = case when v_verified and v_lookup ->> 'price' is not null then v_lookup ->> 'currency' end,
           lookup_values = case when v_verified and jsonb_typeof(v_lookup -> 'values') = 'object' then v_lookup -> 'values' end,
           lookup_edited_fields = case when v_verified and jsonb_typeof(v_lookup -> 'edited_fields') = 'array'
                                       then array(select jsonb_array_elements_text(v_lookup -> 'edited_fields'))
                                       else '{}'::text[] end
     where requisition_id = v_req_id and line_number = v_line;

    if v_status <> 'none' then
      v_counts := jsonb_set(v_counts, array[v_status], to_jsonb((v_counts ->> v_status)::int + 1));
    end if;
    if v_verified then
      v_methods := jsonb_set(v_methods, array[v_lookup ->> 'method'], to_jsonb((v_methods ->> (v_lookup ->> 'method'))::int + 1));
      if jsonb_typeof(v_lookup -> 'edited_fields') = 'array' and jsonb_array_length(v_lookup -> 'edited_fields') > 0 then
        v_edited_lines := v_edited_lines + 1;
      end if;
    end if;
    if v_status = 'rejected' then
      v_reason := coalesce(v_lookup ->> 'reason', 'malformed');
      v_rejected_lines := v_rejected_lines || v_line;
      v_reasons := v_reasons || case when v_reason in ('signature', 'malformed', 'wrong_link') then v_reason else 'malformed' end;
    end if;
  end loop;
  perform set_config('app.product_initializing', '', true);

  -- Manual-only submissions add no audit entries (unchanged audit footprint).
  if (v_counts ->> 'verified')::int + (v_counts ->> 'expired')::int + (v_counts ->> 'url_changed')::int + (v_counts ->> 'rejected')::int > 0 then
    perform private.write_audit('requisition.product_lookup', 'requisition', v_req_id, v_req_id, null, null,
      v_counts || jsonb_build_object('methods', v_methods, 'edited_lines', v_edited_lines));
  end if;
  if cardinality(v_rejected_lines) > 0 then
    perform private.write_audit('requisition.product_lookup_rejected', 'requisition', v_req_id, v_req_id, null, null,
      jsonb_build_object('lines', to_jsonb(v_rejected_lines),
                         'reasons', to_jsonb(array(select distinct r from unnest(v_reasons) as r order by r))));
  end if;

  return v_result;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on function public.submit_requisition_with_product(text, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.submit_requisition_with_product(text, jsonb, jsonb, text) to service_role;
revoke all on function private.requisition_item_snapshot_guard() from public, anon, authenticated;
