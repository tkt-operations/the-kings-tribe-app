-- =============================================================================
-- Migration 20261009000100: operational user notifications (Release 1) — ADDITIVE
--
-- An internal user's operational inbox ("Requisition TKT-REQ-… requires your
-- review"). This is NOT the email log: public.notifications,
-- notification_events and notification_preferences keep their meaning
-- (email/SMS sends, provider delivery events, requester email preferences).
-- Push delivery is a later, separate channel and is not modelled here.
--
-- Rows are created only by database triggers on workflow tables, in the same
-- transaction as the workflow change. Recipients come from the permission
-- tables (administrators hold every permission), never from role names.
-- Each event has its own actor rule (see the trigger functions). External
-- requesters have no profile and can never be recipients. Demo records never
-- notify. Every event has a deterministic key: replays insert nothing.
-- =============================================================================

create type public.notification_category as enum ('requisitions', 'purchasing', 'finance', 'system');
create type public.notification_importance as enum ('high', 'normal', 'low');

create table public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (type ~ '^[a-z_]+\.[a-z_]+$' and length(type) <= 60),
  category public.notification_category not null,
  importance public.notification_importance not null default 'normal',
  title text not null check (length(btrim(title)) between 1 and 120),
  body text check (body is null or length(body) <= 300),
  -- Server-generated links to fixed application routes only.
  link text not null check (link ~ '^/(requisitions/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|receipts|dashboard|notifications)$'),
  requisition_id uuid references public.requisitions (id) on delete cascade,
  receipt_id uuid references public.receipts (id) on delete cascade,
  -- The permission the recipient must STILL hold to see this row.
  visible_with text not null references public.permissions (key),
  event_key text not null check (length(event_key) between 1 and 200),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, event_key),
  check (requisition_id is null or visible_with = 'requisitions.view')
);
create index user_notifications_inbox_idx on public.user_notifications (user_id, created_at desc);
create index user_notifications_unread_idx on public.user_notifications (user_id) where read_at is null;
create index user_notifications_requisition_idx on public.user_notifications (requisition_id) where requisition_id is not null;
create index user_notifications_receipt_idx on public.user_notifications (receipt_id) where receipt_id is not null;

-- ---------------------------------------------------------------------------
-- Recipient resolution (same rule as private.has_permission, for any user)
-- ---------------------------------------------------------------------------
create or replace function private.user_has_permission(p_user uuid, p_permission text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.profiles p
    join public.user_roles ur on ur.user_id = p.id
    join public.roles r on r.id = ur.role_id
    left join public.role_permissions rp on rp.role_id = r.id and rp.permission_key = p_permission
    where p.id = p_user and p.is_active
      and (r.key = 'administrator' or rp.permission_key is not null)
  )
$$;

-- Active users holding p_permission AND p_visible_with, optionally minus one user.
create or replace function private.notification_recipients(p_permission text, p_visible_with text, p_exclude uuid)
returns setof uuid language sql stable security definer set search_path = public, pg_temp as $$
  select p.id from public.profiles p
  where p.is_active
    and p.id is distinct from p_exclude
    and private.user_has_permission(p.id, p_permission)
    and private.user_has_permission(p.id, p_visible_with)
$$;

-- Insert one inbox row per recipient. No recipients => nothing happens (never an error).
create or replace function private.notify_holders(
  p_permission text,
  p_exclude uuid,
  p_type text,
  p_category public.notification_category,
  p_importance public.notification_importance,
  p_title text,
  p_body text,
  p_link text,
  p_requisition_id uuid,
  p_receipt_id uuid,
  p_visible_with text,
  p_event_key text
) returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_count int;
begin
  insert into public.user_notifications (user_id, type, category, importance, title, body, link, requisition_id, receipt_id, visible_with, event_key)
  select u, p_type, p_category, p_importance, p_title, p_body, p_link, p_requisition_id, p_receipt_id, p_visible_with, p_event_key
  from private.notification_recipients(p_permission, p_visible_with, p_exclude) as u
  on conflict (user_id, event_key) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- One specific user (e.g. the assigned reviewer), only if they hold both permissions.
