-- =============================================================================
-- Migration 20261010000100: Web Push (Release 2) — ADDITIVE
--
-- Push is a best-effort ALERT channel on top of the operational inbox
-- (user_notifications, Release 1), which stays the source of truth and is not
-- altered here. Nothing in this migration sends anything: the database only
-- records subscriptions, a per-user push level and which inbox rows have been
-- dispatched. Trusted server code (service_role) claims rows AFTER the
-- workflow transaction has committed and sends them with VAPID.
--
--   push_subscriptions          one row per browser/device subscription
--   user_notification_settings  push level per user (important | actionable)
--   push_dispatches             one row per inbox notification once claimed
--                               (idempotency: a notification is pushed once)
--
-- Clients never read endpoints or keys: everything goes through functions that
-- act only for auth.uid(). Endpoints are restricted to known push services.
-- =============================================================================

create type public.push_level as enum ('important', 'actionable');

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- Only the browser vendors' push services (prevents sending to arbitrary URLs).
  endpoint text not null unique check (
    length(endpoint) <= 2048
    and endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/'
  ),
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{40,200}={0,2}$'),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]{16,64}={0,2}$'),
  device_label text check (device_label is null or length(device_label) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  failure_count int not null default 0 check (failure_count >= 0)
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

create table public.user_notification_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  push_level public.push_level not null default 'actionable',
  updated_at timestamptz not null default now()
);

create table public.push_dispatches (
  notification_id uuid primary key references public.user_notifications (id) on delete cascade,
  status text not null default 'claimed' check (status in ('claimed', 'sent', 'failed', 'skipped')),
  claimed_at timestamptz not null default now(),
  completed_at timestamptz,
  sent_count int not null default 0,
  failed_count int not null default 0
);

-- ---------------------------------------------------------------------------
-- Push eligibility (the smallest useful policy):
--   low importance                       -> never pushed (in-app only)
--   level 'important'                     -> high importance, or assigned to you
--   level 'actionable' (default)          -> high and normal importance
-- The recipient must be active and still hold the row's visible_with permission.
-- ---------------------------------------------------------------------------
create or replace function private.push_eligible(p_notification public.user_notifications, p_level public.push_level)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select p_notification.importance <> 'low'
     and private.user_has_permission(p_notification.user_id, p_notification.visible_with)
     and case p_level
           when 'important' then p_notification.importance = 'high' or p_notification.type = 'requisition.assigned'
           else p_notification.importance in ('high', 'normal')
         end
$$;

-- ---------------------------------------------------------------------------
-- Functions for the signed-in user (only ever their own subscriptions).
-- ---------------------------------------------------------------------------
create or replace function private.require_active_user()
returns uuid language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid() and is_active) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return auth.uid();
end $$;

-- Enabling push on this browser. The endpoint and keys come from the browser's
-- own PushManager (only that browser has them). If the same browser was
-- enabled by another internal user, it now belongs to the user who explicitly
-- enabled it here (ownership transfer).
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_device_label text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := private.require_active_user();
  v_previous uuid;
begin
  select user_id into v_previous from public.push_subscriptions where endpoint = p_endpoint;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, device_label)
  values (v_user, p_endpoint, p_p256dh, p_auth, nullif(left(btrim(coalesce(p_device_label, '')), 80), ''))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        device_label = excluded.device_label, updated_at = now(), failure_count = 0, last_failure_at = null;
  return jsonb_build_object('transferred', v_previous is not null and v_previous <> v_user);
end $$;

-- Turning push off on this browser (only if it is the caller's).
create or replace function public.delete_my_push_subscription(p_endpoint text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := private.require_active_user();
begin
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = v_user;
  return found;
end $$;

-- Removing one of the caller's devices from the device list (by id, never by endpoint).
create or replace function public.delete_my_push_device(p_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := private.require_active_user();
begin
  delete from public.push_subscriptions where id = p_id and user_id = v_user;
  return found;
end $$;

-- Status for the settings panel: is THIS browser's endpoint registered to me,
-- my push level, and my devices (no endpoints or keys are returned).
create or replace function public.my_push_status(p_endpoint text default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := private.require_active_user();
begin
  return jsonb_build_object(
    'this_device', p_endpoint is not null and exists (select 1 from public.push_subscriptions where endpoint = p_endpoint and user_id = v_user),
    'push_level', coalesce((select push_level from public.user_notification_settings where user_id = v_user), 'actionable'),
    'devices', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'label', s.device_label, 'created_at', s.created_at, 'last_success_at', s.last_success_at,
               'this_device', s.endpoint = p_endpoint)
             order by s.created_at)
      from public.push_subscriptions s where s.user_id = v_user), '[]'::jsonb));
end $$;

create or replace function public.set_my_push_level(p_level public.push_level)
returns public.push_level language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := private.require_active_user();
begin
  insert into public.user_notification_settings (user_id, push_level) values (v_user, p_level)
  on conflict (user_id) do update set push_level = excluded.push_level, updated_at = now();
  return p_level;
end $$;

