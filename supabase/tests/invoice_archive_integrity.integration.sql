\set ON_ERROR_STOP on
begin;
create or replace function public.is_owner() returns boolean language sql stable set search_path = ''
as $$ select auth.uid() = '11111111-1111-1111-1111-111111111111'::uuid $$;

insert into public.clients(id, name) values ('aaaaaaaa-0000-0000-0000-000000000000', 'Archive fixture');
insert into public.invoices(id, invoice_number, date, client_id, client_name, due_date, status)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'ARCHIVE-INTEGRITY', '2026-09-07',
  'aaaaaaaa-0000-0000-0000-000000000000', 'Archive fixture', '2026-09-21', 'draft');
alter table public.invoices disable trigger invoices_enforce_pdf_archive;
insert into public.invoices(id, invoice_number, date, client_id, client_name, due_date, status)
select ('aaaaaaaa-0000-0000-0000-00000000000' || n)::uuid, 'BACKFILL-' || n, '2025-01-01',
  'aaaaaaaa-0000-0000-0000-000000000000', 'Archive fixture', '2025-01-15', status::public.invoice_status
from (values (2, 'pending'), (3, 'paid'), (4, 'overdue')) fixtures(n, status);
alter table public.invoices enable trigger invoices_enforce_pdf_archive;
insert into storage.objects(bucket_id, name, owner_id) values ('issued-invoices',
  '22222222-2222-2222-2222-222222222222/aaaaaaaa-0000-0000-0000-000000000001/' || repeat('c',64) || '.pdf',
  '22222222-2222-2222-2222-222222222222');
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
select set_config('storage.allow_delete_query','true',true);

do $$
declare
  target_invoice_id uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  checksum text := repeat('a', 64);
  path text := auth.uid()::text || '/' || target_invoice_id || '/' || checksum || '.pdf';
  revision bigint;
  affected integer;
  legacy record;
begin
  if not public.prepare_invoice_archive(target_invoice_id, 0, 'issue') then raise exception 'issue preparation failed'; end if;
  if not exists(select 1 from public.invoices where id=target_invoice_id and status='pending'
    and archive_intent='issue' and pdf_storage_path is null and pdf_sha256 is null) then
    raise exception 'missing archive state is not persistently pending';
  end if;
  begin
    update public.invoices set archive_intent=null where id=target_invoice_id;
    raise exception 'direct clear of failure marker permitted';
  exception when raise_exception then
    if sqlerrm='direct clear of failure marker permitted' then raise; end if;
  end;
  insert into storage.objects(bucket_id,name,owner_id) values('issued-invoices',path,auth.uid()::text);
  -- Rendering revision 0, followed by a different tab editing invoice content.
  update public.invoices set notes='Edited in another tab', content_revision=0 where id=target_invoice_id;
  if public.archive_issued_invoice_pdf(target_invoice_id,path,checksum,0,'issue') then raise exception 'stale PDF archived'; end if;
  delete from storage.objects where bucket_id='issued-invoices' and name=path;
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'failed archive orphan cleanup denied'; end if;
  -- The identical immutable path can now be uploaded on retry, without upsert.
  insert into storage.objects(bucket_id,name,owner_id) values('issued-invoices',path,auth.uid()::text);
  select content_revision into revision from public.invoices where id=target_invoice_id;
  insert into public.invoice_line_items(id,invoice_id,description)
    values('aaaaaaaa-1000-0000-0000-000000000001',target_invoice_id,'New line');
  if public.archive_issued_invoice_pdf(target_invoice_id,path,checksum,revision,'issue') then raise exception 'stale line snapshot archived'; end if;
  select content_revision into revision from public.invoices where id=target_invoice_id;
  update public.invoice_line_items as line_item set description='Updated line' where line_item.invoice_id=target_invoice_id;
  if public.archive_issued_invoice_pdf(target_invoice_id,path,checksum,revision,'issue') then raise exception 'stale updated line snapshot archived'; end if;
  select content_revision into revision from public.invoices where id=target_invoice_id;
  delete from public.invoice_line_items as line_item where line_item.invoice_id=target_invoice_id;
  if public.archive_issued_invoice_pdf(target_invoice_id,path,checksum,revision,'issue') then raise exception 'stale deleted line snapshot archived'; end if;
  insert into public.invoice_line_items(id,invoice_id,description)
    values('aaaaaaaa-1000-0000-0000-000000000002',target_invoice_id,'Archived snapshot line');
  select content_revision into revision from public.invoices where id=target_invoice_id;
  if not public.archive_issued_invoice_pdf(target_invoice_id,path,checksum,revision,'issue') then raise exception 'retry failed'; end if;
  if exists(select 1 from public.invoices where id=target_invoice_id and archive_intent is not null) then raise exception 'success marker not cleared'; end if;
  begin
    update public.invoices set total=999 where id=target_invoice_id;
    raise exception 'archived invoice amount changed';
  exception when others then if sqlerrm='archived invoice amount changed' then raise; end if; end;
  begin
    insert into public.invoice_line_items(id,invoice_id,description)
      values('aaaaaaaa-1000-0000-0000-000000000003',target_invoice_id,'Late change');
    raise exception 'archived invoice line changed';
  exception when others then if sqlerrm='archived invoice line changed' then raise; end if; end;
  begin
    update public.invoice_line_items set invoice_id='aaaaaaaa-0000-0000-0000-000000000002'
      where invoice_id=target_invoice_id;
    raise exception 'archived invoice line moved';
  exception when others then if sqlerrm='archived invoice line moved' then raise; end if; end;
  delete from storage.objects where bucket_id='issued-invoices' and name=path;
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'referenced PDF deleted'; end if;
  delete from storage.objects where bucket_id='issued-invoices' and owner_id='22222222-2222-2222-2222-222222222222';
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'other-owner PDF deleted'; end if;

  for legacy in select id,status,content_revision from public.invoices where invoice_number like 'BACKFILL-%' loop
    if public.prepare_invoice_archive(legacy.id,legacy.content_revision,'issue') then raise exception 'ordinary issuance admitted legacy backfill'; end if;
    path := auth.uid()::text || '/' || legacy.id || '/' || checksum || '.pdf';
    if public.archive_issued_invoice_pdf(legacy.id,path,checksum,legacy.content_revision,'backfill') then
      raise exception 'unprepared backfill admitted';
    end if;
    if not public.prepare_invoice_archive(legacy.id,legacy.content_revision,'backfill') then raise exception 'confirmed backfill preparation failed'; end if;
    insert into storage.objects(bucket_id,name,owner_id) values('issued-invoices',path,auth.uid()::text);
    if public.archive_issued_invoice_pdf(legacy.id,path,checksum,legacy.content_revision,'issue') then raise exception 'wrong intent archived'; end if;
    if not public.archive_issued_invoice_pdf(legacy.id,path,checksum,legacy.content_revision,'backfill') then raise exception 'confirmed backfill failed'; end if;
    if (select status from public.invoices where id=legacy.id)<>legacy.status then raise exception 'backfill changed legacy status'; end if;
  end loop;
