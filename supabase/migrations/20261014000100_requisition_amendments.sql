-- =============================================================================
-- Requisition amendments — Phase 1 (staff only; submitted / under review / on hold).
--
-- Model (hybrid):
--   * requisitions / requisition_items stay the current-state read model, so
--     every existing read, review, purchasing and report path is unchanged.
--   * requisition_amendments: one append-only row per revision (who, when, why).
--   * requisition_item_changes: append-only field-level changes (old → new),
--     including the line's previous review decision when one existed.
--   * Lines are never deleted: "removed" is a flag with a reason, and removed
--     lines no longer count towards the current estimated total or review.
--   * The submitted-line snapshot guard stays the default protection. Only
--     public.amend_requisition (which sets app.amending for its own
--     transaction) may change submitted line content.
-- Existing requisitions are revision 1 automatically (column defaults); no
-- backfill, and no approval / PO / vendor-order / receipt rows change.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.requisitions
  add column current_revision int not null default 1 check (current_revision >= 1),
  add column amended_at timestamptz,
  -- Reserved for Phase 2 (re-review after approval). Always false in Phase 1.
  add column amendment_review_required boolean not null default false;

create table public.requisition_amendments (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references public.requisitions (id) on delete cascade,
  revision_number int not null check (revision_number >= 2),
  actor_id uuid references public.profiles (id) on delete set null,
  actor_label text,
  reason text not null check (length(btrim(reason)) between 10 and 1000),
  status_at_amendment public.requisition_status not null,
  estimated_total_before numeric(14,2) not null,
  estimated_total_after numeric(14,2) not null,
  submitted_at timestamptz not null default now(),
  unique (requisition_id, revision_number)
);
create index requisition_amendments_req_idx on public.requisition_amendments (requisition_id, revision_number desc);

alter table public.requisition_items
  add column added_in_revision int not null default 1 check (added_in_revision >= 1),
  add column last_changed_revision int check (last_changed_revision is null or last_changed_revision >= 2),
  add column removed_at timestamptz,
  -- Deferred: the amendment row is written last, once its totals are known.
  add column removed_in_amendment_id uuid references public.requisition_amendments (id) on delete restrict deferrable initially deferred,
  add column removed_reason text check (removed_reason is null or length(btrim(removed_reason)) between 1 and 1000),
  add constraint requisition_items_removed_consistency_check check (
    (removed_at is null and removed_in_amendment_id is null and removed_reason is null)
    or (removed_at is not null and removed_in_amendment_id is not null and removed_reason is not null));

create table public.requisition_item_changes (
  id uuid primary key default gen_random_uuid(),
  amendment_id uuid not null references public.requisition_amendments (id) on delete cascade deferrable initially deferred,
  requisition_id uuid not null references public.requisitions (id) on delete cascade,
  requisition_item_id uuid not null references public.requisition_items (id) on delete cascade,
  line_number int not null,
  change_type text not null check (change_type in ('added', 'updated', 'removed')),
  -- The changed column for 'updated'; null for 'added' / 'removed' (whole line in the values).
  field text check (field is null or field in (
    'description', 'specifications', 'color', 'size', 'quantity', 'estimated_unit_price',
    'vendor_name', 'vendor_url', 'notes', 'priority', 'essential_justification')),
  old_value jsonb,
  new_value jsonb,
  previous_review jsonb,
  created_at timestamptz not null default now(),
  check ((change_type = 'updated') = (field is not null))
);
create index requisition_item_changes_amendment_idx on public.requisition_item_changes (amendment_id);
create index requisition_item_changes_item_idx on public.requisition_item_changes (requisition_item_id);

-- Append-only, for every role (including the service role).
create or replace function private.append_only()
returns trigger language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end $$;

create trigger requisition_amendments_append_only before update or delete on public.requisition_amendments
  for each row execute function private.append_only();
