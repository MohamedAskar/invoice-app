-- Only service_role can claim a mailbox, read its credential, import, or move
-- its cursor. The user lease serializes discovery with OAuth/disconnect.
alter table public.gmail_connections add column sync_cursor jsonb,
  add column sync_run_id uuid, add column sync_lease_until timestamptz;
alter table public.gmail_sync_runs add column ignored_count integer not null default 0,
  add column skipped_count integer not null default 0;
alter table public.expenses add column gmail_connection_id uuid,
  add column gmail_message_id text, add column gmail_received_at timestamptz,
  add column gmail_sender_domain text, add column gmail_filter_reasons text[] not null default '{}',
  add column gmail_multiple_possible_invoices boolean not null default false,
  add column gmail_ignored_count integer not null default 0,
  add column gmail_skipped_count integer not null default 0,
  add column gmail_review_confirmed boolean not null default false,
  add column gmail_import_complete boolean not null default true,
  add constraint expenses_gmail_owner_fk foreign key (gmail_connection_id,user_id)
    references public.gmail_connections(id,user_id);
create unique index expenses_gmail_message_key on public.expenses(gmail_connection_id,gmail_message_id)
  where gmail_message_id is not null;

create function public.invalidate_gmail_sync_grant() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.refresh_token_encrypted is distinct from old.refresh_token_encrypted or new.status <> 'active' then
    new.sync_run_id := null; new.sync_lease_until := null;
    update public.gmail_sync_runs set status='failed',completed_at=clock_timestamp(),error_code='connection_changed'
      where connection_id=old.id and status='running';
  end if;
  return new;
end; $$;
create trigger invalidate_gmail_sync_grant before update on public.gmail_connections
  for each row execute function public.invalidate_gmail_sync_grant();

create function public.claim_gmail_sync(p_user_id uuid)
returns setof public.gmail_connections language plpgsql set search_path = '' as $$
declare c public.gmail_connections; r uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('gmail:'||p_user_id::text,0));
  select * into c from public.gmail_connections where user_id=p_user_id and status='active' for update;
  if c.id is null or c.sync_lease_until>clock_timestamp() then return; end if;
  update public.gmail_sync_runs set status='failed',completed_at=clock_timestamp(),error_code='lease_expired'
    where connection_id=c.id and status='running';
  select id into r from public.gmail_sync_runs where connection_id=c.id and status='queued' order by created_at limit 1;
  if r is null then insert into public.gmail_sync_runs(user_id,connection_id,sync_kind)
    values(p_user_id,c.id,case when c.history_id is null then 'historical' else 'incremental' end) returning id into r; end if;
  update public.gmail_sync_runs set status='running',started_at=clock_timestamp() where id=r;
  return query update public.gmail_connections set sync_run_id=r,sync_lease_until=clock_timestamp()+interval '5 minutes'
    where id=c.id returning *;
end; $$;

create function public.assert_gmail_sync_lease(p_user_id uuid,p_run_id uuid) returns void
language plpgsql set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('gmail:'||p_user_id::text,0));
  if not exists(select 1 from public.gmail_connections where user_id=p_user_id and status='active'
    and sync_run_id=p_run_id and sync_lease_until>clock_timestamp()) then raise exception 'gmail_sync_unavailable'; end if;
  update public.gmail_connections set sync_lease_until=clock_timestamp()+interval '5 minutes' where user_id=p_user_id;
end; $$;

