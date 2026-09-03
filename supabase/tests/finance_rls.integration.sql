-- Local-only authenticated-role integration evidence for the finance migration.
-- This script changes nothing permanently: all setup, including the temporary
-- owner override required by the sanitized baseline, is rolled back at the end.
begin;

create or replace function public.is_owner()
returns boolean
language sql
stable
set search_path = ''
as $$
  select auth.uid() = '11111111-1111-1111-1111-111111111111'::uuid;
$$;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'owner@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'other@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.gmail_connections (
  id, user_id, gmail_address, access_token_encrypted, refresh_token_encrypted
)
values (
  '33333333-3333-3333-3333-333333333333',
  '11111111-1111-1111-1111-111111111111',
  'owner@example.test', 'test-access-token', 'test-refresh-token'
);

insert into public.gmail_connection_statuses (
  connection_id, user_id, gmail_address, status
)
values (
  '33333333-3333-3333-3333-333333333333',
  '11111111-1111-1111-1111-111111111111',
  'owner@example.test', 'active'
);

-- These rows model invoices persisted before the archive-integrity trigger
-- existed. New non-draft inserts remain covered by the rejection below.
insert into public.clients (id, name)
values ('44444444-4444-4444-4444-444444444444', 'Legacy invoice client');
alter table public.invoices disable trigger invoices_enforce_pdf_archive;
insert into public.invoices (
  id, invoice_number, date, client_id, client_name, due_date, status
) values
  ('55555555-5555-5555-5555-555555555555', 'LEGACY-PENDING', '2025-01-01',
   '44444444-4444-4444-4444-444444444444', 'Legacy invoice client', '2025-01-15', 'pending'),
  ('66666666-6666-6666-6666-666666666666', 'LEGACY-OVERDUE', '2025-02-01',
   '44444444-4444-4444-4444-444444444444', 'Legacy invoice client', '2025-02-15', 'overdue');
alter table public.invoices enable trigger invoices_enforce_pdf_archive;

-- Storage's guard normally rejects direct SQL deletion in favor of the Storage
-- API. This transaction-local setting is the guard's API path and lets this
-- rollback-only script exercise the underlying RLS decisions without changing
-- any trigger.

insert into storage.objects (bucket_id, name, owner_id)
values
  (
    'issued-invoices',
    '22222222-2222-2222-2222-222222222222/77777777-7777-7777-7777-777777777777/ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff.pdf',
    '22222222-2222-2222-2222-222222222222'
  ),
  (
    'tax-exports',
    '11111111-1111-1111-1111-111111111111/tax-export.zip',
    '11111111-1111-1111-1111-111111111111'
  );

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('storage.allow_delete_query', 'true', true);

do $$
declare
  review_expense_id uuid;
  booked_expense_id uuid;
  document_id uuid;
  affected_rows integer;
  audit_rows integer;
  status_rows integer;
begin
  insert into public.expenses (
    user_id, vendor, category, expense_date, net_amount, vat_amount
  ) values (
    '11111111-1111-1111-1111-111111111111', 'review vendor', 'software', '2026-01-01', 10, 1.9
  ) returning id into review_expense_id;

  delete from public.expenses where id = review_expense_id;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'owner could not delete a needs_review expense';
  end if;

  insert into public.expenses (
    user_id, vendor, vendor_invoice_number, category, description, expense_date,
    paid_date, net_amount, vat_amount, source, notes
  ) values (
    '11111111-1111-1111-1111-111111111111', 'booked vendor', 'INV-1', 'software', 'initial',
    '2026-01-02', '2026-01-03', 20, 3.8, 'upload', 'initial notes'
  ) returning id into booked_expense_id;

  insert into public.expense_documents (
    user_id, expense_id, document_role, storage_path, filename, detected_mime_type, byte_size, sha256
  ) values (
    '11111111-1111-1111-1111-111111111111', booked_expense_id, 'receipt',
    '11111111-1111-1111-1111-111111111111/receipt.jpg', 'receipt.jpg', 'image/jpeg', 1024,
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  ) returning id into document_id;

  update public.expenses set status = 'booked' where id = booked_expense_id;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'booking transition did not succeed';
  end if;

  update public.expense_documents set filename = 'mutated.jpg' where id = document_id;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then
    raise exception 'a booked expense document was mutable';
  end if;

  delete from public.expenses where id = booked_expense_id;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then
    raise exception 'a booked expense was deletable';
  end if;

  update public.expenses set status = 'voided', void_reason = 'duplicate' where id = booked_expense_id;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'voiding transition did not succeed';
  end if;

  update public.expenses set notes = 'mutated after void' where id = booked_expense_id;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then
    raise exception 'a voided expense was mutable';
  end if;

  select count(*) into audit_rows from public.expense_audit_log where expense_id = booked_expense_id;
  if audit_rows <> 2 then
    raise exception 'expected booked and voided audit rows, got %', audit_rows;
  end if;

  select count(*) into status_rows from public.gmail_connection_status;
  if status_rows <> 1 then
    raise exception 'owner could not read the Gmail status view';
  end if;

  begin
    perform 1 from public.gmail_connections;
    raise exception 'token-bearing Gmail table was directly selectable';
  exception
    when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);

  select count(*) into status_rows from public.gmail_connection_status;
  if status_rows <> 0 then
    raise exception 'non-owner could read the Gmail status view';
  end if;

  select count(*) into affected_rows from public.expenses;
  if affected_rows <> 0 then
    raise exception 'non-owner could read expenses';
  end if;

