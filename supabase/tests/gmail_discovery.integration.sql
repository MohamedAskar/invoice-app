-- Synthetic local data; all fixtures roll back. Never use a real mailbox.
begin;
create function pg_temp.assert_true(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%',message; end if; end; $$;
create or replace function public.is_owner() returns boolean language sql stable set search_path='' as $$
select auth.uid()='11111111-1111-1111-1111-111111111111'::uuid; $$;
insert into auth.users(id,email) values('11111111-1111-1111-1111-111111111111','owner@example.test'),('22222222-2222-2222-2222-222222222222','other@example.test');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.claim_gmail_sync(uuid)','execute'),'client can claim secrets');
select pg_temp.assert_true(not has_function_privilege('anon','public.import_gmail_candidate(uuid,uuid,jsonb)','execute'),'anonymous can import');
select pg_temp.assert_true(not has_function_privilege('service_role','public.dispatch_gmail_schedule(text)','execute'),'HTTP caller can dispatch cron');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.gmail_object_is_unreferenced(uuid,text)','execute'),'client can reserve cleanup paths');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.record_gmail_item_error(uuid,uuid,text,text)','execute'),'client can forge item failures');
select pg_temp.assert_true(not has_table_privilege('authenticated','finance_private.gmail_object_cleanup','select'),'client can read cleanup reservations');
insert into public.gmail_connections(user_id,gmail_address,access_token_encrypted,refresh_token_encrypted,status,daily_sync_enabled)
values('11111111-1111-1111-1111-111111111111','owner@example.test','synthetic','synthetic','active',true);
create temp table claim as select * from public.claim_gmail_sync('11111111-1111-1111-1111-111111111111');
select pg_temp.assert_true((select count(*)=0 from public.claim_gmail_sync('11111111-1111-1111-1111-111111111111')),'concurrent claim succeeded');
create temp table candidate as select jsonb_build_object('messageId','synthetic-message','vendor','Supplier','senderEmail','billing@supplier.test','senderDomain','supplier.test',
  'receivedAt','2026-08-31T10:00:00Z','multiple',false,'ignored',1,'skipped',0,'documents',jsonb_build_array(
  jsonb_build_object('attachmentId','invoice','filename','Invoice-123.pdf','role','invoice','primary',true,'reason','invoice_filename','sha256',repeat('a',64),'declaredMime','application/pdf','detectedMime','application/pdf','byteSize',100,'storagePath','11111111-1111-1111-1111-111111111111/gmail/synthetic/invoice'),
  jsonb_build_object('attachmentId','receipt','filename','Receipt-123.pdf','role','receipt','primary',false,'reason','receipt_filename','sha256',repeat('b',64),'declaredMime','application/pdf','detectedMime','application/pdf','byteSize',100,'storagePath','11111111-1111-1111-1111-111111111111/gmail/synthetic/receipt'))) as data;
select pg_temp.assert_true((public.import_gmail_candidate(c.user_id,c.sync_run_id,x.data)->>'documents')::int=2,'pair not grouped') from claim c,candidate x;
select pg_temp.assert_true((public.import_gmail_candidate(c.user_id,c.sync_run_id,x.data)->>'documents')::int=0,'repeat source imported') from claim c,candidate x;
grant select on claim to service_role;
set local role service_role;
select public.record_gmail_item_error(c.user_id,c.sync_run_id,'provider-error','attachment-error') from claim c;
reset role;
select pg_temp.assert_true((select import_state='failed' and filter_reason='provider_item_failed' and subject is null and storage_path is null from public.gmail_imports where gmail_message_id='provider-error'),'generic item failure not retained');
select pg_temp.assert_true((select count(*)=1 from public.expenses),'duplicate expense');
select pg_temp.assert_true((select count(*)=2 from public.expense_documents),'missing evidence');
select pg_temp.assert_true((select status='needs_review' and source='gmail' and net_amount=0 and vat_amount=0 and vendor_invoice_number is null and paid_date is null from public.expenses),'automatic financial prefill or booking');
select pg_temp.assert_true((select history_id is null from public.gmail_connections),'cursor advanced before commit');
select public.finish_gmail_sync(c.user_id,c.sync_run_id,'{"mode":"search","targetHistory":"100","pageToken":"page2"}',
  '{"candidates":1,"documents":2,"ignored":1,"skipped":0}', '100') from claim c;
