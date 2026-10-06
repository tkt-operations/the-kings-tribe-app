-- =============================================================================
-- Migration 20261006000100: line-item priority (ADDITIVE ONLY)
--
-- * Each requisition line item carries the requester's operational priority:
--   essential > high > medium > low. Priority is information for Finance; it
--   never changes an item's review/approval state.
-- * Existing line items default to 'medium'. Nothing is inferred from
--   descriptions or amounts.
-- * A requisition's "highest priority" is CALCULATED from its items
--   (computed fields below), never stored.
-- * Changes after submission are audit-logged (who, when, before/after).
--
-- No existing table, policy or function is altered or dropped. The original
-- public.submit_requisition keeps working unchanged (items default to medium);
-- the app calls the new public.submit_requisition_with_priority wrapper.
-- =============================================================================

-- Enum order is significant: min(priority) = the most important.
create type public.item_priority as enum ('essential', 'high', 'medium', 'low');

alter table public.requisition_items
  add column priority public.item_priority not null default 'medium',
  add column essential_justification text;

-- Essential items need a brief reason; other priorities carry none.
alter table public.requisition_items
  add constraint requisition_items_essential_justification_check check (
    (priority = 'essential' and essential_justification is not null
       and length(btrim(essential_justification)) between 10 and 500)
    or (priority <> 'essential' and essential_justification is null)
  );

create index requisition_items_priority_idx on public.requisition_items (requisition_id, priority);

-- ---------------------------------------------------------------------------
-- Computed fields for the requisition list (PostgREST: select/filter/order by
-- `highest_item_priority`). SECURITY INVOKER, so the caller's RLS on
-- requisition_items applies — same permission as reading the requisition.
-- ---------------------------------------------------------------------------
create or replace function public.highest_item_priority(r public.requisitions)
returns public.item_priority language sql stable set search_path = public, pg_temp as $$
  select min(i.priority) from public.requisition_items i where i.requisition_id = r.id
$$;

create or replace function public.essential_item_count(r public.requisitions)
returns integer language sql stable set search_path = public, pg_temp as $$
  select count(*)::int from public.requisition_items i
  where i.requisition_id = r.id and i.priority = 'essential'
$$;

-- ---------------------------------------------------------------------------
-- Audit: any priority/justification change after submission.
-- The submission wrapper sets app.priority_initializing to the new
-- requisition's id so recording the requester's initial choices is not
-- reported as a "change". Only definer functions can write these columns.
-- ---------------------------------------------------------------------------
create or replace function private.audit_item_priority_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(current_setting('app.priority_initializing', true), '') = new.requisition_id::text then
    return new;
  end if;
  perform private.write_audit(
    'requisition_item.priority_changed', 'requisition_item', new.id, new.requisition_id,
    jsonb_build_object('priority', old.priority, 'essential_justification', old.essential_justification),
    jsonb_build_object('priority', new.priority, 'essential_justification', new.essential_justification),
    jsonb_build_object('line_number', new.line_number, 'description', left(new.description, 120),
                       'from', old.priority, 'to', new.priority));
  return new;
end $$;

create trigger requisition_items_priority_audit
  after update of priority, essential_justification on public.requisition_items
  for each row
  when (old.priority is distinct from new.priority
        or old.essential_justification is distinct from new.essential_justification)
  execute function private.audit_item_priority_change();

-- ---------------------------------------------------------------------------
-- Submission with per-line priorities. Validates every line's priority (and
-- the Essential justification) BEFORE creating anything, delegates to the
-- existing submit_requisition, then records priorities — all in one
-- transaction, so a failure leaves nothing behind.
-- Called ONLY by trusted server code (service_role).
-- ---------------------------------------------------------------------------
create or replace function public.submit_requisition_with_priority(
  p_token text,
  p_payload jsonb,
  p_files jsonb default '[]'::jsonb,
  p_fingerprint text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_item jsonb;
  v_line int := 0;
  v_priority text;
  v_reason text;
  v_result jsonb;
  v_req_id uuid;
begin
  if jsonb_typeof(p_payload -> 'items') = 'array' then
    for v_item in select * from jsonb_array_elements(p_payload -> 'items') loop
      v_line := v_line + 1;
      v_priority := btrim(coalesce(v_item ->> 'priority', ''));
      if v_priority not in ('essential', 'high', 'medium', 'low') then
        perform private.fail(format('Choose a priority for item %s', v_line));
      end if;
      v_reason := private.clean_text(v_item ->> 'essential_justification', 500);
      if v_priority = 'essential' and length(coalesce(v_reason, '')) < 10 then
        perform private.fail(format('Explain why item %s is essential (at least 10 characters)', v_line));
      end if;
    end loop;
  end if;

  v_result := public.submit_requisition(p_token, p_payload, p_files, p_fingerprint);
  v_req_id := (v_result ->> 'id')::uuid;

  perform set_config('app.priority_initializing', v_req_id::text, true);
  update public.requisition_items i
     set priority = (e.value ->> 'priority')::public.item_priority,
         essential_justification = case when e.value ->> 'priority' = 'essential'
                                        then private.clean_text(e.value ->> 'essential_justification', 500) end
    from jsonb_array_elements(p_payload -> 'items') with ordinality as e(value, ord)
   where i.requisition_id = v_req_id and i.line_number = e.ord;
  perform set_config('app.priority_initializing', '', true);

  return v_result || jsonb_build_object(
    'items', (select jsonb_agg(jsonb_build_object(
                       'line_number', line_number, 'description', description,
                       'quantity', quantity::text, 'estimated_total', estimated_total::text,
                       'priority', priority, 'essential_justification', essential_justification)
                     order by line_number)
              from public.requisition_items where requisition_id = v_req_id));
end $$;

-- ---------------------------------------------------------------------------
-- Finance may correct a line's priority (e.g. after talking to the requester).
-- Requires requisitions.review; audited by the trigger above. Never touches
-- review_status, approved quantities or any money column.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Privileges (nothing is granted by default; see migration 0500)
-- ---------------------------------------------------------------------------
revoke all on function public.highest_item_priority(public.requisitions) from public, anon;
revoke all on function public.essential_item_count(public.requisitions) from public, anon;
revoke all on function public.submit_requisition_with_priority(text, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.set_requisition_item_priority(uuid, text, text) from public, anon;
revoke all on function private.audit_item_priority_change() from public, anon, authenticated;

grant execute on function public.highest_item_priority(public.requisitions) to authenticated, service_role;
grant execute on function public.essential_item_count(public.requisitions) to authenticated, service_role;
grant execute on function public.set_requisition_item_priority(uuid, text, text) to authenticated;
grant execute on function public.submit_requisition_with_priority(text, jsonb, jsonb, text) to service_role;
grant execute on function private.audit_item_priority_change() to service_role;
