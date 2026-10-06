-- =============================================================================
-- Migration 0300: external form links, requisitions, purchase orders,
-- vendor orders, receipts, reconciliation, disbursements, notifications.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- External requisition form links. Only a SHA-256 hash of the token is stored;
-- the raw token is shown once to the administrator who creates the link.
-- ---------------------------------------------------------------------------
create table public.external_form_tokens (
  id uuid primary key default gen_random_uuid(),
  label text not null check (length(btrim(label)) between 1 and 120),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  token_hint text not null check (length(token_hint) between 4 and 8),
  department_id uuid references public.departments (id) on delete restrict,
  expires_at timestamptz,
  max_submissions int check (max_submissions is null or max_submissions > 0),
  submission_count int not null default 0,
  is_active boolean not null default true,
  last_used_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id)
);
create trigger external_form_tokens_audit after insert or update on public.external_form_tokens
  for each row execute function private.audit_row_change('external_form_token', 'token_hash', 'submission_count', 'last_used_at');

-- ---------------------------------------------------------------------------
-- Requisitions
-- ---------------------------------------------------------------------------
create table public.requisitions (
  id uuid primary key default gen_random_uuid(),
  requisition_number text not null unique check (requisition_number ~ '^TKT-REQ-[0-9]{4}-[0-9]{4,}$'),
  status public.requisition_status not null default 'submitted',
  -- The outcome of finance review (approved / partially_approved). Used to fall
  -- back to when purchasing activity is reversed (e.g. a PO is voided).
  review_outcome public.requisition_status check (review_outcome in ('approved', 'partially_approved')),
  form_token_id uuid references public.external_form_tokens (id) on delete set null,
  request_type_id uuid not null references public.request_types (id) on delete restrict,
  department_id uuid not null references public.departments (id) on delete restrict,
  subcategory_id uuid not null,
  cost_center_id uuid references public.cost_centers (id) on delete restrict,
  expense_category_id uuid references public.categories (id) on delete restrict,
  requester_name text not null check (length(btrim(requester_name)) between 2 and 120),
  requester_email text not null check (requester_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(requester_email) <= 254),
  requester_phone text not null check (requester_phone ~ '^\+?[0-9 ().-]{7,25}$'),
  department_head_name text not null check (length(btrim(department_head_name)) between 2 and 120),
  submitted_at timestamptz not null default now(),
  needed_by date not null,
  budget_status public.budget_status not null,
  budget_explanation text check (budget_explanation is null or length(budget_explanation) <= 2000),
  justification text not null check (length(btrim(justification)) between 20 and 4000),
  certification_accepted boolean not null check (certification_accepted),
  certification_name text not null check (length(btrim(certification_name)) between 2 and 120),
  certified_at timestamptz not null default now(),
  -- Reimbursement-style purchase details (required when the request type says so)
  actual_purchase_amount numeric(14,2) check (actual_purchase_amount is null or actual_purchase_amount >= 0),
  purchase_vendor text check (purchase_vendor is null or length(purchase_vendor) <= 200),
  purchase_date date,
  -- Authoritative totals, always computed in the database
  estimated_total numeric(14,2) not null default 0 check (estimated_total >= 0),
  approved_total numeric(14,2) not null default 0 check (approved_total >= 0),
  actual_total numeric(14,2) not null default 0 check (actual_total >= 0),
  disbursed_total numeric(14,2) not null default 0 check (disbursed_total >= 0),
  assigned_reviewer_id uuid references public.profiles (id) on delete set null,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  review_comment text,
  reply_token text not null unique default private.random_hex(24) check (reply_token ~ '^[0-9a-f]{24}$'),
  status_changed_at timestamptz not null default now(),
  closed_at timestamptz,
  submission_fingerprint text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (subcategory_id, department_id) references public.department_subcategories (id, department_id) on delete restrict,
  check (budget_status = 'yes' or length(btrim(coalesce(budget_explanation, ''))) >= 5)
);
create index requisitions_status_idx on public.requisitions (status);
create index requisitions_department_idx on public.requisitions (department_id);
create index requisitions_submitted_idx on public.requisitions (submitted_at desc);
create index requisitions_type_idx on public.requisitions (request_type_id);
create index requisitions_email_idx on public.requisitions (lower(requester_email));
create trigger requisitions_touch before update on public.requisitions
  for each row execute function private.touch_updated_at();

