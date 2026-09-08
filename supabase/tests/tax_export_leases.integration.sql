\set ON_ERROR_STOP on
begin;

-- Run against a local database after the lease/retention migration. Everything
-- in this deterministic regression is rolled back.
do $$ begin
  if to_regprocedure('public.claim_tax_export_job(uuid,uuid,uuid)') is null then
    raise exception 'Tax export workers require an atomic lease claim';
  end if;
end $$;

insert into auth.users(id, aud, role, email) values
  ('10000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'export-lease@example.test');
insert into public.tax_export_jobs(id,user_id,tax_year,export_kind,expires_at) values
  ('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000006',2026,'issued_invoices',now()+interval '24 hours');

do $$
declare
  owner_id uuid := '10000000-0000-4000-8000-000000000006';
  job_id uuid := '60000000-0000-4000-8000-000000000001';
  token uuid := '70000000-0000-4000-8000-000000000001';
  job public.tax_export_jobs;
begin
  select * into job from public.claim_tax_export_job(job_id, owner_id, token);
  if job.status <> 'running' or job.worker_token <> token then raise exception 'worker did not acquire lease'; end if;
  if exists (select 1 from public.claim_tax_export_job(job_id, owner_id, gen_random_uuid())) then raise exception 'second worker claimed same job'; end if;
  -- Cleanup cannot claim an active lease, even if a wall clock expiry selector
  -- races an in-flight worker.
  if exists (select 1 from public.claim_tax_export_cleanup(100) where id=job_id) then raise exception 'cleanup claimed active worker'; end if;
  update public.tax_export_jobs set lease_expires_at=now()-interval '1 second' where id=job_id;
  select * into job from public.reap_tax_export_job(job_id,owner_id);
  if job.status <> 'failed' or not job.cleanup_pending then raise exception 'timeout did not record durable cleanup'; end if;
  if exists (select 1 from public.complete_tax_export_job(job_id,owner_id,token,repeat('a',64),100)) then raise exception 'late worker completed after timeout'; end if;
  if exists (select 1 from public.claim_tax_export_job(job_id, owner_id, gen_random_uuid())) then raise exception 'failed job resurrected'; end if;
  perform set_config('request.jwt.claim.role','service_role',true);
  begin
    insert into storage.objects(bucket_id,name) values('tax-exports', owner_id||'/issued_invoices-2026-'||job_id||'.zip');
    raise exception 'late upload allowed after lease revoked';
  exception when raise_exception then
    if sqlerrm = 'late upload allowed after lease revoked' then raise; end if;
  end;
  if not exists(select 1 from public.claim_tax_export_cleanup(100) where id=job_id) then raise exception 'failed job is not retryable'; end if;
  if not exists(select 1 from public.claim_tax_export_cleanup(100) where id=job_id) then raise exception 'unacknowledged cleanup stopped retrying'; end if;
  perform public.ack_tax_export_cleanup(job_id, owner_id);
  if exists(select 1 from public.tax_export_jobs where id=job_id and (cleanup_pending or storage_path is not null)) then raise exception 'cleanup acknowledgement did not clear path'; end if;
end $$;

do $$ begin
  if has_function_privilege('authenticated','public.claim_tax_export_job(uuid,uuid,uuid)','execute')
    or has_function_privilege('anon','public.complete_tax_export_job(uuid,uuid,uuid,text,bigint)','execute') then
    raise exception 'worker RPCs exposed to browser roles';
  end if;
  if not exists(select 1 from cron.job where jobname='tax-export-retention' and active) then raise exception 'retention cron not scheduled'; end if;
end $$;
rollback;