create or replace function private.notify_user(
  p_user uuid,
  p_permission text,
  p_type text,
  p_category public.notification_category,
  p_importance public.notification_importance,
  p_title text,
  p_body text,
  p_link text,
  p_requisition_id uuid,
  p_visible_with text,
  p_event_key text
) returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_count int;
begin
  if p_user is null or not private.user_has_permission(p_user, p_permission) or not private.user_has_permission(p_user, p_visible_with) then
    return 0;
  end if;
  insert into public.user_notifications (user_id, type, category, importance, title, body, link, requisition_id, visible_with, event_key)
  values (p_user, p_type, p_category, p_importance, p_title, p_body, p_link, p_requisition_id, p_visible_with, p_event_key)
  on conflict (user_id, event_key) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Safe, concise facts about a requisition for notification text (no amounts, items or requester details).
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
         (select count(*)::int from public.requisition_items i where i.requisition_id = r.id and i.priority = 'essential'),
         t.issues_purchase_order, t.allows_vendor_orders, t.requires_disbursement, t.workflow,
         r.assigned_reviewer_id, r.is_demo
  from public.requisitions r
  join public.departments d on d.id = r.department_id
  join public.request_types t on t.id = r.request_type_id
  where r.id = p_id
$$;

-- ---------------------------------------------------------------------------
-- Requisition status changes.
-- DEFERRED to commit, so the final state is seen (e.g. line priorities are set
-- after the submission row is written).
--
--   submitted (new)        -> requisitions.review holders; actor is the
--                             external requester (never a recipient). High
--                             importance when any line is Essential.
--   approved / partially   -> holders of the NEXT action's permission (PO,
--   approved (from review)    order, disbursement or reconciliation, from the
--                             request type's flags). Actor INCLUDED: the
--                             approver may well perform that next step.
--   on_hold                -> the assigned reviewer if any (unless they are the
--                             actor), otherwise review holders minus the actor.
--   rejected               -> review holders minus the actor (FYI).
--   purchased              -> next action: reimbursement -> disbursements.record;
--                             otherwise ready to close -> requisitions.review.
--                             Actor INCLUDED (they may perform that next step).
--   closed                 -> review holders minus the actor (FYI).
--   under_review, po_issued, ordered, partially_purchased, and any automatic
--   move back to approved (e.g. after a PO is voided) create nothing here:
--   they are covered by the PO / vendor-order / receipt events or are noise.
-- ---------------------------------------------------------------------------
create or replace function private.notify_on_status_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  v_link text := '/requisitions/' || new.requisition_id;
  v_key text := 'status:' || new.id;
  v_body text;
  v_permission text;
  v_category public.notification_category;
  v_next text;
  v_partial boolean;
