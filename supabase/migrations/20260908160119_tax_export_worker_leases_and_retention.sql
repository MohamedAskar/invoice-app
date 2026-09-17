-- A job has exactly one worker lease; failed/expired jobs are never reclaimed.
-- Durable deadlines allow database cron to recover even if every Edge catch
-- handler is interrupted or its database requests fail.
alter table public.tax_export_jobs
  add column worker_token uuid,
  add column lease_expires_at timestamptz not null default (now() + interval '10 minutes'),
  add column cleanup_pending boolean not null default false;

update public.tax_export_jobs set lease_expires_at = requested_at + interval '10 minutes';
create index tax_export_jobs_recovery_idx on public.tax_export_jobs(lease_expires_at)
  where status in ('queued','running');
create index tax_export_jobs_cleanup_idx on public.tax_export_jobs(expires_at)
  where cleanup_pending or status='completed';

create function public.claim_tax_export_job(p_id uuid,p_user_id uuid,p_token uuid)
returns setof public.tax_export_jobs language sql volatile security invoker set search_path='' as $$
  update public.tax_export_jobs set status='running', worker_token=p_token,
    storage_path=user_id::text || '/' || case export_kind when 'expenses' then 'business_expenses' else export_kind end || '-' || tax_year || '-' || id || '.zip'
  where id=p_id and user_id=p_user_id and status='queued' and worker_token is null
    and lease_expires_at>clock_timestamp() and expires_at>clock_timestamp()
  returning *;
$$;

create function public.complete_tax_export_job(p_id uuid,p_user_id uuid,p_token uuid,p_sha256 text,p_byte_size bigint)
returns setof public.tax_export_jobs language sql volatile security invoker set search_path='' as $$
  update public.tax_export_jobs set status='completed', completed_at=clock_timestamp(),
    sha256=p_sha256, byte_size=p_byte_size, error_code=null, error_message=null, worker_token=null
  where id=p_id and user_id=p_user_id and status='running' and worker_token=p_token
    and lease_expires_at>clock_timestamp() and expires_at>clock_timestamp() and not cleanup_pending
  returning *;
$$;

create function public.fail_tax_export_job(p_id uuid,p_user_id uuid,p_token uuid,p_error_code text)
returns setof public.tax_export_jobs language plpgsql volatile security invoker set search_path='' as $$
begin
  update public.tax_export_jobs set status='failed', completed_at=clock_timestamp(), worker_token=null,
    cleanup_pending=true, error_code=p_error_code,
    error_message='Could not create the export. Check your documents and try again.'
  where id=p_id and user_id=p_user_id and status in ('queued','running')
    and (worker_token=p_token or (status='queued' and worker_token is null));
  -- Return the authoritative state after a lost/ambiguous completion response.
  -- In particular, never delete a ZIP whose completion already committed.
  return query select * from public.tax_export_jobs where id=p_id and user_id=p_user_id;
end;
$$;

create function public.reap_tax_export_job(p_id uuid,p_user_id uuid)
returns setof public.tax_export_jobs language plpgsql volatile security invoker set search_path='' as $$
begin
  update public.tax_export_jobs set status='failed', completed_at=clock_timestamp(), worker_token=null,
    cleanup_pending=true, error_code='export_timeout',
    error_message='Could not create the export. Check your documents and try again.'
  where id=p_id and user_id=p_user_id and status in ('queued','running') and lease_expires_at<=clock_timestamp();
  return query select * from public.tax_export_jobs where id=p_id and user_id=p_user_id;
end;
$$;

create function public.claim_tax_export_cleanup(p_limit integer default 100)
returns setof public.tax_export_jobs language sql volatile security invoker set search_path='' as $$
  with candidates as (
    select id from public.tax_export_jobs
    where (status in ('queued','running') and lease_expires_at<=clock_timestamp())
      or (status='completed' and expires_at<=clock_timestamp())
      or (status in ('failed','expired') and cleanup_pending)
    order by expires_at,id for update skip locked limit least(greatest(p_limit,1),100)
  )
  update public.tax_export_jobs j set
    status=case when j.status in ('completed','expired') then 'expired' else 'failed' end,
    completed_at=coalesce(j.completed_at,clock_timestamp()), cleanup_pending=true, worker_token=null,
    error_code=case when j.status in ('queued','running') then 'export_timeout' else j.error_code end
  from candidates c where j.id=c.id returning j.*;
$$;

create function public.ack_tax_export_cleanup(p_id uuid,p_user_id uuid)
returns setof public.tax_export_jobs language sql volatile security invoker set search_path='' as $$
  update public.tax_export_jobs set cleanup_pending=false,storage_path=null
  where id=p_id and user_id=p_user_id and status in ('failed','expired') and worker_token is null
  returning *;
$$;