create trigger requisition_item_changes_append_only before update or delete on public.requisition_item_changes
  for each row execute function private.append_only();

-- ---------------------------------------------------------------------------
-- Snapshot guard: unchanged behaviour, plus
--   * submitted content may change only inside amend_requisition (app.amending);
--   * revision / removal columns may change only there too;
--   * a removed line can never change again.
-- ---------------------------------------------------------------------------
create or replace function private.requisition_item_snapshot_guard()
returns trigger language plpgsql as $$
declare
  v_initializing boolean := coalesce(current_setting('app.product_initializing', true), '') = new.requisition_id::text;
  v_amending boolean := coalesce(current_setting('app.amending', true), '') = new.requisition_id::text;
begin
  if tg_op = 'INSERT' then
    if (new.requested_brand, new.requested_model, new.requested_sku, new.lookup_method, new.lookup_domain,
        new.lookup_fetched_at, new.lookup_price, new.lookup_currency, new.lookup_values) is distinct from
       (null::text, null::text, null::text, null::public.product_lookup_method, null::text,
        null::timestamptz, null::numeric, null::text, null::jsonb)
       or new.lookup_status <> 'none' or new.lookup_edited_fields <> '{}' then
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

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- The amendable content of a line, as stored in change records.
create or replace function private.requisition_item_content(i public.requisition_items)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'description', i.description, 'specifications', i.specifications, 'color', i.color, 'size', i.size,
    'quantity', i.quantity, 'estimated_unit_price', i.estimated_unit_price, 'vendor_name', i.vendor_name,
    'vendor_url', i.vendor_url, 'notes', i.notes, 'priority', i.priority,
    'essential_justification', i.essential_justification)
$$;

-- The line's review decision, if one was ever recorded (kept when an amendment resets it).
create or replace function private.requisition_item_review(i public.requisition_items)
returns jsonb language sql immutable as $$
  select case when i.review_status = 'pending' and i.approved_quantity is null and i.approved_unit_price is null
                   and i.approved_total = 0 and i.review_comment is null then null
              else jsonb_build_object('review_status', i.review_status, 'approved_quantity', i.approved_quantity,
                                      'approved_unit_price', i.approved_unit_price, 'approved_total', i.approved_total,
                                      'review_comment', i.review_comment) end
$$;

-- What the audit log may show for a changed field. Free text that could hold
-- contact details (specifications, notes, essential justification) is listed
-- by name only; the full values stay in requisition_item_changes. Links are
-- reduced to their domain.
create or replace function private.amendment_audit_value(p_field text, p_value jsonb)
returns jsonb language sql immutable as $$
  select case
    when p_value is null or p_value = 'null'::jsonb then 'null'::jsonb
    when p_field in ('specifications', 'notes', 'essential_justification') then '"[changed]"'::jsonb
    when p_field = 'vendor_url' then to_jsonb(coalesce(substring(p_value #>> '{}' from '^https?://([^/:?#]+)'), '[link]'))
    when p_field = 'description' then to_jsonb(left(p_value #>> '{}', 120))
    else p_value
  end
$$;

-- Applies one line's requested values on top of `base` (validated exactly like
-- a submission). `fields` holds only the keys being set.
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
      'vendor_name', 'vendor_url', 'notes', 'priority', 'essential_justification')) then
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

-- ---------------------------------------------------------------------------
-- The amendment. Staff only (requisitions.amend + requisitions.view).
--   p_changes: [{ "op": "update", "item_id": uuid, "fields": {...} },
--               { "op": "add", "fields": {description, quantity, estimated_unit_price, priority, ...} },
--               { "op": "remove", "item_id": uuid, "reason": text? }]
-- One transaction: everything is recorded, or nothing is.
-- ---------------------------------------------------------------------------
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
                           'vendor_name', 'vendor_url', 'notes', 'priority', 'essential_justification'];
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
                                            notes, priority, essential_justification, added_in_revision)
      values (p_requisition_id, v_line, v_new.description, v_new.specifications, v_new.color, v_new.size,
              v_new.quantity, v_new.estimated_unit_price, v_new.estimated_total, v_new.vendor_name, v_new.vendor_url,
              v_new.notes, v_new.priority, v_new.essential_justification, v_rev)
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

