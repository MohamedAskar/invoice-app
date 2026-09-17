-- A transient provider failure is not a deduplication record. The worker keeps
-- failures private and retries a bounded page of source message IDs before it
-- advances normal discovery again.
create or replace function public.import_gmail_candidate(p_user_id uuid,p_run_id uuid,p_candidate jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare c public.gmail_connections; e public.expenses; d jsonb; v_document uuid; n integer:=0; skipped integer:=0; created integer:=0; v_primary boolean;
begin
  perform public.assert_gmail_sync_lease(p_user_id,p_run_id);
  select * into c from public.gmail_connections where user_id=p_user_id;
  if jsonb_array_length(p_candidate->'documents')>200 then raise exception 'gmail_candidate_too_large'; end if;
  select * into e from public.expenses where gmail_connection_id=c.id and gmail_message_id=p_candidate->>'messageId' for update;
  if e.id is not null and e.status<>'needs_review' then raise exception 'gmail_candidate_already_reviewed'; end if;
  for d in select value from jsonb_array_elements(p_candidate->'documents') loop
    -- Replace only a generic prior provider failure. Every successful,
    -- duplicate, excluded, or user-removed source remains terminal dedup.
    delete from public.gmail_imports where connection_id=c.id and gmail_message_id=p_candidate->>'messageId'
      and gmail_attachment_id=d->>'attachmentId' and import_state='failed';
    if exists(select 1 from public.gmail_imports where connection_id=c.id and gmail_message_id=p_candidate->>'messageId' and gmail_attachment_id=d->>'attachmentId') then skipped:=skipped+1; continue; end if;
    if exists(select 1 from public.expense_documents where user_id=p_user_id and sha256=d->>'sha256') then
      insert into public.gmail_imports(user_id,connection_id,sync_run_id,gmail_message_id,gmail_attachment_id,sha256,filter_reason,import_state)
      values(p_user_id,c.id,p_run_id,p_candidate->>'messageId',d->>'attachmentId',d->>'sha256','duplicate_checksum','duplicate');
      skipped:=skipped+1; continue;
    end if;
    if e.id is null then
      insert into public.expenses(user_id,vendor,category,expense_date,net_amount,vat_amount,source,status,gmail_connection_id,gmail_message_id,gmail_received_at,gmail_sender_domain,gmail_multiple_possible_invoices,gmail_ignored_count,gmail_skipped_count,gmail_import_complete)
      values(p_user_id,p_candidate->>'vendor','other',(p_candidate->>'receivedAt')::timestamptz::date,0,0,'gmail','needs_review',c.id,p_candidate->>'messageId',(p_candidate->>'receivedAt')::timestamptz,p_candidate->>'senderDomain',(p_candidate->>'multiple')::boolean,(p_candidate->>'ignored')::integer,(p_candidate->>'skipped')::integer,coalesce((p_candidate->>'complete')::boolean,true)) returning * into e;
      created:=1;
    end if;
    v_primary := (d->>'primary')::boolean and not exists(select 1 from public.expense_documents where expense_id=e.id and is_primary);
    begin
      insert into public.expense_documents(user_id,expense_id,document_role,is_primary,storage_path,filename,declared_mime_type,detected_mime_type,byte_size,sha256)
      values(p_user_id,e.id,d->>'role',v_primary,d->>'storagePath',d->>'filename',d->>'declaredMime',d->>'detectedMime',(d->>'byteSize')::bigint,d->>'sha256') returning id into v_document;
    exception when unique_violation then skipped:=skipped+1; continue;
    end;
    insert into public.gmail_imports(user_id,connection_id,sync_run_id,gmail_message_id,gmail_attachment_id,gmail_thread_id,sender_email,sender_domain,received_at,attachment_filename,declared_mime_type,detected_mime_type,byte_size,sha256,storage_path,expense_id,document_role,matched_vendor_rule_id,filter_reason,import_state)
    values(p_user_id,c.id,p_run_id,p_candidate->>'messageId',d->>'attachmentId',p_candidate->>'threadId',p_candidate->>'senderEmail',p_candidate->>'senderDomain',(p_candidate->>'receivedAt')::timestamptz,d->>'filename',d->>'declaredMime',d->>'detectedMime',(d->>'byteSize')::bigint,d->>'sha256',d->>'storagePath',e.id,d->>'role',(d->>'ruleId')::uuid,d->>'reason','needs_review');
    update public.expenses set gmail_filter_reasons=array(select distinct unnest(gmail_filter_reasons||array[d->>'reason'])) where id=e.id;
    n:=n+1;
  end loop;
  if created=1 and n=0 then delete from public.expenses where id=e.id; created:=0; end if;
  if e.id is not null and n>0 then update public.expenses set gmail_import_complete=coalesce((p_candidate->>'complete')::boolean,true) where id=e.id; end if;
  return jsonb_build_object('candidates',created,'documents',n,'skipped',skipped);
end;
$$;

create or replace function public.split_gmail_expense_document(p_document_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare e public.expenses; d public.expense_documents; new_id uuid;
begin
  if not public.is_owner() or auth.uid() is null then raise exception 'not_authorized'; end if;
  select * into e from public.expenses where user_id=auth.uid() and id=(select expense_id from public.expense_documents where id=p_document_id and user_id=auth.uid()) for update;
  select * into d from public.expense_documents where id=p_document_id and user_id=auth.uid() and expense_id=e.id;
  if d.id is null or e.id is null or e.source<>'gmail' or e.status<>'needs_review' or not e.gmail_import_complete
    or (select count(*) from public.expense_documents where expense_id=e.id)<2 then raise exception 'split_unavailable'; end if;
  insert into public.expenses(user_id,vendor,category,expense_date,net_amount,vat_amount,source,status,gmail_connection_id,gmail_received_at,gmail_sender_domain,gmail_filter_reasons,gmail_import_complete)
  values(auth.uid(),e.vendor,'other',e.expense_date,0,0,'gmail','needs_review',e.gmail_connection_id,e.gmail_received_at,e.gmail_sender_domain,e.gmail_filter_reasons,true) returning id into new_id;
  update public.expense_documents set expense_id=new_id,is_primary=true where id=d.id and expense_id=e.id;
  update public.gmail_imports set expense_id=new_id where user_id=auth.uid() and storage_path=d.storage_path;
  if not exists(select 1 from public.expense_documents where expense_id=e.id and is_primary) then update public.expense_documents set is_primary=true where id=(select id from public.expense_documents where expense_id=e.id order by created_at,id limit 1); end if;
  return new_id;
end;
$$;
