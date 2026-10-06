-- =============================================================================
-- Migration 0500: Row Level Security, table privileges, function privileges.
--
-- Model
--   * anon (public internet, external requisition form): NO table access.
--     May execute exactly one function: get_request_form_context(token).
--   * authenticated: SELECT filtered by RLS + permissions. Writes to
--     configuration tables are allowed by RLS for the right permission.
--     Financial / workflow writes ONLY through SECURITY DEFINER functions.
--   * service_role (trusted server code only): used for submit_requisition,
--     ingest_inbound_email, bootstrap and notifications.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'church_settings', 'profiles', 'roles', 'permissions', 'role_permissions', 'user_roles', 'audit_logs',
    'document_sequences', 'rate_limit_events', 'categories', 'departments', 'department_subcategories',
    'cost_centers', 'request_types', 'service_dates', 'attendance_entries', 'finance_entries',
    'external_form_tokens', 'requisitions', 'requisition_items', 'requisition_status_history',
    'requisition_comments', 'purchase_orders', 'purchase_order_items', 'vendor_orders', 'vendor_order_items',
    'inbound_emails', 'receipts', 'receipt_files', 'receipt_item_allocations', 'disbursements',
    'notification_preferences', 'notifications'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges: start from nothing, then grant precisely.
-- (Supabase grants broad defaults to anon/authenticated; revoke them.)
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on schema private from public, anon, authenticated;

-- Future objects must not become accessible by accident.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- RLS policies call private helpers, so authenticated needs EXECUTE on them.
grant usage on schema private to authenticated;
grant execute on function private.has_permission(text) to authenticated;
grant execute on function private.is_internal_user() to authenticated;

-- Read access (rows filtered by policies below)
grant select on
  public.church_settings, public.profiles, public.roles, public.permissions, public.role_permissions,
  public.user_roles, public.audit_logs, public.categories, public.departments, public.department_subcategories,
  public.cost_centers, public.request_types, public.service_dates, public.attendance_entries,
  public.finance_entries, public.external_form_tokens, public.requisitions, public.requisition_items,
  public.requisition_status_history, public.requisition_comments, public.purchase_orders,
  public.purchase_order_items, public.vendor_orders, public.vendor_order_items, public.inbound_emails,
  public.receipts, public.receipt_files, public.receipt_item_allocations, public.disbursements,
  public.notification_preferences, public.notifications
to authenticated;

-- Configuration writes (rows filtered by policies below). No DELETE: archive instead.
grant insert, update on public.categories, public.departments, public.department_subcategories,
  public.cost_centers, public.request_types to authenticated;
grant update on public.church_settings to authenticated;
grant update (full_name, phone, is_active) on public.profiles to authenticated;
grant insert, delete on public.user_roles to authenticated;
grant insert, delete on public.role_permissions to authenticated;
grant insert, update on public.roles to authenticated;
grant insert, update (label, department_id, expires_at, max_submissions, is_active, revoked_at, revoked_by)
  on public.external_form_tokens to authenticated;

