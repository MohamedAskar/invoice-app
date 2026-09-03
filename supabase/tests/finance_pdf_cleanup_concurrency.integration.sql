-- Two-session proof that invoice archival and orphan cleanup serialize on the
-- same invoice row. Run against a disposable local database as supabase_admin.
-- The fixed fixture IDs are removed before and after the proof.
\set ON_ERROR_STOP on

begin;
create extension if not exists dblink with schema extensions;

select extensions.dblink_connect(
  'setup',
  'host=127.0.0.1 port=5432 dbname=postgres user=postgres password=postgres application_name=pdf_cleanup_setup'
);
select extensions.dblink_connect(
  'cleanup',
  'host=127.0.0.1 port=5432 dbname=postgres user=postgres password=postgres application_name=pdf_cleanup_delete'
);
select extensions.dblink_connect(
  'archive',
  'host=127.0.0.1 port=5432 dbname=postgres user=postgres password=postgres application_name=pdf_cleanup_archive'
);
select *
from extensions.dblink('setup', $setup_config$
  select set_config('storage.allow_delete_query', 'true', false)
$setup_config$) as configured(allow_delete text);

select extensions.dblink_exec('setup', $setup$
  delete from storage.objects
  where bucket_id = 'issued-invoices'
    and name like '11111111-1111-1111-1111-111111111111/99999999-9999-9999-9999-%';
  delete from public.invoices
  where id in (
    '99999999-9999-9999-9999-999999999991',
    '99999999-9999-9999-9999-999999999992'
  );
  delete from public.clients where id = '99999999-9999-9999-9999-999999999990';

  insert into public.clients (id, name)
  values ('99999999-9999-9999-9999-999999999990', 'PDF cleanup race fixture');
  insert into public.invoices (
    id, invoice_number, date, client_id, client_name, due_date, status
  ) values
    (
      '99999999-9999-9999-9999-999999999991', 'RACE-CLEANUP-FIRST', '2026-09-03',
      '99999999-9999-9999-9999-999999999990', 'PDF cleanup race fixture', '2026-09-17', 'draft'
    ),
    (
      '99999999-9999-9999-9999-999999999992', 'RACE-ARCHIVE-FIRST', '2026-09-03',
      '99999999-9999-9999-9999-999999999990', 'PDF cleanup race fixture', '2026-09-17', 'draft'
    );
  insert into storage.objects (bucket_id, name, owner_id) values
    (
      'issued-invoices',
      '11111111-1111-1111-1111-111111111111/99999999-9999-9999-9999-999999999991/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.pdf',
      '11111111-1111-1111-1111-111111111111'
    ),
    (
      'issued-invoices',
      '11111111-1111-1111-1111-111111111111/99999999-9999-9999-9999-999999999992/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.pdf',
      '11111111-1111-1111-1111-111111111111'
    );
$setup$);

select extensions.dblink_exec('cleanup', 'set role authenticated');
select extensions.dblink_exec('archive', 'set role authenticated');
select *
from extensions.dblink('cleanup', $claims$
  select
    set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false),
    set_config(
      'request.jwt.claims',
      '{"sub":"11111111-1111-1111-1111-111111111111","email":"OWNER_EMAIL_PLACEHOLDER__CONFIGURE_SECURELY"}',
      false
    ),
    set_config('storage.allow_delete_query', 'true', false)
$claims$) as configured(sub text, claims text, allow_delete text);
select *
from extensions.dblink('archive', $claims$
  select
    set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false),
    set_config(
      'request.jwt.claims',
      '{"sub":"11111111-1111-1111-1111-111111111111","email":"OWNER_EMAIL_PLACEHOLDER__CONFIGURE_SECURELY"}',
      false
    )
$claims$) as configured(sub text, claims text);

create temporary table race_results (
  race text primary key,
  cleanup_count integer not null,
  archive_result boolean not null
);

-- Cleanup gets the lock first and deliberately holds it. Archive must wait,
-- then observe the deleted object and return false without updating invoice.
select extensions.dblink_send_query('cleanup', $cleanup_first$
  with removed as materialized (
    delete from storage.objects
    where bucket_id = 'issued-invoices'
      and name = '11111111-1111-1111-1111-111111111111/99999999-9999-9999-9999-999999999991/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.pdf'
    returning 1
  ), held as materialized (select pg_sleep(1))
  select count(*)::integer from removed cross join held
$cleanup_first$);
select pg_sleep(0.2);
select extensions.dblink_send_query('archive', $archive_second$
  select public.archive_issued_invoice_pdf(
    '99999999-9999-9999-9999-999999999991',
    '11111111-1111-1111-1111-111111111111/99999999-9999-9999-9999-999999999991/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.pdf',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  )
$archive_second$);
select pg_sleep(0.2);

