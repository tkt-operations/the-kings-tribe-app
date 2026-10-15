-- =============================================================================
-- Requisition amendments: product identity (brand / model / SKU).
--
-- The request form's product link auto-fill fills the requester's product
-- identity (requested_brand, requested_model, requested_sku). Amendments now
-- reuse the same auto-fill, so they may add or change those three fields too —
-- recorded field by field like every other amendment change.
--
-- Unchanged: lookup EVIDENCE (lookup_status / method / domain / price / values)
-- is still recorded only at submission and can never change afterwards; every
-- other rule of 20261014000100 is kept. Definitions below are that migration's,
-- plus the three identity fields.
-- =============================================================================

alter table public.requisition_item_changes drop constraint requisition_item_changes_field_check;
alter table public.requisition_item_changes add constraint requisition_item_changes_field_check check (field is null or field in (
  'description', 'specifications', 'color', 'size', 'quantity', 'estimated_unit_price',
  'vendor_name', 'vendor_url', 'notes', 'priority', 'essential_justification',
  'requested_brand', 'requested_model', 'requested_sku'));

create or replace function private.requisition_item_snapshot_guard()
returns trigger language plpgsql as $$
declare
  v_initializing boolean := coalesce(current_setting('app.product_initializing', true), '') = new.requisition_id::text;
  v_amending boolean := coalesce(current_setting('app.amending', true), '') = new.requisition_id::text;
begin
  if tg_op = 'INSERT' then
    if (new.lookup_method, new.lookup_domain,
        new.lookup_fetched_at, new.lookup_price, new.lookup_currency, new.lookup_values) is distinct from
       (null::public.product_lookup_method, null::text,
        null::timestamptz, null::numeric, null::text, null::jsonb)
       or new.lookup_status <> 'none' or new.lookup_edited_fields <> '{}'
       or ((new.requested_brand, new.requested_model, new.requested_sku) is distinct from (null::text, null::text, null::text)
           and not v_amending) then
      raise exception 'Product details can only be recorded when a requisition is submitted' using errcode = '42501';
    end if;
    if (new.added_in_revision <> 1 or new.last_changed_revision is not null or new.removed_at is not null)
       and not v_amending then
      raise exception 'Line items can only be added to a submitted requisition by an amendment' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.removed_at is not null and to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception 'A removed line item cannot be changed' using errcode = '42501';
  end if;

  if (new.description, new.specifications, new.color, new.size, new.quantity, new.estimated_unit_price,
      new.estimated_total, new.vendor_name, new.vendor_url, new.notes) is distinct from
     (old.description, old.specifications, old.color, old.size, old.quantity, old.estimated_unit_price,
      old.estimated_total, old.vendor_name, old.vendor_url, old.notes)
     and not v_amending then
    raise exception 'The submitted line item cannot be changed' using errcode = '42501';
  end if;

  if (new.added_in_revision, new.last_changed_revision, new.removed_at, new.removed_in_amendment_id, new.removed_reason)
     is distinct from
     (old.added_in_revision, old.last_changed_revision, old.removed_at, old.removed_in_amendment_id, old.removed_reason)
     and not v_amending then
    raise exception 'The submitted line item cannot be changed' using errcode = '42501';
  end if;

  -- The requester's product identity (brand / model / SKU) may also change in an amendment.
  if (new.requested_brand, new.requested_model, new.requested_sku) is distinct from
     (old.requested_brand, old.requested_model, old.requested_sku)
     and not (v_initializing and old.created_at = now()) and not v_amending then
    raise exception 'The submitted line item cannot be changed' using errcode = '42501';
  end if;

  -- Lookup evidence is recorded only at submission, never changed afterwards.
  if (new.lookup_status, new.lookup_method,
      new.lookup_domain, new.lookup_fetched_at, new.lookup_price, new.lookup_currency, new.lookup_values,
      new.lookup_edited_fields) is distinct from
     (old.lookup_status, old.lookup_method,
      old.lookup_domain, old.lookup_fetched_at, old.lookup_price, old.lookup_currency, old.lookup_values,
      old.lookup_edited_fields)
     and not (v_initializing and old.created_at = now()) then
    raise exception 'The submitted line item cannot be changed' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function private.requisition_item_content(i public.requisition_items)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'description', i.description, 'specifications', i.specifications, 'color', i.color, 'size', i.size,
    'quantity', i.quantity, 'estimated_unit_price', i.estimated_unit_price, 'vendor_name', i.vendor_name,
    'vendor_url', i.vendor_url, 'notes', i.notes, 'priority', i.priority,
    'essential_justification', i.essential_justification, 'requested_brand', i.requested_brand,
    'requested_model', i.requested_model, 'requested_sku', i.requested_sku)
