-- =============================================================================
-- Migration 0700: reference data (initial configuration).
-- These are INITIAL database values, editable in the app. Nothing here is a
-- hard-coded limitation. Demo/fictional data lives separately in supabase/demo/.
-- =============================================================================

insert into public.church_settings (id) values (1) on conflict (id) do nothing;

-- Permissions -----------------------------------------------------------------
insert into public.permissions (key, group_name, description) values
  ('dashboard.view',        'Dashboard',    'View the dashboard'),
  ('attendance.view',       'Sunday',       'View attendance figures'),
  ('attendance.enter',      'Sunday',       'Enter and edit attendance'),
  ('finance.view',          'Sunday',       'View finance received'),
  ('finance.enter',         'Sunday',       'Enter and edit finance received'),
  ('finance.void',          'Sunday',       'Void finance entries'),
  ('requisitions.view',     'Requisitions', 'View requisitions, purchase orders and receipts'),
  ('requisitions.review',   'Requisitions', 'Review, approve, hold, reject and close requisitions'),
  ('purchase_orders.issue', 'Purchasing',   'Issue and void Purchase Orders'),
  ('orders.record',         'Purchasing',   'Record vendor orders'),
  ('receipts.upload',       'Purchasing',   'Upload receipts'),
  ('receipts.reconcile',    'Purchasing',   'Reconcile receipts against approved lines'),
  ('disbursements.record',  'Purchasing',   'Record reimbursements, petty cash and advance checks'),
  ('reports.view',          'Reports',      'View reports and export CSV'),
  ('categories.manage',     'Settings',     'Manage attendance, finance and expense categories and cost centers'),
  ('departments.manage',    'Settings',     'Manage departments and subcategories'),
  ('request_types.manage',  'Settings',     'Manage request types'),
  ('form_links.manage',     'Settings',     'Create and revoke external requisition form links'),
  ('settings.manage',       'Settings',     'Manage church information and policies'),
  ('users.manage',          'Settings',     'Invite users and manage roles and permissions'),
  ('audit.view',            'Settings',     'View the full audit log')
on conflict (key) do nothing;

-- Roles -----------------------------------------------------------------------
insert into public.roles (key, name, description, is_system) values
  ('administrator',   'Administrator',   'Full system administration', true),
  ('head_of_finance', 'Head of Finance', 'Financial oversight, requisition approval, purchasing and reconciliation', true),
  ('finance_user',    'Finance User',    'Enters Sunday financial data', true),
  ('reporting_user',  'Reporting User',  'Enters attendance and views reports', true),
  ('viewer',          'Viewer',          'Read-only access to permitted dashboards', true)
on conflict (key) do nothing;

-- Administrators implicitly hold every permission (see private.has_permission),
-- but explicit rows keep the permission matrix readable.
insert into public.role_permissions (role_id, permission_key)
select r.id, p.key from public.roles r cross join public.permissions p where r.key = 'administrator'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, p from public.roles r, unnest(array[
  'dashboard.view', 'attendance.view', 'finance.view', 'finance.enter', 'finance.void',
  'requisitions.view', 'requisitions.review', 'purchase_orders.issue', 'orders.record',
  'receipts.upload', 'receipts.reconcile', 'disbursements.record', 'reports.view',
  'categories.manage', 'form_links.manage', 'audit.view'
]) p where r.key = 'head_of_finance'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, p from public.roles r, unnest(array['dashboard.view', 'finance.view', 'finance.enter']) p
where r.key = 'finance_user'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, p from public.roles r, unnest(array['dashboard.view', 'attendance.view', 'attendance.enter', 'reports.view']) p
where r.key = 'reporting_user'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, p from public.roles r, unnest(array['dashboard.view', 'attendance.view']) p
where r.key = 'viewer'
on conflict do nothing;

