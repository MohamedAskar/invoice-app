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

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

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

  insert into storage.objects (bucket_id, name, owner_id)
  values (
    'expense-documents',
    '11111111-1111-1111-1111-111111111111/receipt.jpg',
    '11111111-1111-1111-1111-111111111111'
  );

  begin
    insert into storage.objects (bucket_id, name, owner_id)
    values (
      'expense-documents',
      '22222222-2222-2222-2222-222222222222/blocked.jpg',
      '11111111-1111-1111-1111-111111111111'
    );
    raise exception 'owner could upload to another user folder';
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

  select count(*) into affected_rows from storage.objects where bucket_id = 'expense-documents';
  if affected_rows <> 0 then
    raise exception 'non-owner could read owner storage objects';
  end if;
end;
$$;

rollback;