$$;

create or replace function private.amended_line(base public.requisition_items, fields jsonb, label text)
returns public.requisition_items language plpgsql stable set search_path = public, pg_temp as $$
declare
  v public.requisition_items := base;
  v_priority text;
  v_reason text;
begin
  if jsonb_typeof(fields) <> 'object' then
    perform private.fail(format('%s: no changes were provided', label));
  end if;
  if exists (select 1 from jsonb_object_keys(fields) k where k not in (
      'description', 'specifications', 'color', 'size', 'quantity', 'estimated_unit_price',
      'vendor_name', 'vendor_url', 'notes', 'priority', 'essential_justification',
      'requested_brand', 'requested_model', 'requested_sku')) then
    perform private.fail(format('%s: unknown field', label));
  end if;
  if fields ? 'description' then
    v.description := btrim(coalesce(fields ->> 'description', ''));
    if length(v.description) not between 2 and 300 then
      perform private.fail(format('%s: describe the item (2 to 300 characters)', label));
    end if;
  end if;
  if fields ? 'specifications' then v.specifications := private.clean_text(fields ->> 'specifications', 2000); end if;
  if fields ? 'color' then v.color := private.clean_text(fields ->> 'color', 60); end if;
  if fields ? 'size' then v.size := private.clean_text(fields ->> 'size', 60); end if;
  if fields ? 'quantity' then v.quantity := private.parse_quantity(fields ->> 'quantity', format('%s quantity', label)); end if;
  if fields ? 'estimated_unit_price' then
    v.estimated_unit_price := private.parse_amount(fields ->> 'estimated_unit_price', format('%s unit price', label));
    if v.estimated_unit_price > 10000000 then perform private.fail(format('%s: unit price is too large', label)); end if;
  end if;
  if fields ? 'vendor_name' then v.vendor_name := private.clean_text(fields ->> 'vendor_name', 200); end if;
  if fields ? 'vendor_url' then
    v.vendor_url := private.clean_text(fields ->> 'vendor_url', 2000);
    if v.vendor_url is not null and v.vendor_url !~* '^https?://' then
      perform private.fail(format('%s: the product link must start with http:// or https://', label));
    end if;
  end if;
  if fields ? 'notes' then v.notes := private.clean_text(fields ->> 'notes', 2000); end if;
  if fields ? 'requested_brand' then v.requested_brand := private.clean_text(fields ->> 'requested_brand', 120); end if;
  if fields ? 'requested_model' then v.requested_model := private.clean_text(fields ->> 'requested_model', 100); end if;
  if fields ? 'requested_sku' then v.requested_sku := private.clean_text(fields ->> 'requested_sku', 100); end if;
  if fields ? 'priority' then
    v_priority := btrim(coalesce(fields ->> 'priority', ''));
    if v_priority not in ('essential', 'high', 'medium', 'low') then
      perform private.fail(format('%s: choose a priority', label));
    end if;
    v.priority := v_priority::public.item_priority;
  end if;
  v_reason := case when fields ? 'essential_justification' then private.clean_text(fields ->> 'essential_justification', 500)
                   else base.essential_justification end;
  if v.priority = 'essential' then
    if length(coalesce(v_reason, '')) < 10 then
      perform private.fail(format('%s: explain why this item is essential (at least 10 characters)', label));
    end if;
    v.essential_justification := v_reason;
  else
    v.essential_justification := null;
  end if;
  v.estimated_total := round(v.quantity * v.estimated_unit_price, 2);
  return v;
end $$;

