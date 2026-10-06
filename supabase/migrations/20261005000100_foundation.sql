-- =============================================================================
-- The Kings Tribe — Finance & Operations
-- Migration 0100: foundation (settings, identity, RBAC, audit, numbering, rate limits)
-- =============================================================================
-- Conventions
--   * UUID primary keys everywhere; human-readable numbers are separate columns.
--   * Money: numeric(14,2). Quantities: numeric(12,2). Never float.
--   * Internal helper functions live in schema `private` (not exposed by the API).
--   * Every table has RLS enabled (see migration 0600). The `anon` role gets no
--     table privileges at all.
-- =============================================================================

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------
create type public.category_type as enum ('attendance', 'finance', 'requisition');

create type public.requisition_status as enum (
  'submitted', 'under_review', 'on_hold', 'approved', 'partially_approved',
  'rejected', 'po_issued', 'ordered', 'partially_purchased', 'purchased', 'closed'
);

create type public.item_review_status as enum ('pending', 'approved', 'held', 'rejected');
create type public.budget_status as enum ('yes', 'no', 'unsure');

-- How a request type behaves after approval. New request types pick one of these.
create type public.workflow_kind as enum (
  'church_order',     -- Finance purchases on the department's behalf (Order)
  'purchase_order',   -- Requester purchases with a church-issued PO (Direct Purchase / PO)
  'reimbursement',    -- Already purchased; requester is repaid
  'petty_cash',       -- Small cash disbursement, receipts afterwards
  'advance_check'     -- Funds/check issued before the expense, receipts afterwards
);

create type public.po_status as enum ('issued', 'void');
create type public.vendor_order_status as enum ('placed', 'cancelled');
create type public.receipt_source as enum ('upload', 'email', 'submission');
create type public.receipt_status as enum ('pending', 'reconciled', 'rejected', 'unmatched');
create type public.disbursement_method as enum ('cash', 'check', 'bank_transfer', 'other');
create type public.notification_channel as enum ('email', 'sms');
create type public.notification_status as enum ('sent', 'failed', 'skipped');
create type public.inbound_email_status as enum ('matched', 'unmatched', 'ignored', 'error');

-- ---------------------------------------------------------------------------
-- Random hex tokens (two v4 UUIDs = 244 random bits, hashed, truncated)
-- ---------------------------------------------------------------------------
create or replace function private.random_hex(p_length int)
returns text language sql volatile as $$
  select substr(encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text, 'UTF8')), 'hex'), 1, p_length)
$$;

-- ---------------------------------------------------------------------------
-- Generic updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function private.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Church settings (singleton). Church details are NEVER hard-coded in the app.
-- ---------------------------------------------------------------------------
create table public.church_settings (
  id smallint primary key default 1 check (id = 1),
  church_name text not null default 'The Kings Tribe',
  address_line1 text,
  address_line2 text,
  city text,
  region text,
  postal_code text,
  country text,
  phone text,
  email text,
  website text,
  currency_code char(3) not null default 'USD' check (currency_code ~ '^[A-Z]{3}$'),
  timezone text not null default 'America/New_York',
  finance_notification_email text,
  requisition_policy text not null default
    'Submit purchase requests 3–7 days before funds/items are needed whenever practical. Itemized receipts must be submitted for completed purchases.',
  po_instructions text not null default
    'Present this Purchase Order to the vendor. Retain the itemized receipt or invoice for every purchase and reply to the Purchase Order email with a photo or PDF of each receipt.',
  po_footer text not null default
    'This Purchase Order authorizes only the items, quantities and amounts listed. Itemized receipts are required for all purchases. Questions: contact the Finance team.',
  setup_completed_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create trigger church_settings_touch before update on public.church_settings
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Identity & RBAC
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_email_key on public.profiles (lower(email));
create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  name text not null,
  description text,
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.permissions (
  key text primary key check (key ~ '^[a-z_]+\.[a-z_]+$'),
  group_name text not null,
  description text not null
);

create table public.role_permissions (
  role_id uuid not null references public.roles (id) on delete cascade,
  permission_key text not null references public.permissions (key) on delete cascade,
  primary key (role_id, permission_key)
);

create table public.user_roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role_id uuid not null references public.roles (id) on delete restrict,
  granted_by uuid references public.profiles (id),
  granted_at timestamptz not null default now(),
  primary key (user_id, role_id)
);
create index user_roles_role_idx on public.user_roles (role_id);