-- Categories ------------------------------------------------------------------
insert into public.categories (type, name, sort_order, is_system) values
  ('attendance', 'Adult Church', 10, true),
  ('attendance', 'Children''s Church', 20, true),
  ('finance', 'Offering', 10, true),
  ('finance', 'Tithe', 20, true),
  ('finance', 'Church Outreach', 30, true),
  ('requisition', 'Supplies & Consumables', 10, false),
  ('requisition', 'Equipment', 20, false),
  ('requisition', 'Food & Refreshments', 30, false),
  ('requisition', 'Curriculum & Materials', 40, false),
  ('requisition', 'Services & Rentals', 50, false),
  ('requisition', 'Events', 60, false),
  ('requisition', 'Other', 90, false)
on conflict do nothing;

-- Departments -----------------------------------------------------------------
with d as (
  insert into public.departments (name, sort_order) values
    ('Production Team', 10),
    ('Hospitality Team', 20),
    ('Children''s Ministry Team', 30)
  on conflict do nothing
  returning id, name
)
insert into public.department_subcategories (department_id, name, sort_order)
select d.id, s.name, s.ord
from d
join (values
  ('Production Team', 'Audio Production', 10),
  ('Production Team', 'Video Production', 20),
  ('Production Team', 'Live Sound', 30),
  ('Hospitality Team', 'Guest Experience', 10),
  ('Hospitality Team', 'Welcome & Greeters', 20),
  ('Hospitality Team', 'Refreshments & Hospitality', 30),
  ('Hospitality Team', 'Events & Fellowship', 40),
  ('Hospitality Team', 'Facility Presentation', 50),
  ('Hospitality Team', 'Supplies & Consumables', 60),
  ('Children''s Ministry Team', 'Curriculum & Teaching Materials', 10),
  ('Children''s Ministry Team', 'Classroom Supplies', 20),
  ('Children''s Ministry Team', 'Arts & Crafts', 30),
  ('Children''s Ministry Team', 'Children''s Worship', 40),
  ('Children''s Ministry Team', 'Snacks & Refreshments', 50),
  ('Children''s Ministry Team', 'Safety & Check-In', 60),
  ('Children''s Ministry Team', 'Events & Activities', 70),
  ('Children''s Ministry Team', 'Furniture & Equipment', 80)
) as s(dept, name, ord) on s.dept = d.name;

-- Cost centers (starter budget lines — rename or replace to match the church's chart of accounts)
insert into public.cost_centers (code, name, department_id, sort_order)
select v.code, v.name, d.id, v.ord
from (values
  ('PROD', 'Production Ministry', 'Production Team', 10),
  ('HOSP', 'Hospitality Ministry', 'Hospitality Team', 20),
  ('CHILD', 'Children''s Ministry', 'Children''s Ministry Team', 30),
  ('GEN', 'General Operations', null, 90)
) as v(code, name, dept, ord)
left join public.departments d on d.name = v.dept
on conflict do nothing;

-- Request types ---------------------------------------------------------------
insert into public.request_types (key, name, description, workflow, is_default, sort_order,
  requires_receipt_on_submission, requires_purchase_details, issues_purchase_order, allows_vendor_orders,
  requires_disbursement, help_text)
values
  ('order', 'Order',
   'The Finance team purchases the requested items on the department''s behalf.',
   'church_order', true, 10, false, false, true, true, false,
   'Choose this when you want the church to buy the items for your team.'),
  ('direct_purchase', 'Direct Purchase / Purchase Order',
   'The requester makes the approved purchase using a church-issued Purchase Order.',
   'purchase_order', false, 20, false, false, true, false, false,
   'Finance must approve before a Purchase Order is issued. Do not purchase before you receive it.'),
  ('reimbursement', 'Reimbursement',
   'An eligible purchase has already been made and the requester asks to be repaid.',
   'reimbursement', false, 30, true, true, false, false, true,
   'Include the actual amount, vendor, purchase date and an itemized receipt.'),
  ('petty_cash', 'Petty Cash',
   'Small approved cash expenses according to church policy.',
   'petty_cash', false, 40, false, false, false, false, true,
   'Return change and submit itemized receipts after purchasing.'),
  ('advance_check', 'Advance Check',
   'Approved funds or a check are needed before the expense occurs.',
   'advance_check', false, 50, false, false, false, false, true,
   'Submit itemized receipts after the expense and return any unused funds.')
on conflict (key) do nothing;