create or replace function public.amend_requisition(p_requisition_id uuid, p_reason text, p_changes jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_req public.requisitions;
  v_reason text := private.clean_text(p_reason, 1000);
  v_rev int;
  v_amendment_id uuid;
  v_change jsonb;
  v_op text;
  v_item public.requisition_items;
  v_new public.requisition_items;
  v_touched uuid[] := '{}';
  v_fields text[] := array['description', 'specifications', 'color', 'size', 'quantity', 'estimated_unit_price',
                           'vendor_name', 'vendor_url', 'notes', 'priority', 'essential_justification',
                           'requested_brand', 'requested_model', 'requested_sku'];
  v_field text;
  v_changed text[];
  v_old jsonb;
  v_newc jsonb;
  v_prev_review jsonb;
  v_line int;
  v_label text;
  v_line_reason text;
  v_total_before numeric;
  v_total_after numeric;
  v_added int := 0;
  v_updated int := 0;
  v_removed int := 0;
  v_status_after public.requisition_status;
  v_audit_old jsonb;
  v_audit_new jsonb;
  v_n int := 0;
  v_blank public.requisition_items;
begin
  perform private.require_permission('requisitions.amend');
  perform private.require_permission('requisitions.view');
  if v_reason is null or length(v_reason) < 10 then
    perform private.fail('Explain the reason for this amendment (at least 10 characters)');
  end if;
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) = 0 then
    perform private.fail('Make at least one change');
  end if;
  if jsonb_array_length(p_changes) > 60 then
    perform private.fail('Too many changes in one amendment');
  end if;

  -- The row lock serialises concurrent amendments: revision numbers are sequential.
  select * into v_req from public.requisitions where id = p_requisition_id for update;
  if v_req.id is null then perform private.fail('Requisition not found'); end if;
  if v_req.status not in ('submitted', 'under_review', 'on_hold') then
    perform private.fail('Only submitted, under-review or on-hold requisitions can be amended');
  end if;

  v_rev := v_req.current_revision + 1;
  v_total_before := v_req.estimated_total;
  -- The amendment row itself is inserted at the end, when its totals are known
  -- (it is append-only); the references to it are checked at commit.
  v_amendment_id := gen_random_uuid();

  -- Relax the snapshot guard (and the separate priority-change audit, which this
  -- amendment records itself) for this requisition, for this transaction only.
  perform set_config('app.amending', p_requisition_id::text, true);
  perform set_config('app.priority_initializing', p_requisition_id::text, true);

  for v_change in select * from jsonb_array_elements(p_changes) loop
    v_n := v_n + 1;
    v_op := v_change ->> 'op';

    if v_op in ('update', 'remove') then
      select * into v_item from public.requisition_items
       where id = nullif(v_change ->> 'item_id', '')::uuid and requisition_id = p_requisition_id for update;
      if v_item.id is null then perform private.fail(format('Change %s: line item not found', v_n)); end if;
      if v_item.removed_at is not null then
        perform private.fail(format('Line %s has already been removed', v_item.line_number));
      end if;
      if v_item.id = any (v_touched) then
        perform private.fail(format('Line %s appears more than once in this amendment', v_item.line_number));
      end if;
      v_touched := v_touched || v_item.id;
      v_label := format('Line %s', v_item.line_number);
      v_prev_review := private.requisition_item_review(v_item);
    end if;

    if v_op = 'update' then
      v_new := private.amended_line(v_item, v_change -> 'fields', v_label);
      if v_item.lookup_status = 'verified' and v_new.vendor_url is distinct from v_item.vendor_url then
        perform private.fail(format('%s: its product link was verified when submitted and cannot be changed. Remove the line and add a new one instead.', v_label));
      end if;
      v_old := private.requisition_item_content(v_item);
      v_newc := private.requisition_item_content(v_new);
      v_changed := '{}';
      foreach v_field in array v_fields loop
        if (v_old -> v_field) is distinct from (v_newc -> v_field) then
          v_changed := v_changed || v_field;
          insert into public.requisition_item_changes (amendment_id, requisition_id, requisition_item_id, line_number,
                                                       change_type, field, old_value, new_value, previous_review)
          values (v_amendment_id, p_requisition_id, v_item.id, v_item.line_number, 'updated', v_field,
                  v_old -> v_field, v_newc -> v_field, v_prev_review);
        end if;
      end loop;
      if cardinality(v_changed) = 0 then
        perform private.fail(format('%s: nothing was changed', v_label));
      end if;
      update public.requisition_items
         set description = v_new.description, specifications = v_new.specifications, color = v_new.color,
             size = v_new.size, quantity = v_new.quantity, estimated_unit_price = v_new.estimated_unit_price,
             estimated_total = v_new.estimated_total, vendor_name = v_new.vendor_name, vendor_url = v_new.vendor_url,
             notes = v_new.notes, priority = v_new.priority, essential_justification = v_new.essential_justification,
             requested_brand = v_new.requested_brand, requested_model = v_new.requested_model, requested_sku = v_new.requested_sku,
             last_changed_revision = v_rev,
             -- A changed line goes back to review; the earlier decision is kept in previous_review.
             review_status = 'pending', approved_quantity = null, approved_unit_price = null,
             approved_total = 0, review_comment = null
       where id = v_item.id;
      v_audit_old := '{}'; v_audit_new := '{}';
      foreach v_field in array v_changed loop
        v_audit_old := v_audit_old || jsonb_build_object(v_field, private.amendment_audit_value(v_field, v_old -> v_field));
        v_audit_new := v_audit_new || jsonb_build_object(v_field, private.amendment_audit_value(v_field, v_newc -> v_field));
      end loop;
      perform private.write_audit('requisition.line_item_updated', 'requisition_item', v_item.id, p_requisition_id,
        v_audit_old, v_audit_new,
        jsonb_build_object('revision', v_rev, 'line_number', v_item.line_number, 'status', v_req.status,
                           'fields', to_jsonb(v_changed), 'review_reset', v_prev_review is not null,
                           'reason', left(v_reason, 200)));
      v_updated := v_updated + 1;

    elsif v_op = 'remove' then
      v_line_reason := coalesce(private.clean_text(v_change ->> 'reason', 1000), v_reason);
      update public.requisition_items
         set removed_at = now(), removed_in_amendment_id = v_amendment_id, removed_reason = v_line_reason,
             last_changed_revision = v_rev,
             review_status = 'pending', approved_quantity = null, approved_unit_price = null,
             approved_total = 0, review_comment = null
       where id = v_item.id;
      insert into public.requisition_item_changes (amendment_id, requisition_id, requisition_item_id, line_number,
                                                   change_type, field, old_value, new_value, previous_review)
      values (v_amendment_id, p_requisition_id, v_item.id, v_item.line_number, 'removed', null,
              private.requisition_item_content(v_item), jsonb_build_object('removed_reason', v_line_reason), v_prev_review);
      perform private.write_audit('requisition.line_item_removed', 'requisition_item', v_item.id, p_requisition_id,
        jsonb_build_object('description', left(v_item.description, 120), 'quantity', v_item.quantity,
                           'estimated_total', v_item.estimated_total),
        null,
        jsonb_build_object('revision', v_rev, 'line_number', v_item.line_number, 'status', v_req.status,
                           'removed_reason', left(v_line_reason, 200), 'reason', left(v_reason, 200)));
      v_removed := v_removed + 1;

    elsif v_op = 'add' then
      select coalesce(max(line_number), 0) + 1 into v_line from public.requisition_items where requisition_id = p_requisition_id;
      if v_line > 100 then perform private.fail('This requisition has reached the maximum number of lines'); end if;
      v_label := format('New line %s', v_line);
      if not (v_change -> 'fields' ? 'description' and v_change -> 'fields' ? 'quantity'
              and v_change -> 'fields' ? 'estimated_unit_price' and v_change -> 'fields' ? 'priority') then
        perform private.fail(format('%s: description, quantity, unit price and priority are required', v_label));
      end if;
      v_blank.requisition_id := p_requisition_id;
      v_blank.line_number := v_line;
      v_new := private.amended_line(v_blank, v_change -> 'fields', v_label);
      insert into public.requisition_items (requisition_id, line_number, description, specifications, color, size,
                                            quantity, estimated_unit_price, estimated_total, vendor_name, vendor_url,
                                            notes, priority, essential_justification, requested_brand, requested_model,
                                            requested_sku, added_in_revision)
      values (p_requisition_id, v_line, v_new.description, v_new.specifications, v_new.color, v_new.size,
              v_new.quantity, v_new.estimated_unit_price, v_new.estimated_total, v_new.vendor_name, v_new.vendor_url,
              v_new.notes, v_new.priority, v_new.essential_justification, v_new.requested_brand, v_new.requested_model,
              v_new.requested_sku, v_rev)
      returning * into v_item;
      insert into public.requisition_item_changes (amendment_id, requisition_id, requisition_item_id, line_number,
                                                   change_type, field, old_value, new_value)
      values (v_amendment_id, p_requisition_id, v_item.id, v_line, 'added', null, null, private.requisition_item_content(v_item));
      perform private.write_audit('requisition.line_item_added', 'requisition_item', v_item.id, p_requisition_id,
        null,
        jsonb_build_object('description', left(v_item.description, 120), 'quantity', v_item.quantity,
                           'estimated_unit_price', v_item.estimated_unit_price, 'estimated_total', v_item.estimated_total,
                           'priority', v_item.priority),
        jsonb_build_object('revision', v_rev, 'line_number', v_line, 'status', v_req.status, 'reason', left(v_reason, 200)));
      v_added := v_added + 1;

    else
      perform private.fail(format('Change %s: unknown change type', v_n));
    end if;
  end loop;

  if (select count(*) from public.requisition_items where requisition_id = p_requisition_id and removed_at is null) = 0 then
    perform private.fail('A requisition must keep at least one line item');
  end if;
  if (select count(*) from public.requisition_items where requisition_id = p_requisition_id and removed_at is null) > 50 then
    perform private.fail('A requisition can contain at most 50 items');
  end if;

  select coalesce(sum(estimated_total), 0) into v_total_after
    from public.requisition_items where requisition_id = p_requisition_id and removed_at is null;
  update public.requisitions
     set current_revision = v_rev, amended_at = now(), estimated_total = v_total_after
   where id = p_requisition_id;
  insert into public.requisition_amendments (id, requisition_id, revision_number, actor_id, actor_label, reason,
                                             status_at_amendment, estimated_total_before, estimated_total_after)
  values (v_amendment_id, p_requisition_id, v_rev, auth.uid(), private.actor_label(), v_reason, v_req.status,
          v_total_before, v_total_after);

  perform set_config('app.amending', '', true);
  perform set_config('app.priority_initializing', '', true);

  -- The finance decision on an on-hold requisition is waiting for exactly this:
  -- it goes back to review (an existing, audited transition).
  v_status_after := v_req.status;
  if v_req.status = 'on_hold' then
    perform private.set_requisition_status(p_requisition_id, 'under_review', format('Amended (revision %s)', v_rev));
    v_status_after := 'under_review';
  end if;

  perform private.write_audit('requisition.amendment_submitted', 'requisition', p_requisition_id, p_requisition_id,
    jsonb_build_object('revision', v_req.current_revision, 'estimated_total', v_total_before, 'status', v_req.status),
    jsonb_build_object('revision', v_rev, 'estimated_total', v_total_after, 'status', v_status_after),
    jsonb_build_object('revision', v_rev, 'status', v_req.status, 'reason', left(v_reason, 200),
                       'lines_added', v_added, 'lines_updated', v_updated, 'lines_removed', v_removed,
                       'estimated_total_before', v_total_before, 'estimated_total_after', v_total_after));

  -- In-app notice for the assigned reviewer (low importance: never pushed; no email or SMS).
  if v_req.assigned_reviewer_id is not null and v_req.assigned_reviewer_id is distinct from auth.uid() and not v_req.is_demo then
    perform private.notify_user(v_req.assigned_reviewer_id, 'requisitions.review', 'requisition.amended', 'requisitions', 'low',
      'Requisition amended', v_req.requisition_number || ' · revision ' || v_rev, '/requisitions/' || p_requisition_id,
      p_requisition_id, 'requisitions.view', 'amended:' || p_requisition_id || ':' || v_rev);
  end if;

  return jsonb_build_object('revision', v_rev, 'status', v_status_after,
    'estimated_total', v_total_after::text, 'estimated_total_before', v_total_before::text,
    'lines_added', v_added, 'lines_updated', v_updated, 'lines_removed', v_removed);
end $$;