-- Create a profile automatically for every new auth user (invited users).
create or replace function private.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_auth_user();

-- Current user id, robust to both Supabase claim styles.
create or replace function private.current_user_id()
returns uuid language sql stable as $$
  select auth.uid()
$$;

-- Is the caller an active internal user?
create or replace function private.is_internal_user()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active
  )
$$;

-- Permission check used by RLS policies and every privileged function.
-- Administrators implicitly hold every permission (including ones added later).
create or replace function private.has_permission(p_permission text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.profiles p
    join public.user_roles ur on ur.user_id = p.id
    join public.roles r on r.id = ur.role_id
    left join public.role_permissions rp on rp.role_id = r.id and rp.permission_key = p_permission
    where p.id = auth.uid()
      and p.is_active
      and (r.key = 'administrator' or rp.permission_key is not null)
  )
$$;

create or replace function private.require_permission(p_permission text)
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not private.has_permission(p_permission) then
    raise exception 'permission denied: %', p_permission using errcode = '42501';
  end if;
end $$;

-- Public wrapper so the UI can learn what the signed-in user may do.
create or replace function public.my_permissions()
returns text[] language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(distinct pk order by pk), '{}')
  from (
    select perm.key as pk
    from public.profiles p
    join public.user_roles ur on ur.user_id = p.id
    join public.roles r on r.id = ur.role_id
    cross join public.permissions perm
    left join public.role_permissions rp on rp.role_id = r.id and rp.permission_key = perm.key
    where p.id = auth.uid() and p.is_active
      and (r.key = 'administrator' or rp.permission_key is not null)
  ) s
$$;

-- Never allow the last active administrator to be removed.
create or replace function private.protect_last_admin()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_admin_role uuid;
  v_remaining int;
begin
  select id into v_admin_role from public.roles where key = 'administrator';
  if tg_op = 'DELETE' and old.role_id = v_admin_role then
    select count(*) into v_remaining
    from public.user_roles ur join public.profiles p on p.id = ur.user_id
    where ur.role_id = v_admin_role and p.is_active and ur.user_id <> old.user_id;
    if v_remaining = 0 then
      raise exception 'Cannot remove the last active administrator' using errcode = 'P0001';
    end if;
  end if;
  return coalesce(old, new);
end $$;

create trigger user_roles_protect_last_admin before delete on public.user_roles
  for each row execute function private.protect_last_admin();

create or replace function private.protect_last_admin_profile()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_admin_role uuid;
  v_remaining int;
begin
  if old.is_active and not new.is_active then
    select id into v_admin_role from public.roles where key = 'administrator';
    if exists (select 1 from public.user_roles where user_id = old.id and role_id = v_admin_role) then
      select count(*) into v_remaining
      from public.user_roles ur join public.profiles p on p.id = ur.user_id
      where ur.role_id = v_admin_role and p.is_active and ur.user_id <> old.id;
      if v_remaining = 0 then
        raise exception 'Cannot deactivate the last active administrator' using errcode = 'P0001';
      end if;
    end if;
  end if;
  return new;
end $$;

create trigger profiles_protect_last_admin before update of is_active on public.profiles
  for each row execute function private.protect_last_admin_profile();

-- ---------------------------------------------------------------------------
-- Audit log (append-only)
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  actor_label text,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  requisition_id uuid,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb
);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index audit_logs_requisition_idx on public.audit_logs (requisition_id, occurred_at);
create index audit_logs_occurred_idx on public.audit_logs (occurred_at desc);

create or replace function private.audit_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_logs are append-only' using errcode = '42501';
end $$;

create trigger audit_logs_no_update before update or delete on public.audit_logs
  for each row execute function private.audit_immutable();

-- Who is acting? Internal user (auth.uid) or a labelled system/external actor
-- set by trusted server code via `set_config('app.actor_label', ...)`.
create or replace function private.actor_label()
returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('app.actor_label', true), ''),
    case when auth.uid() is null then 'system' else null end
  )