-- ---------------------------------------------------------------------------
-- Removed lines take no part in review, priority summaries or attention counts.
-- (Same definitions as before, plus `removed_at is null`.)
-- ---------------------------------------------------------------------------
create or replace function public.highest_item_priority(r public.requisitions)
returns public.item_priority language sql stable set search_path = public, pg_temp as $$
  select min(i.priority) from public.requisition_items i where i.requisition_id = r.id and i.removed_at is null
$$;

create or replace function public.essential_item_count(r public.requisitions)
returns integer language sql stable set search_path = public, pg_temp as $$
  select count(*)::int from public.requisition_items i
  where i.requisition_id = r.id and i.priority = 'essential' and i.removed_at is null
$$;

create or replace function private.notification_requisition(p_id uuid)
returns table (
  requisition_number text,
  department text,
  essential int,
  issues_purchase_order boolean,
  allows_vendor_orders boolean,
  requires_disbursement boolean,
  workflow public.workflow_kind,
  assigned_reviewer_id uuid,
  is_demo boolean
) language sql stable security definer set search_path = public, pg_temp as $$
  select r.requisition_number, d.name,
         (select count(*)::int from public.requisition_items i where i.requisition_id = r.id and i.priority = 'essential' and i.removed_at is null),
         t.issues_purchase_order, t.allows_vendor_orders, t.requires_disbursement, t.workflow,
         r.assigned_reviewer_id, r.is_demo
  from public.requisitions r
  join public.departments d on d.id = r.department_id
  join public.request_types t on t.id = r.request_type_id
  where r.id = p_id
$$;

create or replace function public.my_needs_attention()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_out jsonb := '{}'::jsonb;
  v_card text;
  v_view boolean := private.has_permission('requisitions.view');
begin
  if auth.uid() is null then
    return v_out;
  end if;
  if v_view and private.has_permission('requisitions.review') then
    v_out := v_out || jsonb_build_object('awaiting_review', (
      select jsonb_build_object(
        'count', count(*),
        'essential', count(*) filter (where exists (select 1 from public.requisition_items i where i.requisition_id = r.id and i.priority = 'essential' and i.removed_at is null)),
        'assigned_to_me', count(*) filter (where r.assigned_reviewer_id = auth.uid()),
        'oldest', min(r.submitted_at))
      from public.requisitions r where r.id in (select private.attention_requisition_ids('awaiting_review'))));
  end if;
  foreach v_card in array array['on_hold', 'ready_for_po', 'ready_to_order', 'awaiting_receipts', 'ready_for_disbursement'] loop
    if v_view and private.has_permission(private.attention_card_permission(v_card)) then
      v_out := v_out || jsonb_build_object(v_card, jsonb_build_object('count', (select count(*) from private.attention_requisition_ids(v_card))));
    end if;
  end loop;
  -- reconcile_receipt: pending receipts on a requisition that is past approval; assign_receipt: unmatched.
  if private.has_permission('receipts.reconcile') then
    v_out := v_out || jsonb_build_object('receipts_to_reconcile', jsonb_build_object(
      'count', (select count(*) from public.receipts rc join public.requisitions r on r.id = rc.requisition_id
                 where rc.status = 'pending' and r.status in ('approved', 'partially_approved', 'po_issued', 'ordered', 'partially_purchased', 'purchased')),
      'unmatched', (select count(*) from public.receipts rc where rc.status = 'unmatched')));
  end if;
  return v_out;
end $$;