create table public.requisition_items (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references public.requisitions (id) on delete cascade,
  line_number int not null check (line_number between 1 and 100),
  description text not null check (length(btrim(description)) between 2 and 300),
  specifications text check (specifications is null or length(specifications) <= 2000),
  color text check (color is null or length(color) <= 60),
  size text check (size is null or length(size) <= 60),
  quantity numeric(12,2) not null check (quantity > 0 and quantity <= 100000),
  estimated_unit_price numeric(14,2) not null check (estimated_unit_price >= 0 and estimated_unit_price <= 10000000),
  estimated_total numeric(14,2) not null check (estimated_total >= 0),
  vendor_name text check (vendor_name is null or length(vendor_name) <= 200),
  vendor_url text check (vendor_url is null or (length(vendor_url) <= 2000 and vendor_url ~* '^https?://')),
  notes text check (notes is null or length(notes) <= 2000),
  review_status public.item_review_status not null default 'pending',
  approved_quantity numeric(12,2) check (approved_quantity is null or approved_quantity >= 0),
  approved_unit_price numeric(14,2) check (approved_unit_price is null or approved_unit_price >= 0),
  approved_total numeric(14,2) not null default 0 check (approved_total >= 0),
  review_comment text,
  -- Derived caches (maintained by private.refresh_requisition_progress)
  po_quantity numeric(12,2) not null default 0,
  ordered_quantity numeric(12,2) not null default 0,
  purchased_quantity numeric(12,2) not null default 0,
  actual_total numeric(14,2) not null default 0,
  cancelled_quantity numeric(12,2) not null default 0 check (cancelled_quantity >= 0),
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (requisition_id, line_number),
  unique (id, requisition_id),
  check (estimated_total = round(quantity * estimated_unit_price, 2)),
  check (approved_quantity is null or approved_quantity <= quantity),
  check (review_status <> 'approved' or (approved_quantity > 0 and approved_unit_price is not null))
);
create index requisition_items_requisition_idx on public.requisition_items (requisition_id);
create trigger requisition_items_touch before update on public.requisition_items
  for each row execute function private.touch_updated_at();

create table public.requisition_status_history (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references public.requisitions (id) on delete cascade,
  from_status public.requisition_status,
  to_status public.requisition_status not null,
  changed_by uuid references public.profiles (id) on delete set null,
  changed_by_label text,
  comment text,
  created_at timestamptz not null default now()
);
create index requisition_status_history_req_idx on public.requisition_status_history (requisition_id, created_at);

create table public.requisition_comments (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references public.requisitions (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index requisition_comments_req_idx on public.requisition_comments (requisition_id, created_at);

-- ---------------------------------------------------------------------------
-- Purchase orders
-- ---------------------------------------------------------------------------
create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_number text not null unique check (po_number ~ '^TKT-PO-[0-9]{4}-[0-9]{4,}$'),
  requisition_id uuid not null references public.requisitions (id) on delete restrict,
  status public.po_status not null default 'issued',
  vendor_name text check (vendor_name is null or length(vendor_name) <= 200),
  vendor_contact text check (vendor_contact is null or length(vendor_contact) <= 200),
  vendor_email text check (vendor_email is null or vendor_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  vendor_phone text check (vendor_phone is null or length(vendor_phone) <= 40),
  vendor_address text check (vendor_address is null or length(vendor_address) <= 500),
  vendor_url text check (vendor_url is null or vendor_url ~* '^https?://'),
  notes text check (notes is null or length(notes) <= 2000),
  total numeric(14,2) not null default 0 check (total >= 0),
  issued_at timestamptz not null default now(),
  issued_by uuid references public.profiles (id) on delete set null,
  pdf_path text,
  pdf_generated_at timestamptz,
  reply_token text not null unique default private.random_hex(24) check (reply_token ~ '^[0-9a-f]{24}$'),
  voided_at timestamptz,
  voided_by uuid references public.profiles (id) on delete set null,
  void_reason text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  check ((status = 'void') = (voided_at is not null))
);
create index purchase_orders_requisition_idx on public.purchase_orders (requisition_id);

create table public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders (id) on delete cascade,
  requisition_item_id uuid not null references public.requisition_items (id) on delete restrict,
  line_number int not null,
  description text not null,
  quantity numeric(12,2) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  line_total numeric(14,2) not null check (line_total = round(quantity * unit_price, 2)),
  unique (purchase_order_id, line_number),
  unique (purchase_order_id, requisition_item_id)
);
create index purchase_order_items_item_idx on public.purchase_order_items (requisition_item_id);

-- ---------------------------------------------------------------------------
-- Vendor orders (a requisition may have many; partial ordering supported)
-- ---------------------------------------------------------------------------
create table public.vendor_orders (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references public.requisitions (id) on delete restrict,
  purchase_order_id uuid references public.purchase_orders (id) on delete restrict,
  status public.vendor_order_status not null default 'placed',
  vendor_name text not null check (length(btrim(vendor_name)) between 1 and 200),
  vendor_reference text check (vendor_reference is null or length(vendor_reference) <= 120),
  order_date date not null,
  expected_delivery_date date,
  notes text check (notes is null or length(notes) <= 2000),
  total numeric(14,2) not null default 0 check (total >= 0),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id) on delete set null,
  cancel_reason text,
  is_demo boolean not null default false,
  check (expected_delivery_date is null or expected_delivery_date >= order_date)
);
create index vendor_orders_requisition_idx on public.vendor_orders (requisition_id);