-- Function privileges
grant execute on function public.get_request_form_context(text) to anon, authenticated;
grant execute on function public.my_permissions() to authenticated;
grant execute on function public.save_sunday_entry(date, text, jsonb, jsonb, text) to authenticated;
grant execute on function public.void_finance_entry(uuid, text) to authenticated;
grant execute on function public.start_requisition_review(uuid) to authenticated;
grant execute on function public.assign_requisition_reviewer(uuid, uuid) to authenticated;
grant execute on function public.review_requisition(uuid, text, jsonb, text, uuid, uuid) to authenticated;
grant execute on function public.issue_purchase_order(uuid, jsonb, jsonb, text) to authenticated;
grant execute on function public.set_purchase_order_pdf(uuid, text) to authenticated;
grant execute on function public.void_purchase_order(uuid, text) to authenticated;
grant execute on function public.record_vendor_order(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.cancel_vendor_order(uuid, text) to authenticated;
grant execute on function public.register_receipt(uuid, uuid, jsonb, jsonb) to authenticated;
grant execute on function public.assign_receipt(uuid, uuid, uuid) to authenticated;
grant execute on function public.reconcile_receipt(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.reject_receipt(uuid, text) to authenticated;
grant execute on function public.cancel_item_remaining(uuid, text, text) to authenticated;
grant execute on function public.record_disbursement(uuid, text, public.disbursement_method, date, text, text) to authenticated;
grant execute on function public.close_requisition(uuid, text) to authenticated;
grant execute on function public.add_requisition_comment(uuid, text) to authenticated;
grant execute on function public.service_category_totals(date, date) to authenticated;

-- Trusted server code only
grant execute on function public.submit_requisition(text, jsonb, jsonb, text) to service_role;
grant execute on function public.ingest_inbound_email(jsonb, jsonb, jsonb) to service_role;
grant execute on function public.bootstrap_first_administrator(uuid, text) to service_role;
grant execute on function public.administrator_exists() to service_role;
grant all on all tables in schema public to service_role;
grant usage on schema private to service_role;
grant execute on all functions in schema private to service_role;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
-- Settings
create policy church_settings_select on public.church_settings for select to authenticated
  using (private.is_internal_user());
create policy church_settings_update on public.church_settings for update to authenticated
  using (private.has_permission('settings.manage')) with check (private.has_permission('settings.manage'));

-- Identity
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or private.is_internal_user());
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid() or private.has_permission('users.manage'))
  with check (id = auth.uid() or private.has_permission('users.manage'));
-- A user may edit their own name/phone but never their own active flag.
create or replace function private.guard_profile_self_update()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.is_active is distinct from old.is_active and not private.has_permission('users.manage')
     and auth.uid() is not null then
    raise exception 'permission denied: users.manage' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger profiles_guard_self before update on public.profiles
  for each row execute function private.guard_profile_self_update();

create policy roles_select on public.roles for select to authenticated using (private.is_internal_user());
create policy roles_write on public.roles for insert to authenticated with check (private.has_permission('users.manage'));
create policy roles_update on public.roles for update to authenticated
  using (private.has_permission('users.manage')) with check (private.has_permission('users.manage'));
create policy permissions_select on public.permissions for select to authenticated using (private.is_internal_user());
create policy role_permissions_select on public.role_permissions for select to authenticated using (private.is_internal_user());
create policy role_permissions_insert on public.role_permissions for insert to authenticated
  with check (private.has_permission('users.manage'));
create policy role_permissions_delete on public.role_permissions for delete to authenticated
  using (private.has_permission('users.manage'));
create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = auth.uid() or private.has_permission('users.manage') or private.is_internal_user());
create policy user_roles_insert on public.user_roles for insert to authenticated
  with check (private.has_permission('users.manage'));
create policy user_roles_delete on public.user_roles for delete to authenticated
  using (private.has_permission('users.manage'));

-- Audit: full log for auditors; requisition-scoped history for requisition viewers.
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (private.has_permission('audit.view')
         or (requisition_id is not null and private.has_permission('requisitions.view')));

-- Configuration (readable by every internal user; writable by the right manager)
create policy categories_select on public.categories for select to authenticated using (private.is_internal_user());
create policy categories_insert on public.categories for insert to authenticated
  with check (private.has_permission('categories.manage'));
create policy categories_update on public.categories for update to authenticated
  using (private.has_permission('categories.manage')) with check (private.has_permission('categories.manage'));

create policy departments_select on public.departments for select to authenticated using (private.is_internal_user());
create policy departments_insert on public.departments for insert to authenticated
  with check (private.has_permission('departments.manage'));
create policy departments_update on public.departments for update to authenticated
  using (private.has_permission('departments.manage')) with check (private.has_permission('departments.manage'));

create policy department_subcategories_select on public.department_subcategories for select to authenticated
  using (private.is_internal_user());