select pg_temp.assert_true((select history_id is null and sync_cursor->>'pageToken'='page2' from public.gmail_connections),'backfill cursor wrong');
select pg_temp.assert_true((select count(*)=1 from public.gmail_sync_runs where status='queued'),'continuation not queued');
update public.gmail_connections set daily_sync_enabled=false;
select pg_temp.assert_true((select count(*)=1 from public.gmail_scheduled_users(true)),'paused manual backfill continuation was lost');
select pg_temp.assert_true((select count(*)=0 from public.gmail_scheduled_users(false)),'pause did not block new daily scan');
create temp table resumed_claim as select * from public.claim_gmail_sync('11111111-1111-1111-1111-111111111111');
select public.finish_gmail_sync(c.user_id,c.sync_run_id,null,'{"candidates":0,"documents":0,"ignored":0,"skipped":0}','100') from resumed_claim c;
select pg_temp.assert_true((select history_id='100' and sync_cursor is null and not daily_sync_enabled from public.gmail_connections),'paused backfill did not complete');
select pg_temp.assert_true((select count(*)=0 from public.gmail_scheduled_users(true)),'completed paused backfill keeps scheduling');
create temp table later_claim as select * from public.claim_gmail_sync('11111111-1111-1111-1111-111111111111');
select public.finish_gmail_sync(c.user_id,c.sync_run_id,'{"mode":"search","targetHistory":"200","pageToken":"page2"}','{"candidates":0,"documents":0,"ignored":0,"skipped":0}','200') from later_claim c;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',true);
select count(*) from public.set_review_document_primary((select id from public.expense_documents where filename='Receipt-123.pdf'));
select pg_temp.assert_true((select is_primary from public.expense_documents where filename='Receipt-123.pdf'),'primary switch failed');
select public.remember_gmail_vendor((select id from public.expenses),'always_include');
select pg_temp.assert_true((select action='always_include' from public.expense_vendor_rules),'vendor rule not saved');
do $$ begin
  begin update public.expenses set status='booked'; raise exception 'unconfirmed book succeeded';
  exception when others then if sqlerrm<>'Confirm the Gmail document fields and amounts before booking' then raise; end if; end;
end; $$;
update public.expenses set gmail_import_complete=false where gmail_message_id='synthetic-message';
do $$ begin
  begin perform public.split_gmail_expense_document((select id from public.expense_documents where filename='Receipt-123.pdf'));
    raise exception 'incomplete Gmail candidate split';
  exception when others then if sqlerrm<>'split_unavailable' then raise; end if; end;
end; $$;
update public.expenses set gmail_import_complete=true where gmail_message_id='synthetic-message';
select public.split_gmail_expense_document((select id from public.expense_documents where filename='Receipt-123.pdf'));
select pg_temp.assert_true((select count(*)=2 from public.expenses),'split missing');
select pg_temp.assert_true((select count(distinct expense_id)=2 from public.gmail_imports),'split lost import grouping');
select pg_temp.assert_true((select count(*)=2 from public.expense_documents where is_primary),'split primary missing');
delete from public.expense_documents where filename='Receipt-123.pdf';
select pg_temp.assert_true((select import_state='excluded' from public.gmail_imports where gmail_attachment_id='receipt'),'removed source not retained');
select public.delete_review_expense((select id from public.expenses where gmail_message_id is null));
select pg_temp.assert_true((select expense_id is null from public.gmail_imports where gmail_attachment_id='receipt'),'deletion lost source history');

select set_config('request.jwt.claims','{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',true);
select pg_temp.assert_true((select count(*)=0 from public.expenses),'other user sees expense');
select pg_temp.assert_true((select count(*)=0 from public.gmail_imports),'other user sees source history');
reset role;
create temp table second_claim as select * from public.claim_gmail_sync('11111111-1111-1111-1111-111111111111');
select public.fail_gmail_sync(c.user_id,c.sync_run_id,true) from second_claim c;
select pg_temp.assert_true((select status='reauthorization_required' and not daily_sync_enabled and sync_cursor->>'pageToken'='page2' from public.gmail_connections),'revocation lost cursor or did not stop');
select pg_temp.assert_true((select count(*)=0 from public.gmail_scheduled_users(false)),'revoked connection scheduled');
select pg_temp.assert_true((select count(*)=0 from public.claim_gmail_sync('11111111-1111-1111-1111-111111111111')),'revoked token claimable');
rollback;