end;
$$;
reset role;
do $$ begin
  if to_regprocedure('public.discard_unarchived_invoice_pdf(uuid,text,text)') is not null then raise exception 'discard endpoint remains'; end if;
  if to_regprocedure('public.archive_issued_invoice_pdf(uuid,text,text)') is not null then raise exception 'broad legacy archive endpoint remains'; end if;
  -- Later Gmail migrations deliberately use three narrow definer routines:
  -- two triggers without caller grants and an owner-checking split RPC. Keep
  -- the historical archive/audit privilege escalation gone while rejecting
  -- any additional definer surface or an unsafe search path/public grant.
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','finance_private') and p.prosecdef and not (
      (n.nspname='finance_private' and p.proname='guard_gmail_document_path') or
      (n.nspname='public' and p.proname in ('split_gmail_expense_document','track_gmail_document_removal'))
    )) then raise exception 'unexpected application SECURITY DEFINER remains'; end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prosecdef and (
    (n.nspname='finance_private' and p.proname='guard_gmail_document_path') or
    (n.nspname='public' and p.proname in ('split_gmail_expense_document','track_gmail_document_removal'))
  ))<>3 then raise exception 'approved Gmail SECURITY DEFINER surface changed'; end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prosecdef and (
    (n.nspname='finance_private' and p.proname='guard_gmail_document_path') or
    (n.nspname='public' and p.proname in ('split_gmail_expense_document','track_gmail_document_removal'))
  ) and not coalesce(p.proconfig,array[]::text[]) @> array['search_path=""']) then raise exception 'approved Gmail definer lacks fixed search path'; end if;
  if has_function_privilege('anon','finance_private.guard_gmail_document_path()','execute')
    or has_function_privilege('authenticated','finance_private.guard_gmail_document_path()','execute')
    or has_function_privilege('anon','public.track_gmail_document_removal()','execute')
    or has_function_privilege('authenticated','public.track_gmail_document_removal()','execute')
    or has_function_privilege('anon','public.split_gmail_expense_document(uuid)','execute') then
    raise exception 'approved Gmail definer has unsafe caller grant';
  end if;
end $$;
rollback;