create policy department_subcategories_insert on public.department_subcategories for insert to authenticated
  with check (private.has_permission('departments.manage'));
create policy department_subcategories_update on public.department_subcategories for update to authenticated
  using (private.has_permission('departments.manage')) with check (private.has_permission('departments.manage'));

create policy cost_centers_select on public.cost_centers for select to authenticated using (private.is_internal_user());
create policy cost_centers_insert on public.cost_centers for insert to authenticated
  with check (private.has_permission('categories.manage'));
create policy cost_centers_update on public.cost_centers for update to authenticated
  using (private.has_permission('categories.manage')) with check (private.has_permission('categories.manage'));

create policy request_types_select on public.request_types for select to authenticated using (private.is_internal_user());
create policy request_types_insert on public.request_types for insert to authenticated
  with check (private.has_permission('request_types.manage'));
create policy request_types_update on public.request_types for update to authenticated
  using (private.has_permission('request_types.manage')) with check (private.has_permission('request_types.manage'));

-- Sunday reporting
create policy service_dates_select on public.service_dates for select to authenticated
  using (private.has_permission('attendance.view') or private.has_permission('finance.view')
         or private.has_permission('attendance.enter') or private.has_permission('finance.enter'));
create policy attendance_entries_select on public.attendance_entries for select to authenticated
  using (private.has_permission('attendance.view') or private.has_permission('attendance.enter'));
create policy finance_entries_select on public.finance_entries for select to authenticated
  using (private.has_permission('finance.view') or private.has_permission('finance.enter'));

-- External form links
create policy external_form_tokens_select on public.external_form_tokens for select to authenticated
  using (private.has_permission('form_links.manage'));
create policy external_form_tokens_insert on public.external_form_tokens for insert to authenticated
  with check (private.has_permission('form_links.manage') and created_by = auth.uid());
create policy external_form_tokens_update on public.external_form_tokens for update to authenticated
  using (private.has_permission('form_links.manage')) with check (private.has_permission('form_links.manage'));

-- Requisition family (read-only for viewers with requisitions.view)
create policy requisitions_select on public.requisitions for select to authenticated
  using (private.has_permission('requisitions.view'));
create policy requisition_items_select on public.requisition_items for select to authenticated
  using (private.has_permission('requisitions.view'));
create policy requisition_status_history_select on public.requisition_status_history for select to authenticated
  using (private.has_permission('requisitions.view'));
create policy requisition_comments_select on public.requisition_comments for select to authenticated
  using (private.has_permission('requisitions.view'));
create policy purchase_orders_select on public.purchase_orders for select to authenticated
  using (private.has_permission('requisitions.view'));
create policy purchase_order_items_select on public.purchase_order_items for select to authenticated
  using (private.has_permission('requisitions.view'));
create policy vendor_orders_select on public.vendor_orders for select to authenticated
  using (private.has_permission('requisitions.view'));
create policy vendor_order_items_select on public.vendor_order_items for select to authenticated
  using (private.has_permission('requisitions.view'));
create policy receipts_select on public.receipts for select to authenticated
  using (private.has_permission('requisitions.view')
         or (status = 'unmatched' and private.has_permission('receipts.reconcile')));
create policy receipt_files_select on public.receipt_files for select to authenticated
  using (private.has_permission('requisitions.view'));
create policy receipt_item_allocations_select on public.receipt_item_allocations for select to authenticated
  using (private.has_permission('requisitions.view'));
create policy disbursements_select on public.disbursements for select to authenticated
  using (private.has_permission('requisitions.view'));
create policy inbound_emails_select on public.inbound_emails for select to authenticated
  using (private.has_permission('receipts.reconcile'));
create policy notification_preferences_select on public.notification_preferences for select to authenticated
  using (private.has_permission('requisitions.view'));
create policy notifications_select on public.notifications for select to authenticated
  using (private.has_permission('requisitions.view'));

-- document_sequences, rate_limit_events: no policies => no access except service_role/definer functions.