create function public.import_gmail_candidate(p_user_id uuid,p_run_id uuid,p_candidate jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare c public.gmail_connections; e public.expenses; d jsonb; v_document uuid; n integer:=0; skipped integer:=0; created integer:=0; v_primary boolean;
begin
  perform public.assert_gmail_sync_lease(p_user_id,p_run_id);
  select * into c from public.gmail_connections where user_id=p_user_id;
  if jsonb_array_length(p_candidate->'documents')>200 then raise exception 'gmail_candidate_too_large'; end if;
  select * into e from public.expenses where gmail_connection_id=c.id and gmail_message_id=p_candidate->>'messageId' for update;
  if e.id is not null and e.status<>'needs_review' then
    raise exception 'gmail_candidate_already_reviewed';
  end if;
  for d in select value from jsonb_array_elements(p_candidate->'documents') loop
    if exists(select 1 from public.gmail_imports where connection_id=c.id and gmail_message_id=p_candidate->>'messageId' and gmail_attachment_id=d->>'attachmentId') then skipped:=skipped+1; continue; end if;
    if exists(select 1 from public.expense_documents where user_id=p_user_id and sha256=d->>'sha256') then
      insert into public.gmail_imports(user_id,connection_id,sync_run_id,gmail_message_id,gmail_attachment_id,sha256,filter_reason,import_state)
      values(p_user_id,c.id,p_run_id,p_candidate->>'messageId',d->>'attachmentId',d->>'sha256','duplicate_checksum','duplicate');
      skipped:=skipped+1; continue;
    end if;
    if e.id is null then
      insert into public.expenses(user_id,vendor,category,expense_date,net_amount,vat_amount,source,status,
        gmail_connection_id,gmail_message_id,gmail_received_at,gmail_sender_domain,gmail_multiple_possible_invoices,gmail_ignored_count,gmail_skipped_count,gmail_import_complete)
      values(p_user_id,p_candidate->>'vendor','other',(p_candidate->>'receivedAt')::timestamptz::date,0,0,'gmail','needs_review',
        c.id,p_candidate->>'messageId',(p_candidate->>'receivedAt')::timestamptz,p_candidate->>'senderDomain',
        (p_candidate->>'multiple')::boolean,(p_candidate->>'ignored')::integer,(p_candidate->>'skipped')::integer,coalesce((p_candidate->>'complete')::boolean,true)) returning * into e;
      created:=1;
    end if;
    v_primary := (d->>'primary')::boolean and not exists(select 1 from public.expense_documents where expense_id=e.id and is_primary);
    begin
      insert into public.expense_documents(user_id,expense_id,document_role,is_primary,storage_path,filename,declared_mime_type,detected_mime_type,byte_size,sha256)
      values(p_user_id,e.id,d->>'role',v_primary,d->>'storagePath',d->>'filename',d->>'declaredMime',d->>'detectedMime',(d->>'byteSize')::bigint,d->>'sha256') returning id into v_document;
    exception when unique_violation then skipped:=skipped+1; continue;
    end;
    insert into public.gmail_imports(user_id,connection_id,sync_run_id,gmail_message_id,gmail_attachment_id,gmail_thread_id,
      sender_email,sender_domain,received_at,attachment_filename,declared_mime_type,detected_mime_type,byte_size,sha256,storage_path,expense_id,document_role,matched_vendor_rule_id,filter_reason,import_state)
    values(p_user_id,c.id,p_run_id,p_candidate->>'messageId',d->>'attachmentId',p_candidate->>'threadId',p_candidate->>'senderEmail',
      p_candidate->>'senderDomain',(p_candidate->>'receivedAt')::timestamptz,d->>'filename',d->>'declaredMime',d->>'detectedMime',
      (d->>'byteSize')::bigint,d->>'sha256',d->>'storagePath',e.id,d->>'role',(d->>'ruleId')::uuid,d->>'reason','needs_review');
    update public.expenses set gmail_filter_reasons=array(select distinct unnest(gmail_filter_reasons||array[d->>'reason'])) where id=e.id;
    n:=n+1;
  end loop;
  if created=1 and n=0 then delete from public.expenses where id=e.id; created:=0; end if;
  if e.id is not null and n>0 then update public.expenses set gmail_import_complete=coalesce((p_candidate->>'complete')::boolean,true) where id=e.id; end if;
  return jsonb_build_object('candidates',created,'documents',n,'skipped',skipped);
end; $$;

create function public.complete_gmail_candidate(p_user_id uuid,p_run_id uuid,p_message_id text) returns void
language plpgsql set search_path='' as $$
begin
  perform public.assert_gmail_sync_lease(p_user_id,p_run_id);
  update public.expenses set gmail_import_complete=true where user_id=p_user_id and gmail_message_id=p_message_id and status='needs_review';
end; $$;

create function public.finish_gmail_sync(p_user_id uuid,p_run_id uuid,p_cursor jsonb,p_summary jsonb,p_history_id text) returns void
language plpgsql set search_path = '' as $$
declare c public.gmail_connections;
begin
  perform public.assert_gmail_sync_lease(p_user_id,p_run_id);
  update public.gmail_sync_runs set status='completed',completed_at=clock_timestamp(),
    candidates_found=(p_summary->>'candidates')::integer,imported_count=(p_summary->>'documents')::integer,
    ignored_count=(p_summary->>'ignored')::integer,skipped_count=(p_summary->>'skipped')::integer where id=p_run_id;
  update public.gmail_connections set sync_cursor=p_cursor,sync_run_id=null,sync_lease_until=null,
    history_id=case when p_cursor is null then coalesce(p_history_id,history_id) else history_id end,
    last_synced_at=clock_timestamp() where user_id=p_user_id returning * into c;
  if p_cursor is not null then insert into public.gmail_sync_runs(user_id,connection_id,sync_kind)
    values(p_user_id,c.id,case when c.history_id is null then 'historical' else 'incremental' end); end if;
end; $$;

create function public.fail_gmail_sync(p_user_id uuid,p_run_id uuid,p_revoked boolean) returns void
language plpgsql set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('gmail:'||p_user_id::text,0));
  update public.gmail_connections set status=case when p_revoked then 'reauthorization_required' else status end,
    daily_sync_enabled=case when p_revoked then false else daily_sync_enabled end,
    sync_run_id=null,sync_lease_until=null,last_failed_at=clock_timestamp()
    where user_id=p_user_id and sync_run_id=p_run_id;
  update public.gmail_sync_runs set status='failed',completed_at=clock_timestamp(),
    error_code=case when p_revoked then 'reauthorization_required' else 'sync_failed' end,
    error_message='An item could not be imported. Retry the sync.' where id=p_run_id and user_id=p_user_id and status='running';