end;
$$;

-- The integrity migration adds transactional review deletion, object mutation
-- gates, and atomic draft-to-pending PDF archival.
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);

do $$
declare
  review_expense_id uuid;
  booked_expense_id uuid;
  review_document_id uuid;
  booked_document_id uuid;
  client_id uuid;
  invoice_id uuid;
  review_path text;
  booked_path text;
  invoice_path text;
  orphan_invoice_path text;
  other_user_invoice_path text;
  tax_export_path text;
  checksum text := 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
  affected_rows integer;
begin
  insert into public.expenses (user_id, vendor, category, expense_date, net_amount, vat_amount)
  values ('11111111-1111-1111-1111-111111111111', 'draft attachment', 'software', '2026-02-01', 10, 1.9)
  returning id into review_expense_id;
  review_path := '11111111-1111-1111-1111-111111111111/' || review_expense_id || '/'
    || 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' || '-receipt.pdf';

  insert into public.expense_documents (
    user_id, expense_id, document_role, storage_path, filename, detected_mime_type, byte_size, sha256
  ) values (
    '11111111-1111-1111-1111-111111111111', review_expense_id, 'invoice', review_path,
    'receipt.pdf', 'application/pdf', 100, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  ) returning id into review_document_id;
  if not public.delete_review_expense(review_expense_id) then
    raise exception 'review expense with attached document was not deleted';
  end if;
  select count(*) into affected_rows from public.expense_documents where id = review_document_id;
  if affected_rows <> 0 then
    raise exception 'review document metadata did not cascade on deletion';
  end if;
  insert into public.expenses (user_id, vendor, category, expense_date, net_amount, vat_amount)
  values ('11111111-1111-1111-1111-111111111111', 'booked immutable', 'software', '2026-02-02', 20, 3.8)
  returning id into booked_expense_id;
  booked_path := '11111111-1111-1111-1111-111111111111/' || booked_expense_id || '/'
    || 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd' || '-receipt.pdf';
  insert into public.expense_documents (
    user_id, expense_id, document_role, storage_path, filename, detected_mime_type, byte_size, sha256
  ) values (
    '11111111-1111-1111-1111-111111111111', booked_expense_id, 'invoice', booked_path,
    'receipt.pdf', 'application/pdf', 100, 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
  ) returning id into booked_document_id;
  insert into storage.objects (bucket_id, name, owner_id)
  values ('expense-documents', booked_path, '11111111-1111-1111-1111-111111111111');
  update public.expenses set status = 'booked' where id = booked_expense_id;

  begin
    update public.invoices set status = 'draft'
    where id = '55555555-5555-5555-5555-555555555555';
    raise exception 'legacy pending invoice transitioned to draft without an archive';
  exception when others then
    if position('legacy invoice status is immutable' in lower(sqlerrm)) = 0 then
      raise;
    end if;
  end;
  begin
    update public.invoices set status = 'pending'
    where id = '66666666-6666-6666-6666-666666666666';
    raise exception 'legacy overdue invoice transitioned back to pending without an archive';
  exception when others then
    if position('legacy invoice status is immutable' in lower(sqlerrm)) = 0 then
      raise;
    end if;
  end;

  update public.invoices
  set status = 'paid', paid_date = '2026-08-31'
  where id in (
    '55555555-5555-5555-5555-555555555555',
    '66666666-6666-6666-6666-666666666666'
  );
  get diagnostics affected_rows = row_count;
  if affected_rows <> 2 then
    raise exception 'legacy pending/overdue invoices could not be marked paid';
  end if;
  select count(*) into affected_rows
  from public.invoices
  where id in (
      '55555555-5555-5555-5555-555555555555',
      '66666666-6666-6666-6666-666666666666'
    )
    and status = 'paid'
    and paid_date = '2026-08-31'
    and pdf_storage_path is null
    and pdf_sha256 is null;
  if affected_rows <> 2 then
    raise exception 'legacy paid transition changed or required archive metadata';
  end if;

  begin
    update public.expenses set notes = 'not allowed' where id = booked_expense_id;
    raise exception 'booked expense edit was allowed';
  exception when others then
    if position('booked expense' in lower(sqlerrm)) = 0 then
      raise;
    end if;
  end;

  update storage.objects set updated_at = now()
  where bucket_id = 'expense-documents' and name = booked_path;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then
    raise exception 'booked receipt object was mutable';
  end if;
  begin
    delete from storage.objects where bucket_id = 'expense-documents' and name = booked_path;
    get diagnostics affected_rows = row_count;
    if affected_rows <> 0 then
      raise exception 'booked receipt object was deletable';
    end if;
  exception when others then
    if position('direct deletion from storage tables' in lower(sqlerrm)) = 0 then
      raise;
    end if;
  end;

  insert into public.clients (name) values ('Archive client') returning id into client_id;
  begin
    insert into public.invoices (
      invoice_number, date, client_id, client_name, due_date, status
    ) values (
      'ARCHIVE-2026-INSERT-REJECTED', '2026-02-03', client_id, 'Archive client', '2026-02-17', 'pending'
    );
    raise exception 'pending invoice without an archive was insertable';
  exception when others then
    if position('new invoices must be drafts' in lower(sqlerrm)) = 0 then
      raise;
    end if;
  end;

  insert into public.invoices (
    invoice_number, date, client_id, client_name, due_date, status
  ) values (
    'ARCHIVE-2026-001', '2026-02-03', client_id, 'Archive client', '2026-02-17', 'draft'
  ) returning id into invoice_id;
  invoice_path := '11111111-1111-1111-1111-111111111111/' || invoice_id || '/' || checksum || '.pdf';
  orphan_invoice_path := '11111111-1111-1111-1111-111111111111/' || invoice_id || '/'
    || 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.pdf';
  other_user_invoice_path := '22222222-2222-2222-2222-222222222222/'
    || '77777777-7777-7777-7777-777777777777/'
    || 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff.pdf';
  tax_export_path := '11111111-1111-1111-1111-111111111111/tax-export.zip';

  insert into storage.objects (bucket_id, name, owner_id)
  values ('issued-invoices', orphan_invoice_path, '11111111-1111-1111-1111-111111111111');
  delete from storage.objects where bucket_id = 'issued-invoices' and name = orphan_invoice_path;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'owner could not remove an unreferenced attempted invoice PDF';
  end if;

  delete from storage.objects where bucket_id = 'issued-invoices' and name = other_user_invoice_path;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then
    raise exception 'owner could remove another user''s invoice PDF';
  end if;

  delete from storage.objects where bucket_id = 'tax-exports' and name = tax_export_path;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then
    raise exception 'tax export object was deletable';
  end if;

  insert into storage.objects (bucket_id, name, owner_id)
  values ('issued-invoices', invoice_path, '11111111-1111-1111-1111-111111111111');

  begin
    update public.invoices set status = 'pending' where id = invoice_id;
    raise exception 'draft invoice issued without archive';
  exception when raise_exception then
    if position('requires an archived pdf' in lower(sqlerrm)) = 0 then
      raise;
    end if;
  end;

  if not public.archive_issued_invoice_pdf(invoice_id, invoice_path, checksum) then
    raise exception 'archive RPC did not atomically issue the invoice';
  end if;
  select count(*) into affected_rows from public.invoices
  where id = invoice_id and status = 'pending' and pdf_storage_path = invoice_path and pdf_sha256 = checksum;
  if affected_rows <> 1 then
    raise exception 'archive RPC did not persist pending status and immutable metadata together';
  end if;
  update storage.objects set updated_at = now() where bucket_id = 'issued-invoices' and name = invoice_path;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then
    raise exception 'issued invoice object was mutable';
  end if;
  delete from storage.objects where bucket_id = 'issued-invoices' and name = invoice_path;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then
    raise exception 'referenced issued invoice object was deletable';
  end if;
end;
$$;

rollback;
