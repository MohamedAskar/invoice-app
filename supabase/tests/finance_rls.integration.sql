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

-- Export fixtures now pass the same server-only lease gate as real ZIP uploads.
insert into public.tax_export_jobs(id,user_id,tax_year,export_kind,expires_at)
values('99999999-0000-4000-8000-000000000006','11111111-1111-1111-1111-111111111111',2026,'issued_invoices',now()+interval '24 hours');
select public.claim_tax_export_job('99999999-0000-4000-8000-000000000006','11111111-1111-1111-1111-111111111111','99999999-1000-4000-8000-000000000006');
select set_config('request.jwt.claim.role','service_role',true);
insert into storage.objects (bucket_id, name, owner_id)
values
  (
    'issued-invoices',
    '22222222-2222-2222-2222-222222222222/77777777-7777-7777-7777-777777777777/ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff.pdf',
    '22222222-2222-2222-2222-222222222222'
  ),
  (
    'tax-exports',
    '11111111-1111-1111-1111-111111111111/issued_invoices-2026-99999999-0000-4000-8000-000000000006.zip',
    '11111111-1111-1111-1111-111111111111'
  ),
  (
    'expense-documents',
    '22222222-2222-2222-2222-222222222222/88888888-8888-8888-8888-888888888888/other-owner-orphan.pdf',
    '22222222-2222-2222-2222-222222222222'
  );

select public.complete_tax_export_job('99999999-0000-4000-8000-000000000006','11111111-1111-1111-1111-111111111111','99999999-1000-4000-8000-000000000006',repeat('a',64),100);
select set_config('request.jwt.claim.role','',true);

insert into public.expenses (id, user_id, vendor, category, expense_date, net_amount, vat_amount)
values (
  '88888888-8888-8888-8888-888888888888',
  '22222222-2222-2222-2222-222222222222',
  'other owner receipt', 'software', '2026-02-05', 1, 0
);

do $$
declare
  cleanup_function oid := 'finance_private.authorize_invoice_pdf_cleanup(text, text)'::regprocedure;