end; $$;

create function public.gmail_object_is_unreferenced(p_user_id uuid,p_path text) returns boolean
language sql stable set search_path = '' as $$
  select split_part(p_path,'/',1)=p_user_id::text and not exists(select 1 from public.expense_documents where storage_path=p_path);
$$;
create function public.gmail_scheduled_users(p_queued_only boolean) returns table(user_id uuid)
language sql stable set search_path = '' as $$
  select c.user_id from public.gmail_connections c where c.status='active' and c.daily_sync_enabled
    and (c.sync_lease_until is null or c.sync_lease_until<now())
    and (not p_queued_only or exists(select 1 from public.gmail_sync_runs r where r.connection_id=c.id and r.status='queued'))
    order by c.last_synced_at nulls first limit 20;
$$;

-- Owner RPCs preserve grouping/import IDs when editing review evidence.
create function public.set_review_document_primary(p_document_id uuid) returns setof public.expense_documents
language plpgsql set search_path = '' as $$
declare v_expense_id uuid;
begin
  if not public.is_owner() or auth.uid() is null then raise exception 'not_authorized'; end if;
  select d.expense_id into v_expense_id from public.expense_documents d where d.id=p_document_id and d.user_id=auth.uid();
  perform 1 from public.expenses e where e.id=v_expense_id and e.user_id=auth.uid() and e.status='needs_review' for update;
  if not found then raise exception 'primary_unavailable'; end if;
  update public.expense_documents d set is_primary=false where d.expense_id=v_expense_id and d.is_primary;
  return query update public.expense_documents d set is_primary=true where d.id=p_document_id returning *;
end; $$;

