-- =============================================================================
-- Migration 20261007000100: email delivery tracking (Resend webhooks) — ADDITIVE
--
-- notifications.status keeps its meaning: the app's own outcome
--   sent    = Resend ACCEPTED the API request (provider_message_id stored)
--   skipped = not attempted (e.g. opted out / email not configured)
--   failed  = the API request failed
-- New, separate provider lifecycle state comes ONLY from signed Resend webhook
-- events, recorded append-only in notification_events. A summary of the most
-- definitive state is cached on notifications for display.
--
-- Existing rows: delivery_status stays NULL ("accepted, no delivery update").
-- Nothing is backfilled, so historical emails are never shown as Delivered.
-- =============================================================================

create type public.email_delivery_status as enum (
  'sent', 'delivery_delayed', 'delivered', 'bounced', 'complained', 'failed', 'suppressed'
);

alter table public.notifications
  add column delivery_status public.email_delivery_status,
  add column delivery_status_at timestamptz,
  add column last_provider_event_at timestamptz;

-- Webhooks match on the id Resend returned when it accepted the email.
create index notifications_provider_message_idx on public.notifications (provider_message_id)
  where provider_message_id is not null;

-- One row per provider webhook event (Svix message id), append-only.
create table public.notification_events (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications (id) on delete cascade,
  provider text not null default 'resend' check (provider = 'resend'),
  provider_event_id text not null check (length(provider_event_id) between 1 and 200),
  event_type public.email_delivery_status not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  -- Short, safe reason for problems (e.g. bounce type/sub-type, failure code). No bodies or headers.
  detail text check (detail is null or length(detail) <= 300),
  unique (provider, provider_event_id)
);
create index notification_events_notification_idx on public.notification_events (notification_id, occurred_at);

create or replace function private.notification_events_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'notification_events are append-only' using errcode = '42501';
end $$;
create trigger notification_events_no_update before update or delete on public.notification_events
  for each row execute function private.notification_events_immutable();

-- Precedence (higher wins, regardless of arrival order):
--   sent 1 < delivery_delayed 2 < delivered 3 < bounced/failed/suppressed 4 < complained 5
-- A complaint can only follow a delivery, so it outranks delivered. Ties are
-- broken by the provider's event time.
create or replace function private.email_delivery_rank(p public.email_delivery_status)
returns int language sql immutable as $$
  select case p
    when 'sent' then 1 when 'delivery_delayed' then 2 when 'delivered' then 3
    when 'bounced' then 4 when 'failed' then 4 when 'suppressed' then 4
    when 'complained' then 5 end
$$;

-- Called ONLY by the signature-verified webhook route (service_role).
-- Idempotent: a repeated provider event id changes nothing.
-- Unknown provider message ids change nothing.
create or replace function public.record_email_delivery_event(
  p_provider_event_id text,
  p_provider_message_id text,
  p_event_type text,
  p_occurred_at timestamptz,
  p_detail text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_type public.email_delivery_status;
  v_notification public.notifications;
  v_inserted uuid;
  v_best record;
begin
  begin
    v_type := p_event_type::public.email_delivery_status;
  exception when invalid_text_representation then
    return jsonb_build_object('result', 'ignored', 'reason', 'unsupported event type');
  end;
  if coalesce(p_provider_event_id, '') = '' or coalesce(p_provider_message_id, '') = '' or p_occurred_at is null then
    perform private.fail('Missing provider event id, message id or time');
  end if;

  select * into v_notification from public.notifications
   where provider_message_id = p_provider_message_id and channel = 'email' and status = 'sent'
   order by created_at limit 1 for update;
  if not found then
    return jsonb_build_object('result', 'unmatched');
  end if;

  insert into public.notification_events (notification_id, provider_event_id, event_type, occurred_at, detail)
  values (v_notification.id, left(p_provider_event_id, 200), v_type, p_occurred_at, nullif(left(btrim(coalesce(p_detail, '')), 300), ''))
  on conflict (provider, provider_event_id) do nothing
  returning id into v_inserted;
  if v_inserted is null then
    return jsonb_build_object('result', 'duplicate', 'delivery_status', v_notification.delivery_status);
  end if;

  select e.event_type, e.occurred_at into v_best
    from public.notification_events e
   where e.notification_id = v_notification.id
   order by private.email_delivery_rank(e.event_type) desc, e.occurred_at desc
   limit 1;

  update public.notifications
     set delivery_status = v_best.event_type,
         delivery_status_at = v_best.occurred_at,
         last_provider_event_at = greatest(coalesce(last_provider_event_at, p_occurred_at), p_occurred_at)
   where id = v_notification.id;

  return jsonb_build_object('result', 'recorded', 'delivery_status', v_best.event_type);
end $$;

-- ---------------------------------------------------------------------------
-- RLS and privileges
-- ---------------------------------------------------------------------------
alter table public.notification_events enable row level security;
create policy notification_events_select on public.notification_events for select to authenticated
  using (private.has_permission('requisitions.view'));

revoke all on public.notification_events from anon, authenticated;
grant select on public.notification_events to authenticated;
grant all on public.notification_events to service_role;

revoke all on function public.record_email_delivery_event(text, text, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.record_email_delivery_event(text, text, text, timestamptz, text) to service_role;
revoke all on function private.email_delivery_rank(public.email_delivery_status) from public, anon, authenticated;
revoke all on function private.notification_events_immutable() from public, anon, authenticated;
grant execute on function private.email_delivery_rank(public.email_delivery_status) to service_role;
grant execute on function private.notification_events_immutable() to service_role;
