-- A cleanup decision survives its RPC transaction. The shared Gmail lease lock
-- waits for an in-flight import; a tombstone also excludes an import that has
-- not reached that lock yet when an ambiguous HTTP response triggers cleanup.
create table finance_private.gmail_object_cleanup (
  storage_path text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index gmail_object_cleanup_user_idx on finance_private.gmail_object_cleanup(user_id);
alter table finance_private.gmail_object_cleanup enable row level security;
revoke all on finance_private.gmail_object_cleanup from public,anon,authenticated;
grant usage on schema finance_private to service_role;
grant select,insert on finance_private.gmail_object_cleanup to service_role;

create or replace function public.gmail_object_is_unreferenced(p_user_id uuid,p_path text) returns boolean
language plpgsql volatile set search_path='' as $$
begin
  if p_path is null or p_path not like p_user_id::text||'/gmail/%' then return false; end if;
  -- Must exactly match assert_gmail_sync_lease/import_gmail_candidate.
  perform pg_advisory_xact_lock(hashtextextended('gmail:'||p_user_id::text,0));
  if exists(select 1 from public.expense_documents where storage_path=p_path) then return false; end if;
  insert into finance_private.gmail_object_cleanup(storage_path,user_id)
    values(p_path,p_user_id) on conflict(storage_path) do nothing;
  return true;
end; $$;

create function finance_private.guard_gmail_document_path() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if split_part(new.storage_path,'/',2)='gmail' then
    perform pg_advisory_xact_lock(hashtextextended('gmail:'||new.user_id::text,0));
    if split_part(new.storage_path,'/',1)<>new.user_id::text or exists(
      select 1 from finance_private.gmail_object_cleanup where storage_path=new.storage_path
    ) then raise exception 'gmail_document_unavailable'; end if;
  end if;
  return new;
end; $$;
revoke all on function finance_private.guard_gmail_document_path() from public,anon,authenticated;
create trigger guard_gmail_document_path before insert or update of storage_path,user_id on public.expense_documents
  for each row execute function finance_private.guard_gmail_document_path();

create or replace function public.gmail_scheduled_users(p_queued_only boolean) returns table(user_id uuid)
language sql stable set search_path='' as $$
  select c.user_id from public.gmail_connections c where c.status='active'
    and (c.sync_lease_until is null or c.sync_lease_until<now())
    and case when p_queued_only then exists(select 1 from public.gmail_sync_runs r where r.connection_id=c.id and r.status='queued')
      else c.daily_sync_enabled end
    order by c.last_synced_at nulls first limit 20;
$$;

-- Persist only generic source-level failures, never provider responses/bodies.
create function public.record_gmail_item_error(p_user_id uuid,p_run_id uuid,p_message_id text,p_attachment_id text) returns void
language plpgsql set search_path='' as $$
declare c public.gmail_connections;
begin
  perform public.assert_gmail_sync_lease(p_user_id,p_run_id);
  select * into c from public.gmail_connections where user_id=p_user_id;
  insert into public.gmail_imports(user_id,connection_id,sync_run_id,gmail_message_id,gmail_attachment_id,filter_reason,import_state)
    values(p_user_id,c.id,p_run_id,p_message_id,coalesce(p_attachment_id,''),'provider_item_failed','failed')
    on conflict(connection_id,gmail_message_id,gmail_attachment_id) do nothing;
end; $$;
revoke all on function public.record_gmail_item_error(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.record_gmail_item_error(uuid,uuid,text,text) to service_role;

create or replace function public.split_gmail_expense_document(p_document_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare e public.expenses; d public.expense_documents; new_id uuid;
begin
  if not public.is_owner() or auth.uid() is null then raise exception 'not_authorized'; end if;
  -- Read only a parent identity to acquire its lock. All document membership
  -- and count decisions happen in fresh statements after the lock is held.
  select * into e from public.expenses where user_id=auth.uid() and id=(
    select expense_id from public.expense_documents where id=p_document_id and user_id=auth.uid()
  ) for update;
  select * into d from public.expense_documents where id=p_document_id and user_id=auth.uid() and expense_id=e.id;
  if d.id is null or e.id is null or e.source<>'gmail' or e.status<>'needs_review'
    or (select count(*) from public.expense_documents where expense_id=e.id)<2 then raise exception 'split_unavailable'; end if;
  insert into public.expenses(user_id,vendor,category,expense_date,net_amount,vat_amount,source,status,gmail_connection_id,gmail_received_at,gmail_sender_domain,gmail_filter_reasons,gmail_import_complete)
  values(auth.uid(),e.vendor,'other',e.expense_date,0,0,'gmail','needs_review',e.gmail_connection_id,e.gmail_received_at,e.gmail_sender_domain,e.gmail_filter_reasons,e.gmail_import_complete) returning id into new_id;
  update public.expense_documents set expense_id=new_id,is_primary=true where id=d.id and expense_id=e.id;
  update public.gmail_imports set expense_id=new_id where user_id=auth.uid() and storage_path=d.storage_path;
  if not exists(select 1 from public.expense_documents where expense_id=e.id and is_primary) then
    update public.expense_documents set is_primary=true where id=(select id from public.expense_documents where expense_id=e.id order by created_at,id limit 1);
  end if;
  return new_id;
end; $$;

create or replace function public.set_review_document_primary(p_document_id uuid) returns setof public.expense_documents
language plpgsql set search_path='' as $$
declare v_expense_id uuid;
begin
  if not public.is_owner() or auth.uid() is null then raise exception 'not_authorized'; end if;
  select e.id into v_expense_id from public.expenses e where e.user_id=auth.uid() and e.status='needs_review'
    and e.id=(select d.expense_id from public.expense_documents d where d.id=p_document_id and d.user_id=auth.uid()) for update;
  if v_expense_id is null or not exists(select 1 from public.expense_documents where id=p_document_id and expense_id=v_expense_id and user_id=auth.uid()) then
    raise exception 'primary_unavailable';
  end if;
  update public.expense_documents d set is_primary=false where d.expense_id=v_expense_id and d.is_primary;
  return query update public.expense_documents d set is_primary=true where d.id=p_document_id and d.expense_id=v_expense_id returning *;
end; $$;