begin
  if (select prosecdef from pg_proc where oid = cleanup_function) then
    raise exception 'invoice PDF cleanup predicate must remain SECURITY INVOKER';
  end if;
  if has_schema_privilege('anon', 'finance_private', 'usage')
    or has_function_privilege('anon', cleanup_function, 'execute') then
    raise exception 'invoice PDF cleanup predicate is exposed to anonymous RPC callers';
  end if;
  if exists (
    select 1
    from aclexplode((select proacl from pg_proc where oid = cleanup_function)) acl
    where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'invoice PDF cleanup predicate has a PUBLIC execute grant';
  end if;
  if not has_schema_privilege('authenticated', 'finance_private', 'usage')
    or not has_function_privilege('authenticated', cleanup_function, 'execute') then
    raise exception 'authenticated Storage policy cannot invoke its cleanup predicate';
  end if;
end;
$$;

-- RLS rejects this shape for ordinary clients, but financial-record integrity
-- must also hold for a direct table write that bypasses RLS. A booked row
-- cannot receive a child document before its own INSERT has completed.
do $$
begin
  begin
    insert into public.expenses (
      user_id, vendor, category, expense_date, net_amount, vat_amount, status
    ) values (
      '11111111-1111-1111-1111-111111111111', 'privileged direct booked insert',
      'software', '2026-03-05', 1, 0, 'booked'
    );
    raise exception 'a direct insert created a booked expense without a document';
  exception when others then
    if position('receipt document' in lower(sqlerrm)) = 0 then
      raise;
    end if;
  end;
end;
$$;

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
  archive_invoice_id uuid;
  review_path text;
  booked_path text;
  invoice_path text;
  orphan_invoice_path text;
  other_user_invoice_path text;
  tax_export_path text;
  checksum text := 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
  revision bigint;
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
  select content_revision into revision from public.invoices where id = invoice_id;
  if not public.prepare_invoice_archive(invoice_id, revision, 'issue') then
    raise exception 'orphan invoice archive preparation failed';
  end if;
  invoice_path := '11111111-1111-1111-1111-111111111111/' || invoice_id || '/' || checksum || '.pdf';
  orphan_invoice_path := '11111111-1111-1111-1111-111111111111/' || invoice_id || '/'
    || 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.pdf';
  other_user_invoice_path := '22222222-2222-2222-2222-222222222222/'
    || '77777777-7777-7777-7777-777777777777/'
    || 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff.pdf';
  tax_export_path := '11111111-1111-1111-1111-111111111111/issued_invoices-2026-99999999-0000-4000-8000-000000000006.zip';

  insert into storage.objects (bucket_id, name, owner_id)
  values ('issued-invoices', orphan_invoice_path, '11111111-1111-1111-1111-111111111111');
  delete from storage.objects where bucket_id = 'issued-invoices' and name = orphan_invoice_path;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'owner could not remove an unreferenced attempted invoice PDF';
  end if;
  if public.archive_issued_invoice_pdf(
    invoice_id,
    orphan_invoice_path,
    'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    0,
    'issue'
  ) then
    raise exception 'archive succeeded after cleanup removed its object';
  end if;
  select count(*) into affected_rows
  from public.invoices
  where id = invoice_id
    and status = 'pending'
    and archive_intent = 'issue'
    and pdf_storage_path is null
    and pdf_sha256 is null;
  if affected_rows <> 1 then
    raise exception 'cleanup-first ordering left an invoice reference behind';
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

  insert into public.invoices (
    invoice_number, date, client_id, client_name, due_date, status
  ) values (
    'ARCHIVE-2026-002', '2026-02-04', client_id, 'Archive client', '2026-02-18', 'draft'
  ) returning id into archive_invoice_id;
  invoice_path := '11111111-1111-1111-1111-111111111111/' || archive_invoice_id || '/' || checksum || '.pdf';

  begin
    update public.invoices set status = 'pending' where id = archive_invoice_id;
    raise exception 'draft invoice issued without archive';
  exception when raise_exception then
    if position('controlled archive action' in lower(sqlerrm)) = 0 then
      raise;
    end if;
  end;

  select content_revision into revision from public.invoices where id = archive_invoice_id;
  if not public.prepare_invoice_archive(archive_invoice_id, revision, 'issue') then
    raise exception 'invoice archive preparation failed';
  end if;
  insert into storage.objects (bucket_id, name, owner_id)
  values ('issued-invoices', invoice_path, '11111111-1111-1111-1111-111111111111');

  if not public.archive_issued_invoice_pdf(archive_invoice_id, invoice_path, checksum, revision, 'issue') then
    raise exception 'archive RPC did not atomically issue the invoice';
  end if;
  select count(*) into affected_rows from public.invoices
  where id = archive_invoice_id and status = 'pending' and pdf_storage_path = invoice_path and pdf_sha256 = checksum;
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

-- A client-side button guard is not an integrity boundary. The lifecycle
-- trigger must refuse an authenticated direct review -> booked transition when
-- the record has no attached evidence.
do $$
declare
  undocumented_expense_id uuid;
begin
  insert into public.expenses (user_id, vendor, category, expense_date, net_amount, vat_amount)
  values ('11111111-1111-1111-1111-111111111111', 'no evidence', 'software', '2026-03-05', 1, 0)
  returning id into undocumented_expense_id;

  begin
    update public.expenses set status = 'booked' where id = undocumented_expense_id;
    raise exception 'an authenticated caller booked an expense without a document';
  exception when others then
    if position('receipt document' in lower(sqlerrm)) = 0 then
      raise;
    end if;
  end;

  begin
    insert into public.expenses (user_id, vendor, category, expense_date, net_amount, vat_amount, status)
    values ('11111111-1111-1111-1111-111111111111', 'direct booked insert', 'software', '2026-03-05', 1, 0, 'booked');
    raise exception 'an authenticated caller inserted a booked expense without a document';
  exception when others then
    if position('receipt document' in lower(sqlerrm)) = 0 then
      raise;
    end if;
  end;
end;
$$;

-- Database-reference-first receipt cleanup: after a review document row is
-- deleted, only its owner may remove the now-unreferenced Storage object.
-- Referenced, booked, voided, and other-owner objects remain unavailable.
do $$
declare
  orphan_expense_id uuid;
  referenced_expense_id uuid;
  booked_expense_id uuid;
  voided_expense_id uuid;
  orphan_path text;
  referenced_path text;
  booked_path text;
  voided_path text;
  affected_rows integer;
begin
  insert into public.expenses (user_id, vendor, category, expense_date, net_amount, vat_amount)
  values ('11111111-1111-1111-1111-111111111111', 'orphan cleanup', 'software', '2026-03-01', 1, 0)
  returning id into orphan_expense_id;
  orphan_path := '11111111-1111-1111-1111-111111111111/' || orphan_expense_id || '/orphan.pdf';
  insert into public.expense_documents (user_id, expense_id, document_role, storage_path, filename, detected_mime_type, byte_size, sha256)
  values ('11111111-1111-1111-1111-111111111111', orphan_expense_id, 'receipt', orphan_path, 'orphan.pdf', 'application/pdf', 100,
    '1111111111111111111111111111111111111111111111111111111111111111');
  insert into storage.objects (bucket_id, name, owner_id)
  values ('expense-documents', orphan_path, '11111111-1111-1111-1111-111111111111');
  delete from public.expense_documents where storage_path = orphan_path;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then raise exception 'owner could not remove a review document reference'; end if;
  delete from storage.objects where bucket_id = 'expense-documents' and name = orphan_path;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then raise exception 'owner could not clean up an unreferenced review receipt object'; end if;

  insert into public.expenses (user_id, vendor, category, expense_date, net_amount, vat_amount)
  values ('11111111-1111-1111-1111-111111111111', 'referenced receipt', 'software', '2026-03-02', 1, 0)
  returning id into referenced_expense_id;
  referenced_path := '11111111-1111-1111-1111-111111111111/' || referenced_expense_id || '/referenced.pdf';
  insert into public.expense_documents (user_id, expense_id, document_role, storage_path, filename, detected_mime_type, byte_size, sha256)
  values ('11111111-1111-1111-1111-111111111111', referenced_expense_id, 'receipt', referenced_path, 'referenced.pdf', 'application/pdf', 100,
    '2222222222222222222222222222222222222222222222222222222222222222');
  insert into storage.objects (bucket_id, name, owner_id)
  values ('expense-documents', referenced_path, '11111111-1111-1111-1111-111111111111');
  delete from storage.objects where bucket_id = 'expense-documents' and name = referenced_path;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then raise exception 'referenced review receipt object was deletable'; end if;

  insert into public.expenses (user_id, vendor, category, expense_date, net_amount, vat_amount)
  values ('11111111-1111-1111-1111-111111111111', 'booked orphan', 'software', '2026-03-03', 1, 0)
  returning id into booked_expense_id;
  booked_path := '11111111-1111-1111-1111-111111111111/' || booked_expense_id || '/booked-orphan.pdf';
  insert into storage.objects (bucket_id, name, owner_id)
  values ('expense-documents', booked_path, '11111111-1111-1111-1111-111111111111');
  insert into public.expense_documents (user_id, expense_id, document_role, storage_path, filename, detected_mime_type, byte_size, sha256)
  values ('11111111-1111-1111-1111-111111111111', booked_expense_id, 'receipt', booked_path, 'booked-orphan.pdf', 'application/pdf', 100,
    '3333333333333333333333333333333333333333333333333333333333333333');
  update public.expenses set status = 'booked' where id = booked_expense_id;
  delete from storage.objects where bucket_id = 'expense-documents' and name = booked_path;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then raise exception 'booked orphan receipt object was deletable'; end if;

  insert into public.expenses (user_id, vendor, category, expense_date, net_amount, vat_amount)
  values ('11111111-1111-1111-1111-111111111111', 'voided orphan', 'software', '2026-03-04', 1, 0)
  returning id into voided_expense_id;
  voided_path := '11111111-1111-1111-1111-111111111111/' || voided_expense_id || '/voided-orphan.pdf';
  insert into storage.objects (bucket_id, name, owner_id)
  values ('expense-documents', voided_path, '11111111-1111-1111-1111-111111111111');
  update public.expenses set status = 'voided', void_reason = 'not required' where id = voided_expense_id;
  delete from storage.objects where bucket_id = 'expense-documents' and name = voided_path;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then raise exception 'voided orphan receipt object was deletable'; end if;

  delete from storage.objects
  where bucket_id = 'expense-documents'
    and name = '22222222-2222-2222-2222-222222222222/88888888-8888-8888-8888-888888888888/other-owner-orphan.pdf';
  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then raise exception 'owner could remove another user''s orphan receipt object'; end if;
end;
$$;

rollback;