begin
  select * into r from private.notification_requisition(new.requisition_id);
  if not found or r.is_demo then
    return null;
  end if;
  v_body := r.requisition_number || ' · ' || r.department;

  if new.to_status = 'submitted' and new.from_status is null then
    perform private.notify_holders('requisitions.review', null, 'requisition.submitted', 'requisitions',
      case when r.essential > 0 then 'high' else 'normal' end::public.notification_importance,
      case when r.essential > 0 then 'Essential requisition requires review' else 'New requisition requires review' end,
      v_body || case when r.essential > 0 then format(' · %s Essential item%s', r.essential, case when r.essential = 1 then '' else 's' end) else '' end,
      v_link, new.requisition_id, null, 'requisitions.view', v_key);

  elsif new.to_status in ('approved', 'partially_approved') and new.from_status in ('submitted', 'under_review', 'on_hold') then
    v_partial := new.to_status = 'partially_approved';
    if r.issues_purchase_order then
      v_permission := 'purchase_orders.issue'; v_next := 'ready for PO'; v_category := 'purchasing';
    elsif r.allows_vendor_orders then
      v_permission := 'orders.record'; v_next := 'ready to order'; v_category := 'purchasing';
    elsif r.requires_disbursement and r.workflow <> 'reimbursement' then
      v_permission := 'disbursements.record'; v_next := 'ready for disbursement'; v_category := 'finance';
    else
      v_permission := 'receipts.reconcile'; v_next := 'receipts to reconcile'; v_category := 'purchasing';
    end if;
    perform private.notify_holders(v_permission, null,
      case when v_partial then 'requisition.partially_approved' else 'requisition.approved' end,
      v_category, 'normal',
      (case when v_partial then 'Requisition partially approved — ' else 'Requisition approved — ' end) || v_next,
      v_body, v_link, new.requisition_id, null, 'requisitions.view', v_key);

  elsif new.to_status = 'on_hold' then
    if r.assigned_reviewer_id is not null then
      if r.assigned_reviewer_id is distinct from new.changed_by then
        perform private.notify_user(r.assigned_reviewer_id, 'requisitions.review', 'requisition.on_hold', 'requisitions', 'low',
          'Requisition placed on hold', v_body, v_link, new.requisition_id, 'requisitions.view', v_key);
      end if;
    else
      perform private.notify_holders('requisitions.review', new.changed_by, 'requisition.on_hold', 'requisitions', 'low',
        'Requisition placed on hold', v_body, v_link, new.requisition_id, null, 'requisitions.view', v_key);
    end if;

  elsif new.to_status = 'rejected' then
    perform private.notify_holders('requisitions.review', new.changed_by, 'requisition.rejected', 'requisitions', 'low',
      'Requisition rejected', v_body, v_link, new.requisition_id, null, 'requisitions.view', v_key);

  elsif new.to_status = 'purchased' then
    if r.requires_disbursement and r.workflow = 'reimbursement' then
      perform private.notify_holders('disbursements.record', null, 'requisition.purchased', 'finance', 'normal',
        'Purchase reconciled — ready for reimbursement', v_body, v_link, new.requisition_id, null, 'requisitions.view', v_key);
    else
      perform private.notify_holders('requisitions.review', null, 'requisition.purchased', 'requisitions', 'low',
        'Requisition fully purchased — ready to close', v_body, v_link, new.requisition_id, null, 'requisitions.view', v_key);
    end if;

  elsif new.to_status = 'closed' then
    perform private.notify_holders('requisitions.review', new.changed_by, 'requisition.closed', 'requisitions', 'low',
      'Requisition closed', v_body, v_link, new.requisition_id, null, 'requisitions.view', v_key);
  end if;
  return null;
end $$;

create constraint trigger requisition_status_history_notify
  after insert on public.requisition_status_history
  deferrable initially deferred
  for each row execute function private.notify_on_status_change();

-- ---------------------------------------------------------------------------
-- Reviewer assignment: only the assignee, and only when someone ELSE assigned
-- them (starting a review self-assigns; that tells them nothing new).
-- ---------------------------------------------------------------------------
create or replace function private.notify_on_reviewer_assigned()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
begin
  if new.assigned_reviewer_id is null
     or new.assigned_reviewer_id is not distinct from old.assigned_reviewer_id
     or new.assigned_reviewer_id is not distinct from auth.uid()
     or new.is_demo then
    return null;
  end if;
  select * into r from private.notification_requisition(new.id);
  perform private.notify_user(new.assigned_reviewer_id, 'requisitions.review', 'requisition.assigned', 'requisitions', 'normal',
    'Requisition assigned to you', r.requisition_number || ' · ' || r.department, '/requisitions/' || new.id, new.id,
    'requisitions.view',
    'assigned:' || new.id || ':' || new.assigned_reviewer_id || ':' || floor(extract(epoch from now()) * 1000)::bigint);
  return null;