-- ---------------------------------------------------------------------------
-- Dispatch (service_role only; called by the server after the workflow commit).
-- Claims recent, not-yet-dispatched inbox rows exactly once (primary key +
-- ON CONFLICT DO NOTHING, safe under concurrency), marks ineligible ones or
-- ones without a device 'skipped', and returns one row per (notification,
-- device) to send. Rows older than the window are never pushed late.
-- ---------------------------------------------------------------------------
create or replace function public.claim_push_batch(p_window_minutes int default 30, p_limit int default 50)
returns table (
  notification_id uuid,
  subscription_id uuid,
  endpoint text,
  p256dh text,
  auth text,
  type text,
  importance public.notification_importance,
  link text,
  unread int
) language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_claimed uuid[];
begin
  with candidates as (
    select n.id from public.user_notifications n
    where n.created_at > now() - make_interval(mins => greatest(1, least(p_window_minutes, 1440)))
      and not exists (select 1 from public.push_dispatches d where d.notification_id = n.id)
    order by n.created_at
    limit greatest(1, least(p_limit, 500))
  ), inserted as (
    insert into public.push_dispatches (notification_id)
    select id from candidates
    on conflict on constraint push_dispatches_pkey do nothing
    returning push_dispatches.notification_id
  )
  select coalesce(array_agg(inserted.notification_id), '{}') into v_claimed from inserted;

  -- Nothing to send for these: not eligible, or the user has no device.
  update public.push_dispatches d
     set status = 'skipped', completed_at = now()
    from public.user_notifications n
   where d.notification_id = n.id and d.notification_id = any (v_claimed)
     and (not private.push_eligible(n, coalesce((select s.push_level from public.user_notification_settings s where s.user_id = n.user_id), 'actionable'))
          or not exists (select 1 from public.push_subscriptions ps where ps.user_id = n.user_id));

  return query
    select n.id, ps.id, ps.endpoint, ps.p256dh, ps.auth, n.type, n.importance, n.link,
           (select count(*)::int from public.user_notifications u
             where u.user_id = n.user_id and u.read_at is null and private.user_has_permission(u.user_id, u.visible_with))
    from public.push_dispatches d
    join public.user_notifications n on n.id = d.notification_id
    join public.push_subscriptions ps on ps.user_id = n.user_id
    where d.notification_id = any (v_claimed) and d.status = 'claimed'
    order by n.created_at;
end $$;

-- Results from the sender: [{notification_id, subscription_id, outcome: sent|gone|failed}].
--   gone   (404/410 from the push service) -> the subscription is deleted
--   failed (transient)                     -> failure_count + 1; deleted only
--                                             after 10 consecutive failures
--   sent                                   -> failure_count reset
-- The inbox row is never touched.
create or replace function public.record_push_results(p_results jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row jsonb;
  v_outcome text;
  v_sub uuid;
begin
  if jsonb_typeof(p_results) <> 'array' then
    return;
  end if;
  for v_row in select value from jsonb_array_elements(p_results) loop
    v_outcome := v_row ->> 'outcome';
    v_sub := nullif(v_row ->> 'subscription_id', '')::uuid;
    if v_outcome = 'sent' then
      update public.push_subscriptions set last_success_at = now(), failure_count = 0 where id = v_sub;
    elsif v_outcome = 'gone' then
      delete from public.push_subscriptions where id = v_sub;
    elsif v_outcome = 'failed' then
      update public.push_subscriptions set last_failure_at = now(), failure_count = failure_count + 1 where id = v_sub;
      delete from public.push_subscriptions where id = v_sub and failure_count >= 10;
    end if;
  end loop;

  update public.push_dispatches d
     set sent_count = r.sent, failed_count = r.failed,
         status = case when r.sent > 0 then 'sent' else 'failed' end, completed_at = now()
    from (
      select (value ->> 'notification_id')::uuid as notification_id,
             count(*) filter (where value ->> 'outcome' = 'sent')::int as sent,
             count(*) filter (where value ->> 'outcome' <> 'sent')::int as failed
      from jsonb_array_elements(p_results) group by 1
    ) r
   where d.notification_id = r.notification_id and d.status = 'claimed';
end $$;

-- Deactivated users stop receiving pushes at once (eligibility also checks).
create or replace function private.remove_push_subscriptions_on_deactivate()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.is_active and not new.is_active then
    delete from public.push_subscriptions where user_id = new.id;
  end if;
  return null;
end $$;

create trigger profiles_remove_push_on_deactivate
  after update of is_active on public.profiles
  for each row execute function private.remove_push_subscriptions_on_deactivate();

-- ---------------------------------------------------------------------------
-- RLS and privileges. No policies for clients: endpoints and keys are never
-- readable by anon/authenticated; the functions above are the only access.
-- ---------------------------------------------------------------------------
alter table public.push_subscriptions enable row level security;
alter table public.user_notification_settings enable row level security;
alter table public.push_dispatches enable row level security;

revoke all on public.push_subscriptions, public.user_notification_settings, public.push_dispatches from anon, authenticated;
grant all on public.push_subscriptions, public.user_notification_settings, public.push_dispatches to service_role;

-- Push level changes are recorded in the audit log (subscriptions are not: not financial).
create trigger user_notification_settings_audit after insert or update on public.user_notification_settings
  for each row execute function private.audit_row_change('notification_settings');

revoke all on function private.push_eligible(public.user_notifications, public.push_level) from public, anon, authenticated;
revoke all on function private.require_active_user() from public, anon, authenticated;
revoke all on function private.remove_push_subscriptions_on_deactivate() from public, anon, authenticated;

revoke all on function public.save_push_subscription(text, text, text, text) from public, anon, authenticated;
revoke all on function public.delete_my_push_subscription(text) from public, anon, authenticated;
revoke all on function public.delete_my_push_device(uuid) from public, anon, authenticated;
revoke all on function public.my_push_status(text) from public, anon, authenticated;
revoke all on function public.set_my_push_level(public.push_level) from public, anon, authenticated;
revoke all on function public.claim_push_batch(int, int) from public, anon, authenticated;
revoke all on function public.record_push_results(jsonb) from public, anon, authenticated;

grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.delete_my_push_subscription(text) to authenticated;
grant execute on function public.delete_my_push_device(uuid) to authenticated;
grant execute on function public.my_push_status(text) to authenticated;
grant execute on function public.set_my_push_level(public.push_level) to authenticated;
grant execute on function public.claim_push_batch(int, int) to service_role;
grant execute on function public.record_push_results(jsonb) to service_role;