do $$
begin
  if not exists (
    select 1 from pg_stat_activity
    where application_name = 'pdf_cleanup_archive' and wait_event_type = 'Lock'
  ) then
    raise exception 'archive did not wait for the cleanup-held invoice lock';
  end if;
end;
$$;

insert into race_results (race, cleanup_count, archive_result)
select 'cleanup-first', cleanup.removed, archive.archived
from extensions.dblink_get_result('cleanup') as cleanup(removed integer)
cross join extensions.dblink_get_result('archive') as archive(archived boolean);
-- dblink leaves an empty result to consume after an asynchronous query. Drain
-- it before reusing either connection for the opposite interleaving.
select * from extensions.dblink_get_result('cleanup') as drained(removed integer);
select * from extensions.dblink_get_result('archive') as drained(archived boolean);

-- Archive gets the lock first and deliberately holds it. Cleanup must wait,
-- then re-check the now-referenced path and delete zero objects.
select extensions.dblink_send_query('archive', $archive_first$
  with archived as materialized (
    select public.archive_issued_invoice_pdf(
      '99999999-9999-9999-9999-999999999992',
      '11111111-1111-1111-1111-111111111111/99999999-9999-9999-9999-999999999992/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.pdf',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    ) as result
  ), held as materialized (select pg_sleep(1))
  select bool_and(archived.result) from archived cross join held
$archive_first$);
select pg_sleep(0.2);
select extensions.dblink_send_query('cleanup', $cleanup_second$
  with removed as materialized (
    delete from storage.objects
    where bucket_id = 'issued-invoices'
      and name = '11111111-1111-1111-1111-111111111111/99999999-9999-9999-9999-999999999992/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.pdf'
    returning 1
  )
  select count(*)::integer from removed
$cleanup_second$);
select pg_sleep(0.2);

do $$
begin
  if not exists (
    select 1 from pg_stat_activity
    where application_name = 'pdf_cleanup_delete' and wait_event_type = 'Lock'
  ) then
    raise exception 'cleanup did not wait for the archive-held invoice lock';
  end if;
end;
$$;

insert into race_results (race, cleanup_count, archive_result)
select 'archive-first', cleanup.removed, archive.archived
from extensions.dblink_get_result('archive') as archive(archived boolean)
cross join extensions.dblink_get_result('cleanup') as cleanup(removed integer);
select * from extensions.dblink_get_result('archive') as drained(archived boolean);
select * from extensions.dblink_get_result('cleanup') as drained(removed integer);

do $$
begin
  if not exists (
    select 1 from race_results
    where race = 'cleanup-first' and cleanup_count = 1 and not archive_result
  ) then
    raise exception 'cleanup-first race did not delete once and reject archive';
  end if;
  if not exists (
    select 1 from race_results
    where race = 'archive-first' and cleanup_count = 0 and archive_result
  ) then
    raise exception 'archive-first race did not archive once and reject cleanup';
  end if;
  if not exists (
    select 1 from public.invoices
    where id = '99999999-9999-9999-9999-999999999991'
      and status = 'draft' and pdf_storage_path is null and pdf_sha256 is null
  ) or exists (
    select 1 from storage.objects
    where bucket_id = 'issued-invoices'
      and name like '%99999999-9999-9999-9999-999999999991%'
  ) then
    raise exception 'cleanup-first final state is inconsistent';
  end if;
  if not exists (
    select 1 from public.invoices
    where id = '99999999-9999-9999-9999-999999999992'
      and status = 'pending'
      and pdf_storage_path like '%99999999-9999-9999-9999-999999999992%'
      and pdf_sha256 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  ) or not exists (
    select 1 from storage.objects
    where bucket_id = 'issued-invoices'
      and name like '%99999999-9999-9999-9999-999999999992%'
  ) then
    raise exception 'archive-first final state is inconsistent';
  end if;
end;
$$;

table race_results;

select extensions.dblink_exec('setup', $cleanup$
  delete from storage.objects
  where bucket_id = 'issued-invoices'
    and name like '11111111-1111-1111-1111-111111111111/99999999-9999-9999-9999-%';
  delete from public.invoices
  where id in (
    '99999999-9999-9999-9999-999999999991',
    '99999999-9999-9999-9999-999999999992'
  );
  delete from public.clients where id = '99999999-9999-9999-9999-999999999990';
$cleanup$);
select extensions.dblink_disconnect('cleanup');
select extensions.dblink_disconnect('archive');
select extensions.dblink_disconnect('setup');

rollback;