end $$;

create trigger requisitions_notify_reviewer_assigned
  after update of assigned_reviewer_id on public.requisitions
  for each row execute function private.notify_on_reviewer_assigned();

-- ---------------------------------------------------------------------------
-- Purchase orders.
--   issued -> type allows vendor orders: orders.record ("ready to order"),
--             actor INCLUDED (may place the order);
--             otherwise the requester buys: receipts.reconcile FYI, actor excluded.
--   void   -> purchase_orders.issue (may need re-issuing), actor excluded.
-- ---------------------------------------------------------------------------
create or replace function private.notify_on_purchase_order()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  v_link text := '/requisitions/' || new.requisition_id;
  v_body text;
begin
  select * into r from private.notification_requisition(new.requisition_id);
  if not found or r.is_demo or new.is_demo then
    return null;
  end if;
  v_body := new.po_number || ' · ' || r.requisition_number || ' · ' || r.department;
  if tg_op = 'INSERT' and new.status = 'issued' then
    if r.allows_vendor_orders then
      perform private.notify_holders('orders.record', null, 'purchase_order.issued', 'purchasing', 'normal',
        'Purchase order issued — ready to order', v_body, v_link, new.requisition_id, null, 'requisitions.view', 'po:' || new.id || ':issued');
    else
      perform private.notify_holders('receipts.reconcile', auth.uid(), 'purchase_order.issued', 'purchasing', 'low',
        'Purchase order issued — awaiting receipt', v_body, v_link, new.requisition_id, null, 'requisitions.view', 'po:' || new.id || ':issued');
    end if;
  elsif tg_op = 'UPDATE' and new.status = 'void' and old.status is distinct from 'void' then
    perform private.notify_holders('purchase_orders.issue', auth.uid(), 'purchase_order.voided', 'purchasing', 'normal',
      'Purchase order voided', v_body, v_link, new.requisition_id, null, 'requisitions.view', 'po:' || new.id || ':void');
  end if;
  return null;
end $$;

create trigger purchase_orders_notify
  after insert or update of status on public.purchase_orders
  for each row execute function private.notify_on_purchase_order();

-- ---------------------------------------------------------------------------
-- Vendor orders.
--   placed    -> receipts.reconcile FYI (a receipt is expected), actor excluded.
--   cancelled -> orders.record (may need re-ordering), actor excluded.
-- ---------------------------------------------------------------------------
create or replace function private.notify_on_vendor_order()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  v_link text := '/requisitions/' || new.requisition_id;
  v_body text;
begin
  select * into r from private.notification_requisition(new.requisition_id);
  if not found or r.is_demo or new.is_demo then
    return null;
  end if;
  v_body := r.requisition_number || ' · ' || r.department;
  if tg_op = 'INSERT' and new.status = 'placed' then
    perform private.notify_holders('receipts.reconcile', auth.uid(), 'vendor_order.placed', 'purchasing', 'low',
      'Vendor order placed — receipt expected', v_body, v_link, new.requisition_id, null, 'requisitions.view', 'vo:' || new.id || ':placed');
  elsif tg_op = 'UPDATE' and new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    perform private.notify_holders('orders.record', auth.uid(), 'vendor_order.cancelled', 'purchasing', 'normal',
      'Vendor order cancelled', v_body, v_link, new.requisition_id, null, 'requisitions.view', 'vo:' || new.id || ':cancelled');
  end if;
  return null;
end $$;

create trigger vendor_orders_notify
  after insert or update of status on public.vendor_orders
  for each row execute function private.notify_on_vendor_order();