create or replace function public.set_requisition_item_priority(
  p_item_id uuid,
  p_priority text,
  p_essential_justification text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_item public.requisition_items;
  v_status public.requisition_status;
  v_reason text;
begin
  perform private.require_permission('requisitions.review');
  if coalesce(p_priority, '') not in ('essential', 'high', 'medium', 'low') then
    perform private.fail('Choose a valid priority');
  end if;
  select * into v_item from public.requisition_items where id = p_item_id for update;
  if not found then perform private.fail('Line item not found'); end if;
  if v_item.removed_at is not null then perform private.fail('This line was removed from the requisition'); end if;
  select status into v_status from public.requisitions where id = v_item.requisition_id;
  if v_status = 'closed' then
    perform private.fail('Priority cannot be changed on a closed requisition');
  end if;
  v_reason := case when p_priority = 'essential' then private.clean_text(p_essential_justification, 500) end;
  if p_priority = 'essential' and length(coalesce(v_reason, '')) < 10 then
    perform private.fail('Explain why this item is essential (at least 10 characters)');
  end if;

  update public.requisition_items
     set priority = p_priority::public.item_priority, essential_justification = v_reason
   where id = p_item_id;

  return jsonb_build_object(
    'requisition_id', v_item.requisition_id,
    'previous_priority', v_item.priority,
    'priority', p_priority,
    'changed', v_item.priority::text <> p_priority or v_item.essential_justification is distinct from v_reason);
end $$;

-- review_requisition: identical, except removed lines are skipped everywhere.
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
       where id = (v_input ->> 'item_id')::uuid and requisition_id = p_requisition_id and removed_at is null;
    end loop;
    v_target := 'on_hold';
  else
    for v_item in select * from public.requisition_items
                   where requisition_id = p_requisition_id and removed_at is null order by line_number loop
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
      if exists (select 1 from public.requisition_items
                  where requisition_id = p_requisition_id and review_status = 'held' and removed_at is null) then
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
                                 from public.requisition_items where requisition_id = p_requisition_id and removed_at is null)),
    jsonb_build_object('comment', v_comment));

  return jsonb_build_object('previous_status', v_prev, 'status', v_target,
    'approved_total', (select approved_total::text from public.requisitions where id = p_requisition_id));
end $$;

-- ---------------------------------------------------------------------------
-- Permission. Phase 1: Administrator and Head of Finance only (the roles that
-- can already see and review requisitions). No other role's permissions change.
-- ---------------------------------------------------------------------------
insert into public.permissions (key, group_name, description) values
  ('requisitions.amend', 'Requisitions', 'Amend submitted requisitions (add, change or remove line items) with a recorded reason')
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, 'requisitions.amend' from public.roles r
where r.key in ('administrator', 'head_of_finance')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- RLS and privileges
-- ---------------------------------------------------------------------------
alter table public.requisition_amendments enable row level security;
alter table public.requisition_item_changes enable row level security;
create policy requisition_amendments_select on public.requisition_amendments for select to authenticated
  using (private.has_permission('requisitions.view'));
create policy requisition_item_changes_select on public.requisition_item_changes for select to authenticated
  using (private.has_permission('requisitions.view'));

revoke all on public.requisition_amendments, public.requisition_item_changes from anon, authenticated;
grant select on public.requisition_amendments, public.requisition_item_changes to authenticated;
grant all on public.requisition_amendments, public.requisition_item_changes to service_role;

revoke all on function public.amend_requisition(uuid, text, jsonb) from public, anon;
grant execute on function public.amend_requisition(uuid, text, jsonb) to authenticated;
revoke all on function private.append_only() from public, anon, authenticated;
revoke all on function private.requisition_item_content(public.requisition_items) from public, anon, authenticated;
revoke all on function private.requisition_item_review(public.requisition_items) from public, anon, authenticated;
revoke all on function private.amendment_audit_value(text, jsonb) from public, anon, authenticated;
revoke all on function private.amended_line(public.requisition_items, jsonb, text) from public, anon, authenticated;