$$;

create or replace function private.write_audit(
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_requisition_id uuid default null,
  p_before jsonb default null,
  p_after jsonb default null,
  p_metadata jsonb default '{}'::jsonb
) returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.audit_logs (actor_id, actor_label, action, entity_type, entity_id,
                                 requisition_id, before_data, after_data, metadata)
  values (auth.uid(), private.actor_label(), p_action, p_entity_type, p_entity_id,
          p_requisition_id, p_before, p_after, coalesce(p_metadata, '{}'::jsonb))
$$;

-- Generic row-change audit trigger for configuration & financial tables.
-- TG_ARGV[0] = entity type label. Columns listed in TG_ARGV[1..] are redacted.
create or replace function private.audit_row_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_id uuid;
  v_req uuid;
  i int;
begin
  if tg_op <> 'INSERT' then v_before := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_after := to_jsonb(new); end if;
  if tg_nargs > 1 then
    for i in 1 .. tg_nargs - 1 loop
      v_before := v_before - tg_argv[i];
      v_after := v_after - tg_argv[i];
    end loop;
  end if;
  if tg_op = 'UPDATE' and v_before = v_after then
    return new;
  end if;
  -- Tables with composite keys (user_roles, role_permissions) have no `id`.
  v_id := coalesce((v_after ->> 'id'), (v_before ->> 'id'))::uuid;
  v_req := nullif(coalesce(v_after ->> 'requisition_id', v_before ->> 'requisition_id'), '')::uuid;
  perform private.write_audit(
    lower(tg_argv[0] || '.' || case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end),
    tg_argv[0], v_id, v_req, v_before, v_after, '{}'::jsonb);
  return coalesce(new, old);
end $$;

create trigger church_settings_audit after update on public.church_settings
  for each row execute function private.audit_row_change('church_settings');
create trigger user_roles_audit after insert or delete on public.user_roles
  for each row execute function private.audit_row_change('user_role');
create trigger role_permissions_audit after insert or delete on public.role_permissions
  for each row execute function private.audit_row_change('role_permission');
create trigger profiles_audit after update of is_active, full_name on public.profiles
  for each row execute function private.audit_row_change('profile');

-- ---------------------------------------------------------------------------
-- Document numbering: TKT-REQ-2026-0001, TKT-PO-2026-0001
-- The UPSERT takes a row lock, so concurrent callers can never get the same value.
-- ---------------------------------------------------------------------------
create table public.document_sequences (
  kind text not null check (kind in ('REQ', 'PO')),
  year int not null,
  last_value int not null default 0,
  primary key (kind, year)
);

create or replace function private.church_today()
returns date language sql stable security definer set search_path = public, pg_temp as $$
  select (now() at time zone coalesce((select timezone from public.church_settings where id = 1), 'UTC'))::date
$$;

create or replace function private.next_document_number(p_kind text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_year int := extract(year from private.church_today())::int;
  v_value int;
begin
  insert into public.document_sequences as s (kind, year, last_value)
  values (p_kind, v_year, 1)
  on conflict (kind, year) do update set last_value = s.last_value + 1
  returning last_value into v_value;
  return format('TKT-%s-%s-%s', p_kind, v_year, lpad(v_value::text, 4, '0'));
end $$;

-- ---------------------------------------------------------------------------
-- Rate limiting (used by the public requisition form)
-- ---------------------------------------------------------------------------
create table public.rate_limit_events (
  id bigint generated always as identity primary key,
  bucket text not null,
  created_at timestamptz not null default now()
);
create index rate_limit_events_bucket_idx on public.rate_limit_events (bucket, created_at);

-- Returns true if the call is allowed (and records it), false if the limit is hit.
create or replace function private.check_rate_limit(p_bucket text, p_max int, p_window interval)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_count int;
begin
  delete from public.rate_limit_events where created_at < now() - interval '1 day';
  select count(*) into v_count from public.rate_limit_events
  where bucket = p_bucket and created_at > now() - p_window;
  if v_count >= p_max then
    return false;
  end if;
  insert into public.rate_limit_events (bucket) values (p_bucket);
  return true;
end $$;