-- ---------------------------------------------------------------------------
-- Receipts (new rows only; receipts sent with the submission are covered by
-- requisition.submitted).
--   pending, matched -> receipts.reconcile; actor INCLUDED (the uploader may
--                       reconcile it).
--   unmatched (email) -> receipts.reconcile, visible only while the recipient
--                       holds receipts.reconcile; links to /receipts.
-- ---------------------------------------------------------------------------
create or replace function private.notify_on_receipt()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
begin
  if new.is_demo or new.source = 'submission' then
    return null;
  end if;
  if new.status = 'unmatched' then
    perform private.notify_holders('receipts.reconcile', null, 'receipt.unmatched', 'purchasing', 'normal',
      'Unmatched receipt needs assigning', 'A receipt arrived by email and could not be matched to a requisition.',
      '/receipts', null, new.id, 'receipts.reconcile', 'receipt:' || new.id || ':unmatched');
  elsif new.status = 'pending' and new.requisition_id is not null then
    select * into r from private.notification_requisition(new.requisition_id);
    if not found or r.is_demo then
      return null;
    end if;
    perform private.notify_holders('receipts.reconcile', null, 'receipt.received', 'purchasing', 'normal',
      'Receipt ready to reconcile', r.requisition_number || ' · ' || r.department,
      '/requisitions/' || new.requisition_id, new.requisition_id, new.id, 'requisitions.view', 'receipt:' || new.id || ':received');
  end if;
  return null;
end $$;

create trigger receipts_notify
  after insert on public.receipts
  for each row execute function private.notify_on_receipt();

