-- Network revocation must own a persisted lifecycle, not outlive local erasure
-- and race a new Google grant. No automatic lease takeover: a delayed worker
-- cannot be fenced at Google's grant-wide revocation endpoint.
alter table public.gmail_connections drop constraint gmail_connections_status_check,
  add constraint gmail_connections_status_check
    check (status in ('active', 'reauthorization_required', 'revoked', 'error', 'disconnecting')),
  add constraint gmail_schedule_requires_active check (not daily_sync_enabled or status = 'active');
alter table public.gmail_connection_statuses drop constraint gmail_connection_statuses_status_check,
  add constraint gmail_connection_statuses_status_check
    check (status in ('active', 'reauthorization_required', 'revoked', 'error', 'disconnecting'));

create table public.gmail_disconnect_jobs (
  user_id uuid primary key references auth.users(id) on delete restrict,
  connection_id uuid not null references public.gmail_connections(id) on delete cascade,
  refresh_token_encrypted text not null,
  attempt_id uuid,
  requested_at timestamptz not null default clock_timestamp(),
  claimed_at timestamptz,
  last_failed_at timestamptz,
  last_outcome text check (last_outcome in ('retry', 'uncertain')),
  constraint gmail_disconnect_claim_check check ((attempt_id is null) = (claimed_at is null))
);
alter table public.gmail_disconnect_jobs enable row level security;
revoke all on public.gmail_disconnect_jobs from public, anon, authenticated;
grant all on public.gmail_disconnect_jobs to service_role;

create or replace function public.begin_gmail_authorization(p_user_id uuid, p_state_hash text,
  p_verifier text, p_redirect_uri text, p_app_origin text)
returns void language plpgsql set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('gmail:' || p_user_id::text, 0));
  if exists (select 1 from public.gmail_disconnect_jobs where user_id = p_user_id) then
    raise exception 'gmail_disconnect_pending';
  end if;
  delete from public.gmail_oauth_states where user_id = p_user_id;
  insert into public.gmail_oauth_states
    (user_id, state_hash, pkce_verifier_encrypted, redirect_uri, app_origin, expires_at)
  values (p_user_id, p_state_hash, p_verifier, p_redirect_uri, p_app_origin, now() + interval '10 minutes');
end;
$$;

create or replace function public.consume_gmail_authorization(p_user_id uuid, p_state_hash text,
  p_redirect_uri text, p_app_origin text)
returns setof public.gmail_oauth_states language plpgsql set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('gmail:' || p_user_id::text, 0));
  if exists (select 1 from public.gmail_disconnect_jobs where user_id = p_user_id) then return; end if;
  return query update public.gmail_oauth_states set consumed_at = clock_timestamp()
    where user_id = p_user_id and state_hash = p_state_hash and consumed_at is null
      and expires_at > clock_timestamp() and redirect_uri = p_redirect_uri and app_origin = p_app_origin
    returning *;
end;
$$;

create or replace function public.finish_gmail_authorization(p_user_id uuid, p_state_hash text,
  p_redirect_uri text, p_app_origin text, p_address text,
  p_access_token text, p_refresh_token text, p_expires_at timestamptz)