create function public.split_gmail_expense_document(p_document_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare e public.expenses; d public.expense_documents; new_id uuid;
begin
  if not public.is_owner() or auth.uid() is null then raise exception 'not_authorized'; end if;
  select * into d from public.expense_documents where id=p_document_id and user_id=auth.uid();
  select * into e from public.expenses where id=d.expense_id and user_id=auth.uid() for update;
  if e.id is null or e.source<>'gmail' or e.status<>'needs_review' or (select count(*) from public.expense_documents where expense_id=e.id)<2 then raise exception 'split_unavailable'; end if;
  insert into public.expenses(user_id,vendor,category,expense_date,net_amount,vat_amount,source,status,gmail_connection_id,gmail_received_at,gmail_sender_domain,gmail_filter_reasons)
  values(auth.uid(),e.vendor,'other',e.expense_date,0,0,'gmail','needs_review',e.gmail_connection_id,e.gmail_received_at,e.gmail_sender_domain,e.gmail_filter_reasons) returning id into new_id;
  update public.expense_documents set expense_id=new_id,is_primary=true where id=d.id;
  update public.gmail_imports set expense_id=new_id where user_id=auth.uid() and expense_id=e.id and sha256=d.sha256;
  if not exists(select 1 from public.expense_documents where expense_id=e.id and is_primary) then
    update public.expense_documents set is_primary=true where id=(select id from public.expense_documents where expense_id=e.id order by created_at,id limit 1);
  end if;
  return new_id;
end; $$;

create function public.remember_gmail_vendor(p_expense_id uuid,p_action text) returns void
language plpgsql set search_path = '' as $$
declare e public.expenses;
begin
  if not public.is_owner() or auth.uid() is null or p_action not in ('always_include','ignore') then raise exception 'not_authorized'; end if;
  select * into e from public.expenses where id=p_expense_id and user_id=auth.uid();
  if e.source<>'gmail' or coalesce(e.gmail_sender_domain,'')='' then raise exception 'vendor_unavailable'; end if;
  insert into public.expense_vendor_rules(user_id,sender_domain,action,source)
  values(auth.uid(),e.gmail_sender_domain,p_action,'learned') on conflict (user_id,sender_domain) where sender_domain is not null
    do update set action=excluded.action,source='learned';
end; $$;

create function public.track_gmail_document_removal() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.gmail_imports set import_state='excluded',filter_reason='removed_by_user'
    where user_id=old.user_id and expense_id=old.expense_id and sha256=old.sha256;
  return old;
end; $$;
create trigger track_gmail_document_removal after delete on public.expense_documents
  for each row execute function public.track_gmail_document_removal();

-- Service uploads have no client owner_id. Exact import ownership and the
-- missing document reference authorize only cleanup after removal, also after
-- a split (the source path is intentionally stable).
create policy "owner cleans removed Gmail evidence" on storage.objects for delete to authenticated
using (bucket_id='expense-documents' and public.is_owner() and split_part(name,'/',1)=auth.uid()::text
  and exists(select 1 from public.gmail_imports i where i.user_id=auth.uid() and i.storage_path=name and i.import_state='excluded')
  and not exists(select 1 from public.expense_documents d where d.storage_path=name));

create function public.guard_gmail_review_booking() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.source='gmail' and new.status='booked' and
    (not new.gmail_import_complete or not new.gmail_review_confirmed or length(btrim(coalesce(new.vendor_invoice_number,'')))=0 or new.paid_date is null or new.net_amount+new.vat_amount<=0) then
    raise exception 'Confirm the Gmail document fields and amounts before booking';
  end if;
  if tg_op='UPDATE' and old.status in ('booked','voided') and
    (new.gmail_connection_id,new.gmail_message_id,new.gmail_received_at,new.gmail_sender_domain,new.gmail_filter_reasons,new.gmail_review_confirmed)
    is distinct from (old.gmail_connection_id,old.gmail_message_id,old.gmail_received_at,old.gmail_sender_domain,old.gmail_filter_reasons,old.gmail_review_confirmed) then
    raise exception 'Gmail evidence is immutable after booking';
  end if;
  return new;
end; $$;
create trigger guard_gmail_review_booking before insert or update on public.expenses
  for each row execute function public.guard_gmail_review_booking();

-- The import history survives candidate deletion, including its source IDs.
alter table public.gmail_imports drop constraint gmail_imports_expense_user_fkey,
  add constraint gmail_imports_expense_user_fkey foreign key(expense_id,user_id)
  references public.expenses(id,user_id) on delete set null (expense_id);

revoke all on function public.claim_gmail_sync(uuid),public.assert_gmail_sync_lease(uuid,uuid),public.import_gmail_candidate(uuid,uuid,jsonb),
  public.complete_gmail_candidate(uuid,uuid,text),public.finish_gmail_sync(uuid,uuid,jsonb,jsonb,text),public.fail_gmail_sync(uuid,uuid,boolean),public.gmail_object_is_unreferenced(uuid,text),public.gmail_scheduled_users(boolean)
  from public,anon,authenticated;
grant execute on function public.claim_gmail_sync(uuid),public.assert_gmail_sync_lease(uuid,uuid),public.import_gmail_candidate(uuid,uuid,jsonb),
  public.complete_gmail_candidate(uuid,uuid,text),public.finish_gmail_sync(uuid,uuid,jsonb,jsonb,text),public.fail_gmail_sync(uuid,uuid,boolean),public.gmail_object_is_unreferenced(uuid,text),public.gmail_scheduled_users(boolean) to service_role;
revoke all on function public.set_review_document_primary(uuid),public.split_gmail_expense_document(uuid),public.remember_gmail_vendor(uuid,text) from public,anon;
grant execute on function public.set_review_document_primary(uuid),public.split_gmail_expense_document(uuid),public.remember_gmail_vendor(uuid,text) to authenticated;
revoke all on function public.invalidate_gmail_sync_grant(),public.track_gmail_document_removal(),public.guard_gmail_review_booking() from public,anon,authenticated;

-- Configure Vault gmail_project_url and gmail_cron_secret during deployment.
-- With no secrets (including local tests), jobs do not send any HTTP request.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create function public.dispatch_gmail_schedule(p_mode text) returns void
language plpgsql set search_path = '' as $$
declare project_url text; cron_secret text;
begin
  if p_mode not in ('daily','queued') then raise exception 'invalid_schedule'; end if;
  if p_mode='queued' and not exists(select 1 from public.gmail_scheduled_users(true)) then return; end if;
  select decrypted_secret into project_url from vault.decrypted_secrets where name='gmail_project_url';
  select decrypted_secret into cron_secret from vault.decrypted_secrets where name='gmail_cron_secret';
  if project_url is null or length(coalesce(cron_secret,''))<32 then return; end if;
  perform net.http_post(url:=project_url||'/functions/v1/gmail-sync-scheduled',
    headers:=jsonb_build_object('Content-Type','application/json','x-gmail-cron-secret',cron_secret),body:=jsonb_build_object('mode',p_mode));
end; $$;
revoke all on function public.dispatch_gmail_schedule(text) from public,anon,authenticated,service_role;
select cron.schedule('gmail-daily-discovery','0 5 * * *',$$select public.dispatch_gmail_schedule('daily')$$);
select cron.schedule('gmail-queued-discovery','* * * * *',$$select public.dispatch_gmail_schedule('queued')$$);