revoke all on function public.claim_tax_export_job(uuid,uuid,uuid),
  public.complete_tax_export_job(uuid,uuid,uuid,text,bigint),
  public.fail_tax_export_job(uuid,uuid,uuid,text), public.reap_tax_export_job(uuid,uuid),
  public.claim_tax_export_cleanup(integer), public.ack_tax_export_cleanup(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.claim_tax_export_job(uuid,uuid,uuid),
  public.complete_tax_export_job(uuid,uuid,uuid,text,bigint),
  public.fail_tax_export_job(uuid,uuid,uuid,text), public.reap_tax_export_job(uuid,uuid),
  public.claim_tax_export_cleanup(integer), public.ack_tax_export_cleanup(uuid,uuid) to service_role;

-- Storage metadata writes serialize on the same job lock as lease revocation.
-- Therefore a late worker cannot recreate an object after cleanup acknowledged
-- deletion, even if its earlier upload request was delayed in the network.
create function finance_private.guard_tax_export_upload()
returns trigger language plpgsql security invoker set search_path='' as $$
declare
  target_id uuid;
  job public.tax_export_jobs;
begin
  if tg_op='UPDATE' and old.bucket_id='tax-exports' and new.bucket_id<>'tax-exports' then
    raise exception 'Tax export objects cannot be moved';
  end if;
  if new.bucket_id<>'tax-exports' then return new; end if;
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Tax export uploads require a server worker'; end if;
  begin
    target_id := substring(new.name from '([0-9a-f-]{36})[.]zip$')::uuid;
  exception when invalid_text_representation then
    raise exception 'Invalid tax export path';
  end;
  select * into job from public.tax_export_jobs where id=target_id for update;
  if not found or job.status<>'running' or job.worker_token is null
    or job.lease_expires_at<=clock_timestamp() or job.expires_at<=clock_timestamp()
    or job.cleanup_pending or new.name is distinct from job.storage_path then
    raise exception 'Tax export worker lease is inactive';
  end if;
  return new;
end;
$$;
revoke all on function finance_private.guard_tax_export_upload() from public,anon,authenticated;
create trigger guard_tax_export_upload before insert or update on storage.objects
  for each row execute function finance_private.guard_tax_export_upload();

-- Even a caller using Storage directly cannot mint fresh links after expiry
-- or access the uploaded ZIP before its worker atomically completes the job.
drop policy "owner reads finance storage" on storage.objects;
create policy "owner reads finance storage" on storage.objects for select to authenticated using (
  public.is_owner() and (storage.foldername(name))[1]=auth.uid()::text and (
    bucket_id in ('expense-documents','issued-invoices') or (
      bucket_id='tax-exports' and exists (
        select 1 from public.tax_export_jobs j where j.user_id=auth.uid()
          and j.storage_path=name and j.status='completed' and j.expires_at>now()
      )
    )
  )
);

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create function finance_private.reap_stale_tax_export_leases()
returns bigint language sql volatile security invoker set search_path='' as $$
  with stale as (
    update public.tax_export_jobs set status='failed', completed_at=clock_timestamp(),
      worker_token=null,cleanup_pending=true,error_code='export_timeout',
      error_message='Could not create the export. Check your documents and try again.'
    where status in ('queued','running') and lease_expires_at<=clock_timestamp()
    returning id
  ) select count(*) from stale;
$$;

create function finance_private.tax_export_retention_preflight()
returns void language plpgsql security invoker set search_path='' as $$
declare project_url text; server_key text;
begin
  select decrypted_secret into project_url from vault.decrypted_secrets where name='tax_export_project_url';
  select decrypted_secret into server_key from vault.decrypted_secrets where name='tax_export_service_role_key';
  if project_url is null or project_url !~ '^https://[^/]+/?$' then
    raise exception 'Tax export retention requires Vault secret tax_export_project_url containing the HTTPS project API origin';
  end if;
  if server_key is null or server_key !~ '^[A-Za-z0-9_-]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+$' then
    raise exception 'Tax export retention requires Vault secret tax_export_service_role_key containing the legacy service-role JWT';
  end if;
end;
$$;

create function finance_private.dispatch_tax_export_retention()
returns bigint language plpgsql security invoker set search_path='' as $$
declare request_id bigint;
begin
  perform finance_private.tax_export_retention_preflight();
  select net.http_post(
    url := (select rtrim(decrypted_secret,'/') from vault.decrypted_secrets where name='tax_export_project_url') || '/functions/v1/create-tax-export',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' ||
      (select decrypted_secret from vault.decrypted_secrets where name='tax_export_service_role_key')),
    body := '{"mode":"cleanup"}'::jsonb,timeout_milliseconds := 60000
  ) into request_id;
  return request_id;
end;
$$;
revoke all on function finance_private.reap_stale_tax_export_leases(),
  finance_private.tax_export_retention_preflight(),finance_private.dispatch_tax_export_retention()
  from public,anon,authenticated,service_role;

-- These schedules are installed by the migration. Missing Vault configuration
-- fails clearly in cron.job_run_details; it never sends an unauthenticated call.
-- The database-only reaper works regardless of Vault/Edge/network availability.
select cron.schedule('tax-export-lease-recovery','* * * * *',
  'select finance_private.reap_stale_tax_export_leases()');
select cron.schedule('tax-export-retention','*/5 * * * *',
  'select finance_private.dispatch_tax_export_retention()');