create table public.vendor_order_items (
  id uuid primary key default gen_random_uuid(),
  vendor_order_id uuid not null references public.vendor_orders (id) on delete cascade,
  requisition_item_id uuid not null references public.requisition_items (id) on delete restrict,
  quantity numeric(12,2) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  line_total numeric(14,2) not null check (line_total = round(quantity * unit_price, 2)),
  unique (vendor_order_id, requisition_item_id)
);
create index vendor_order_items_item_idx on public.vendor_order_items (requisition_item_id);

-- ---------------------------------------------------------------------------
-- Inbound email log (idempotency key = provider + provider_message_id)
-- ---------------------------------------------------------------------------
create table public.inbound_emails (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_message_id text not null,
  message_id_header text,
  from_address text,
  to_addresses text[] not null default '{}',
  subject text,
  text_excerpt text,
  received_at timestamptz not null default now(),
  status public.inbound_email_status not null,
  match_method text,
  matched_requisition_id uuid references public.requisitions (id) on delete set null,
  matched_purchase_order_id uuid references public.purchase_orders (id) on delete set null,
  attachment_count int not null default 0,
  error text,
  processed_at timestamptz,
  unique (provider, provider_message_id)
);

-- ---------------------------------------------------------------------------
-- Receipts, files, and reconciliation allocations
-- ---------------------------------------------------------------------------
create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid references public.requisitions (id) on delete restrict,
  purchase_order_id uuid references public.purchase_orders (id) on delete restrict,
  source public.receipt_source not null,
  status public.receipt_status not null default 'pending',
  vendor_name text check (vendor_name is null or length(vendor_name) <= 200),
  purchase_date date,
  total_amount numeric(14,2) check (total_amount is null or total_amount >= 0),
  reference text check (reference is null or length(reference) <= 200),
  notes text check (notes is null or length(notes) <= 2000),
  inbound_email_id uuid references public.inbound_emails (id) on delete set null,
  submitted_by_label text,
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  reconciled_at timestamptz,
  reconciled_by uuid references public.profiles (id) on delete set null,
  reconciliation_notes text,
  rejected_reason text,
  is_demo boolean not null default false,
  check (status in ('unmatched', 'rejected') or requisition_id is not null)
);
create index receipts_requisition_idx on public.receipts (requisition_id);
create index receipts_status_idx on public.receipts (status);

create table public.receipt_files (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.receipts (id) on delete cascade,
  storage_bucket text not null default 'receipts',
  storage_path text not null,
  original_filename text not null check (length(original_filename) <= 255),
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  created_at timestamptz not null default now(),
  unique (storage_bucket, storage_path)
);
create index receipt_files_receipt_idx on public.receipt_files (receipt_id);

create table public.receipt_item_allocations (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.receipts (id) on delete cascade,
  requisition_item_id uuid not null references public.requisition_items (id) on delete restrict,
  purchase_order_item_id uuid references public.purchase_order_items (id) on delete restrict,
  quantity numeric(12,2) not null check (quantity > 0),
  actual_amount numeric(14,2) not null check (actual_amount >= 0),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (receipt_id, requisition_item_id)
);
create index receipt_item_allocations_item_idx on public.receipt_item_allocations (requisition_item_id);

-- ---------------------------------------------------------------------------
-- Disbursements (reimbursement payments, petty cash, advance checks)
-- ---------------------------------------------------------------------------
create table public.disbursements (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references public.requisitions (id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  method public.disbursement_method not null,
  paid_on date not null,
  reference text check (reference is null or length(reference) <= 120),
  notes text check (notes is null or length(notes) <= 2000),
  recorded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  is_demo boolean not null default false
);
create index disbursements_requisition_idx on public.disbursements (requisition_id);

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
create table public.notification_preferences (
  requisition_id uuid primary key references public.requisitions (id) on delete cascade,
  email text not null,
  phone text,
  email_opt_in boolean not null default true,
  sms_opt_in boolean not null default false,
  sms_consent_at timestamptz,
  manage_token text not null unique default private.random_hex(48),
  updated_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid references public.requisitions (id) on delete set null,
  channel public.notification_channel not null,
  template text not null,
  recipient text not null,
  subject text,
  status public.notification_status not null,
  provider_message_id text,
  error text,
  created_at timestamptz not null default now()
);
create index notifications_requisition_idx on public.notifications (requisition_id, created_at);
