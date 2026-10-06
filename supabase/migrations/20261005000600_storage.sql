-- =============================================================================
-- Migration 0600: private Storage buckets and policies.
-- Both buckets are PRIVATE. Files are only ever served through short-lived
-- signed URLs created by server code after a permission check.
-- Bucket-level limits make Storage itself reject wrong types / oversized files.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('receipts', 'receipts', false, 10485760,
   array['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif']),
  ('purchase-orders', 'purchase-orders', false, 10485760, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Receipts: internal users with requisitions.view may read; uploaders may add
-- files only under requisitions/<requisition-id>/ with an allowed extension.
-- External (requester) uploads and inbound-email attachments are written by
-- trusted server code with the service role under external/ and inbound/.
create policy "receipts: internal read"
  on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and private.has_permission('requisitions.view'));

create policy "receipts: internal upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and private.has_permission('receipts.upload')
    and (storage.foldername(name))[1] = 'requisitions'
    and lower(storage.extension(name)) in ('pdf', 'jpg', 'jpeg', 'png', 'heic', 'heif')
  );

create policy "purchase-orders: internal read"
  on storage.objects for select to authenticated
  using (bucket_id = 'purchase-orders' and private.has_permission('requisitions.view'));

create policy "purchase-orders: issuer upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'purchase-orders'
    and private.has_permission('purchase_orders.issue')
    and lower(storage.extension(name)) = 'pdf'
  );

-- No UPDATE or DELETE policies: stored receipts and Purchase Orders are immutable
-- for application users.