-- ---------------------------------------------------------------------------
-- Inbox operations for the signed-in user (only their own, still-visible rows).
-- ---------------------------------------------------------------------------
create or replace function public.mark_notification_read(p_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  update public.user_notifications
     set read_at = now()
   where id = p_id and user_id = auth.uid() and read_at is null and private.has_permission(visible_with);
  return found;
end $$;

create or replace function public.mark_all_notifications_read()
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_count int;
begin
  if auth.uid() is null then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  update public.user_notifications
     set read_at = now()
   where user_id = auth.uid() and read_at is null and private.has_permission(visible_with);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create or replace function public.unread_notification_count()
returns int language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::int from public.user_notifications
  where user_id = auth.uid() and read_at is null and private.has_permission(visible_with)
$$;

-- ---------------------------------------------------------------------------
-- Needs Attention: LIVE workflow state (creates nothing). Each card mirrors
-- the workflow functions' own preconditions and the per-type timeline.
-- ---------------------------------------------------------------------------
create or replace function private.attention_card_permission(p_card text)
returns text language sql immutable as $$
  select case p_card
    when 'awaiting_review' then 'requisitions.review'
    when 'on_hold' then 'requisitions.review'
    when 'ready_for_po' then 'purchase_orders.issue'
    when 'ready_to_order' then 'orders.record'
    when 'awaiting_receipts' then 'receipts.reconcile'
    when 'ready_for_disbursement' then 'disbursements.record'
  end
$$;

create or replace function private.attention_requisition_ids(p_card text)
returns setof uuid language sql stable security definer set search_path = public, pg_temp as $$
  select r.id
  from public.requisitions r
  join public.request_types t on t.id = r.request_type_id
  where case p_card
    when 'awaiting_review' then r.status in ('submitted', 'under_review')
    when 'on_hold' then r.status = 'on_hold'
    -- issue_purchase_order: type issues POs, approved, nothing on an issued PO yet.
    when 'ready_for_po' then t.issues_purchase_order and r.status in ('approved', 'partially_approved')
      and not exists (select 1 from public.purchase_orders po where po.requisition_id = r.id and po.status = 'issued')
    -- record_vendor_order: type allows vendor orders, nothing ordered yet; after the PO when the type issues POs.
    when 'ready_to_order' then t.allows_vendor_orders
      and not exists (select 1 from public.vendor_orders vo where vo.requisition_id = r.id and vo.status = 'placed')
      and ((t.issues_purchase_order and r.status = 'po_issued') or (not t.issues_purchase_order and r.status in ('approved', 'partially_approved')))
    -- Purchasing under way and no receipt waiting to be reconciled.
    when 'awaiting_receipts' then not exists (select 1 from public.receipts rc where rc.requisition_id = r.id and rc.status = 'pending')
      and (r.status in ('ordered', 'partially_purchased')
           or (r.status = 'po_issued' and not t.allows_vendor_orders)
           or (t.requires_disbursement and t.workflow <> 'reimbursement' and r.status in ('approved', 'partially_approved') and r.disbursed_total > 0))
    -- Per timeline: reimbursements are repaid after purchase; petty cash / advances are paid before the receipt.
    when 'ready_for_disbursement' then t.requires_disbursement
      and ((t.workflow = 'reimbursement' and r.status = 'purchased' and r.disbursed_total < least(r.actual_total, r.approved_total))
        or (t.workflow <> 'reimbursement' and r.status in ('approved', 'partially_approved') and r.disbursed_total = 0))
    else false
  end
$$;

-- Requisition ids behind a card (for the filtered requisition list), only if the caller may act on it.
create or replace function public.needs_attention_requisition_ids(p_card text)
returns setof uuid language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if private.attention_card_permission(p_card) is null
     or not private.has_permission(private.attention_card_permission(p_card))
     or not private.has_permission('requisitions.view') then
    return;
  end if;
  return query select private.attention_requisition_ids(p_card);
end $$;

-- Counts for the cards the caller may act on (keys are omitted otherwise).
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
        'essential', count(*) filter (where exists (select 1 from public.requisition_items i where i.requisition_id = r.id and i.priority = 'essential')),
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

-- ---------------------------------------------------------------------------
-- RLS and privileges
-- ---------------------------------------------------------------------------
alter table public.user_notifications enable row level security;
-- Own rows only, and only while the recipient still holds the permission the
-- row requires (requisitions.view for requisition-linked rows).
create policy user_notifications_select_own on public.user_notifications for select to authenticated
  using (user_id = auth.uid() and private.has_permission(visible_with));

revoke all on public.user_notifications from anon, authenticated;
grant select on public.user_notifications to authenticated;
grant all on public.user_notifications to service_role;

revoke all on function private.user_has_permission(uuid, text) from public, anon, authenticated;
revoke all on function private.notification_recipients(text, text, uuid) from public, anon, authenticated;
revoke all on function private.notify_holders(text, uuid, text, public.notification_category, public.notification_importance, text, text, text, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function private.notify_user(uuid, text, text, public.notification_category, public.notification_importance, text, text, text, uuid, text, text) from public, anon, authenticated;
revoke all on function private.notification_requisition(uuid) from public, anon, authenticated;
revoke all on function private.notify_on_status_change() from public, anon, authenticated;
revoke all on function private.notify_on_reviewer_assigned() from public, anon, authenticated;
revoke all on function private.notify_on_purchase_order() from public, anon, authenticated;
revoke all on function private.notify_on_vendor_order() from public, anon, authenticated;
revoke all on function private.notify_on_receipt() from public, anon, authenticated;
revoke all on function private.attention_card_permission(text) from public, anon, authenticated;
revoke all on function private.attention_requisition_ids(text) from public, anon, authenticated;

revoke all on function public.mark_notification_read(uuid) from public, anon, authenticated;
revoke all on function public.mark_all_notifications_read() from public, anon, authenticated;
revoke all on function public.unread_notification_count() from public, anon, authenticated;
revoke all on function public.needs_attention_requisition_ids(text) from public, anon, authenticated;
revoke all on function public.my_needs_attention() from public, anon, authenticated;
grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.mark_all_notifications_read() to authenticated;
grant execute on function public.unread_notification_count() to authenticated;
grant execute on function public.needs_attention_requisition_ids(text) to authenticated;
grant execute on function public.my_needs_attention() to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: publish ONLY this table (row access is still enforced by RLS).
-- Guarded so environments without the Supabase publication still migrate.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_notifications') then
    alter publication supabase_realtime add table public.user_notifications;
  end if;
end $$;
