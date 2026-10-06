-- =============================================================================
-- Migration 0200: configurable categories, departments, cost centers,
-- request types, and Sunday (service) reporting.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Categories: one table for attendance / finance / requisition (expense)
-- categories, one level of subcategories via parent_id.
-- Never deleted once referenced (FKs are ON DELETE RESTRICT); archive instead.
-- ---------------------------------------------------------------------------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  type public.category_type not null,
  parent_id uuid,
  name text not null check (length(btrim(name)) between 1 and 80),
  description text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  allows_negative boolean not null default false,  -- finance adjustments only
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, type),
  foreign key (parent_id, type) references public.categories (id, type) on delete restrict
);
create unique index categories_unique_name
  on public.categories (type, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)));
create index categories_type_idx on public.categories (type, is_active, sort_order);
create trigger categories_touch before update on public.categories
  for each row execute function private.touch_updated_at();
create trigger categories_audit after insert or update on public.categories
  for each row execute function private.audit_row_change('category');

-- Only one level of nesting; negatives only for finance categories.
create or replace function private.validate_category()
returns trigger language plpgsql as $$
begin
  if new.parent_id is not null and exists (
    select 1 from public.categories where id = new.parent_id and parent_id is not null
  ) then
    raise exception 'Subcategories cannot have their own subcategories' using errcode = '23514';
  end if;
  if new.allows_negative and new.type <> 'finance' then
    raise exception 'Only finance categories can allow negative adjustments' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger categories_validate before insert or update on public.categories
  for each row execute function private.validate_category();

-- ---------------------------------------------------------------------------
-- Departments & subcategories
-- ---------------------------------------------------------------------------
create table public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  description text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index departments_name_key on public.departments (lower(btrim(name)));
create trigger departments_touch before update on public.departments
  for each row execute function private.touch_updated_at();
create trigger departments_audit after insert or update on public.departments
  for each row execute function private.audit_row_change('department');

create table public.department_subcategories (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 80),
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, department_id)
);
create unique index department_subcategories_name_key
  on public.department_subcategories (department_id, lower(btrim(name)));
create trigger department_subcategories_touch before update on public.department_subcategories
  for each row execute function private.touch_updated_at();
create trigger department_subcategories_audit after insert or update on public.department_subcategories
  for each row execute function private.audit_row_change('department_subcategory');

-- ---------------------------------------------------------------------------
-- Cost centers / budget lines (Accounting/Budget category type)
-- ---------------------------------------------------------------------------
create table public.cost_centers (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$'),
  name text not null check (length(btrim(name)) between 1 and 80),
  department_id uuid references public.departments (id) on delete restrict,
  description text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index cost_centers_code_key on public.cost_centers (upper(code));
create trigger cost_centers_touch before update on public.cost_centers
  for each row execute function private.touch_updated_at();
create trigger cost_centers_audit after insert or update on public.cost_centers
  for each row execute function private.audit_row_change('cost_center');

-- ---------------------------------------------------------------------------
-- Request types: data-driven rules per type
-- ---------------------------------------------------------------------------
create table public.request_types (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  name text not null,
  description text,
  workflow public.workflow_kind not null,
  is_default boolean not null default false,
  is_active boolean not null default true,
  sort_order int not null default 0,
  -- Submission rules
  requires_receipt_on_submission boolean not null default false,
  requires_purchase_details boolean not null default false,  -- actual amount, vendor, purchase date
  requires_cost_center boolean not null default false,
  max_total numeric(14,2) check (max_total is null or max_total > 0),
  -- Post-approval rules
  issues_purchase_order boolean not null default false,
  allows_vendor_orders boolean not null default false,
  requires_disbursement boolean not null default false,
  help_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index request_types_single_default on public.request_types (is_default) where is_default;
create trigger request_types_touch before update on public.request_types
  for each row execute function private.touch_updated_at();
create trigger request_types_audit after insert or update on public.request_types
  for each row execute function private.audit_row_change('request_type');

-- ---------------------------------------------------------------------------
-- Service dates (Sundays and, later, additional services)
-- ---------------------------------------------------------------------------
create table public.service_dates (
  id uuid primary key default gen_random_uuid(),
  service_date date not null,
  service_name text not null default 'Sunday Service' check (length(btrim(service_name)) between 1 and 80),
  notes text,
  is_demo boolean not null default false,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (service_date, service_name)
);
create index service_dates_date_idx on public.service_dates (service_date desc);
create trigger service_dates_touch before update on public.service_dates
  for each row execute function private.touch_updated_at();

create table public.attendance_entries (
  id uuid primary key default gen_random_uuid(),
  service_date_id uuid not null references public.service_dates (id) on delete cascade,
  category_id uuid not null,
  category_type public.category_type not null default 'attendance' check (category_type = 'attendance'),
  count int not null check (count >= 0 and count <= 1000000),
  entered_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (category_id, category_type) references public.categories (id, type) on delete restrict,
  unique (service_date_id, category_id)
);
create index attendance_entries_category_idx on public.attendance_entries (category_id);
create trigger attendance_entries_touch before update on public.attendance_entries
  for each row execute function private.touch_updated_at();
create trigger attendance_entries_audit after insert or update or delete on public.attendance_entries
  for each row execute function private.audit_row_change('attendance_entry');

create table public.finance_entries (
  id uuid primary key default gen_random_uuid(),
  service_date_id uuid not null references public.service_dates (id) on delete restrict,
  category_id uuid not null,
  category_type public.category_type not null default 'finance' check (category_type = 'finance'),
  subcategory_id uuid,
  amount numeric(14,2) not null check (amount between -100000000 and 100000000),
  notes text check (notes is null or length(notes) <= 1000),
  entered_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),
  voided_at timestamptz,
  voided_by uuid references public.profiles (id),
  void_reason text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (category_id, category_type) references public.categories (id, type) on delete restrict,
  foreign key (subcategory_id) references public.categories (id) on delete restrict,
  check ((voided_at is null) = (void_reason is null))
);
create unique index finance_entries_active_unique
  on public.finance_entries (service_date_id, category_id, coalesce(subcategory_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where voided_at is null;
create index finance_entries_service_idx on public.finance_entries (service_date_id);
create trigger finance_entries_touch before update on public.finance_entries
  for each row execute function private.touch_updated_at();
create trigger finance_entries_audit after insert or update or delete on public.finance_entries
  for each row execute function private.audit_row_change('finance_entry');

-- Subcategory must belong to the category; negatives only where allowed.
create or replace function private.validate_finance_entry()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_allows_negative boolean;
begin
  if new.subcategory_id is not null and not exists (
    select 1 from public.categories where id = new.subcategory_id and parent_id = new.category_id
  ) then
    raise exception 'Subcategory does not belong to the selected finance category' using errcode = '23514';
  end if;
  if new.amount < 0 then
    select bool_or(allows_negative) into v_allows_negative
    from public.categories where id in (new.category_id, new.subcategory_id);
    if not coalesce(v_allows_negative, false) then
      raise exception 'Negative amounts are only allowed for adjustment categories' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger finance_entries_validate before insert or update on public.finance_entries
  for each row execute function private.validate_finance_entry();