returns void language plpgsql set search_path = '' as $$
declare v_state uuid; v_connection uuid; v_address text;
begin
  perform pg_advisory_xact_lock(hashtextextended('gmail:' || p_user_id::text, 0));
  if exists (select 1 from public.gmail_disconnect_jobs where user_id = p_user_id) then
    raise exception 'gmail_authorization_unavailable';
  end if;
  update public.gmail_oauth_states set finalized_at = clock_timestamp(), pkce_verifier_encrypted = ''
    where user_id = p_user_id and state_hash = p_state_hash and consumed_at is not null
      and finalized_at is null and expires_at > clock_timestamp()
      and redirect_uri = p_redirect_uri and app_origin = p_app_origin
    returning id into v_state;
  if v_state is null then raise exception 'gmail_authorization_unavailable'; end if;
  select gmail_address into v_address from public.gmail_connections where user_id = p_user_id;
  if v_address is not null and v_address <> p_address then raise exception 'gmail_account_mismatch'; end if;
  insert into public.gmail_connections
    (user_id, gmail_address, access_token_encrypted, refresh_token_encrypted, token_expires_at,
      granted_scopes, status, daily_sync_enabled)
  values (p_user_id, p_address, p_access_token, p_refresh_token, p_expires_at,
    array['https://www.googleapis.com/auth/gmail.readonly'], 'active', true)
  on conflict (user_id) do update set access_token_encrypted = excluded.access_token_encrypted,
    refresh_token_encrypted = excluded.refresh_token_encrypted, token_expires_at = excluded.token_expires_at,
    granted_scopes = excluded.granted_scopes, status = 'active', daily_sync_enabled = true
  returning id into v_connection;
  if not exists (select 1 from public.gmail_sync_runs where connection_id = v_connection
      and (status in ('queued', 'running') or (sync_kind = 'historical' and status = 'completed'))) then
    insert into public.gmail_sync_runs (user_id, connection_id, sync_kind)
      values (p_user_id, v_connection, 'historical');
  end if;
end;
$$;

drop function public.disconnect_gmail(uuid);
create function public.disconnect_gmail(p_user_id uuid)
returns table(attempt_id uuid, refresh_token_encrypted text) language plpgsql set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('gmail:' || p_user_id::text, 0));
  delete from public.gmail_oauth_states where user_id = p_user_id;
  insert into public.gmail_disconnect_jobs (user_id, connection_id, refresh_token_encrypted)
    select g.user_id, g.id, g.refresh_token_encrypted from public.gmail_connections g
    where g.user_id = p_user_id and g.refresh_token_encrypted is not null
    on conflict (user_id) do nothing;
  update public.gmail_connections set status = case
      when exists (select 1 from public.gmail_disconnect_jobs where user_id = p_user_id) then 'disconnecting' else 'revoked' end,
    daily_sync_enabled = false, access_token_encrypted = null, refresh_token_encrypted = null,
    token_expires_at = null, granted_scopes = '{}' where user_id = p_user_id;
  update public.gmail_sync_runs set status = 'failed', completed_at = clock_timestamp(),
    error_code = 'connection_disconnected', error_message = null
    where user_id = p_user_id and status in ('queued', 'running');
  -- Duplicate requests return no credential while an attempt is in flight.
  return query update public.gmail_disconnect_jobs j
    set attempt_id = gen_random_uuid(), claimed_at = clock_timestamp()
    where j.user_id = p_user_id and j.attempt_id is null
    returning j.attempt_id, j.refresh_token_encrypted;
end;
$$;

create function public.finish_gmail_disconnect(p_user_id uuid, p_attempt_id uuid, p_outcome text)
returns void language plpgsql set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('gmail:' || p_user_id::text, 0));
  if p_outcome is null or p_outcome not in ('revoked', 'retry', 'uncertain', 'key_unavailable') then
    raise exception 'gmail_invalid_revocation_outcome';
  end if;
  perform 1 from public.gmail_disconnect_jobs where user_id = p_user_id and attempt_id = p_attempt_id for update;
  if not found then raise exception 'gmail_disconnect_attempt_unavailable'; end if;
  if p_outcome in ('revoked', 'key_unavailable') then
    -- Key loss means revocation was impossible, with no request in flight.
    -- Final erasure and reopening authorization happen in the same transaction.
    delete from public.gmail_disconnect_jobs where user_id = p_user_id;
    update public.gmail_connections set status = 'revoked' where user_id = p_user_id;
  else
    update public.gmail_disconnect_jobs set last_outcome = p_outcome, last_failed_at = clock_timestamp(),
      attempt_id = case when p_outcome = 'retry' then null else attempt_id end,
      claimed_at = case when p_outcome = 'retry' then null else claimed_at end
      where user_id = p_user_id;
    update public.gmail_connections set last_failed_at = clock_timestamp() where user_id = p_user_id;
  end if;
end;
$$;

revoke all on function public.disconnect_gmail(uuid), public.finish_gmail_disconnect(uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.disconnect_gmail(uuid), public.finish_gmail_disconnect(uuid,uuid,text) to service_role;
