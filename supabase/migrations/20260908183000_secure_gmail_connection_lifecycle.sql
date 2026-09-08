-- Credentials and OAuth state remain service-only. Keep disconnected rows so
-- imported documents retain their original foreign keys and deduplication keys.
alter table public.gmail_connections
  alter column access_token_encrypted drop not null,
  alter column refresh_token_encrypted drop not null,
  add column daily_sync_enabled boolean not null default false,
  add column last_failed_at timestamptz,
  add constraint gmail_active_credentials check (status <> 'active' or
    (access_token_encrypted is not null and refresh_token_encrypted is not null));
alter table public.gmail_oauth_states add column app_origin text not null default '',
  add column finalized_at timestamptz;
alter table public.gmail_connection_statuses
  add column daily_sync_enabled boolean not null default false,
  add column last_failed_at timestamptz;

create function public.project_gmail_connection_status() returns trigger
language plpgsql set search_path = '' as $$
begin
  insert into public.gmail_connection_statuses
    (connection_id, user_id, gmail_address, status, history_id, last_synced_at, daily_sync_enabled, last_failed_at)
  values (new.id, new.user_id, new.gmail_address, new.status, new.history_id, new.last_synced_at,
    new.daily_sync_enabled, new.last_failed_at)
  on conflict (user_id) do update set connection_id = excluded.connection_id,
    gmail_address = excluded.gmail_address, status = excluded.status, history_id = excluded.history_id,
    last_synced_at = excluded.last_synced_at, daily_sync_enabled = excluded.daily_sync_enabled,
    last_failed_at = excluded.last_failed_at;
  return new;
end;
$$;
create trigger project_gmail_connection_status after insert or update on public.gmail_connections
  for each row execute function public.project_gmail_connection_status();
create or replace view public.gmail_connection_status
with (security_barrier = true, security_invoker = true) as
  select connection_id as id, user_id, gmail_address, status, history_id, last_synced_at,
    created_at, updated_at, daily_sync_enabled, last_failed_at
  from public.gmail_connection_statuses where public.is_owner() and auth.uid() = user_id;

-- All lifecycle functions serialize per user. New authorization/disconnect
-- invalidates earlier pending or in-flight exchanges before they can commit.
create function public.begin_gmail_authorization(p_user_id uuid, p_state_hash text,
  p_verifier text, p_redirect_uri text, p_app_origin text)
returns void language plpgsql set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('gmail:' || p_user_id::text, 0));
  delete from public.gmail_oauth_states where user_id = p_user_id;
  insert into public.gmail_oauth_states
    (user_id, state_hash, pkce_verifier_encrypted, redirect_uri, app_origin, expires_at)
  values (p_user_id, p_state_hash, p_verifier, p_redirect_uri, p_app_origin, now() + interval '10 minutes');
end;
$$;

create function public.consume_gmail_authorization(p_user_id uuid, p_state_hash text,
  p_redirect_uri text, p_app_origin text)
returns setof public.gmail_oauth_states language plpgsql set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('gmail:' || p_user_id::text, 0));
  return query update public.gmail_oauth_states set consumed_at = clock_timestamp()
    where user_id = p_user_id and state_hash = p_state_hash and consumed_at is null
      and expires_at > clock_timestamp() and redirect_uri = p_redirect_uri and app_origin = p_app_origin
    returning *;
end;
$$;

create function public.finish_gmail_authorization(p_user_id uuid, p_state_hash text,
  p_redirect_uri text, p_app_origin text, p_address text,
  p_access_token text, p_refresh_token text, p_expires_at timestamptz)
returns void language plpgsql set search_path = '' as $$
declare v_state uuid; v_connection uuid; v_address text;
begin
  perform pg_advisory_xact_lock(hashtextextended('gmail:' || p_user_id::text, 0));
  update public.gmail_oauth_states set finalized_at = clock_timestamp(), pkce_verifier_encrypted = ''
    where user_id = p_user_id and state_hash = p_state_hash and consumed_at is not null
      and finalized_at is null and expires_at > clock_timestamp()
      and redirect_uri = p_redirect_uri and app_origin = p_app_origin
    returning id into v_state;
  if v_state is null then raise exception 'gmail_authorization_unavailable'; end if;
  select gmail_address into v_address from public.gmail_connections where user_id = p_user_id;
  -- A connection id anchors Gmail message deduplication. Never reuse it for a
  -- different mailbox (mailbox switching needs a separate migration/workflow).
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

create function public.disconnect_gmail(p_user_id uuid)
returns table(refresh_token_encrypted text) language plpgsql set search_path = '' as $$
declare v_token text;
begin
  perform pg_advisory_xact_lock(hashtextextended('gmail:' || p_user_id::text, 0));
  delete from public.gmail_oauth_states where user_id = p_user_id;
  select g.refresh_token_encrypted into v_token from public.gmail_connections g
    where g.user_id = p_user_id for update;
  update public.gmail_connections set status = 'revoked', daily_sync_enabled = false,
    access_token_encrypted = null, refresh_token_encrypted = null, token_expires_at = null,
    granted_scopes = '{}' where user_id = p_user_id;
  update public.gmail_sync_runs set status = 'failed', completed_at = clock_timestamp(),
    error_code = 'connection_disconnected', error_message = null
    where user_id = p_user_id and status in ('queued', 'running');
  return query select v_token;
end;
$$;

create function public.request_gmail_sync(p_user_id uuid)
returns uuid language plpgsql set search_path = '' as $$
declare v_connection uuid; v_run uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('gmail:' || p_user_id::text, 0));
  select id into v_connection from public.gmail_connections where user_id = p_user_id and status = 'active' for update;
  if v_connection is null then raise exception 'gmail_connection_unavailable'; end if;
  select id into v_run from public.gmail_sync_runs where connection_id = v_connection and status in ('queued', 'running') limit 1;
  if v_run is null then
    insert into public.gmail_sync_runs (user_id, connection_id, sync_kind)
      values (p_user_id, v_connection, 'manual') returning id into v_run;
  end if;
  return v_run;
end;
$$;

create function public.fail_gmail_authorization(p_user_id uuid, p_state_hash text)
returns void language plpgsql set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('gmail:' || p_user_id::text, 0));
  update public.gmail_oauth_states set finalized_at = clock_timestamp(), pkce_verifier_encrypted = ''
    where user_id = p_user_id and state_hash = p_state_hash and consumed_at is not null and finalized_at is null;
  if not found then return; end if;
  update public.gmail_connections set status = 'reauthorization_required', daily_sync_enabled = false,
    access_token_encrypted = null, refresh_token_encrypted = null, token_expires_at = null,
    last_failed_at = clock_timestamp() where user_id = p_user_id;
  update public.gmail_sync_runs set status = 'failed', completed_at = clock_timestamp(),
    error_code = 'reauthorization_required', error_message = null
    where user_id = p_user_id and status in ('queued', 'running');
end;
$$;

revoke all on function public.project_gmail_connection_status(),
  public.begin_gmail_authorization(uuid,text,text,text,text),
  public.consume_gmail_authorization(uuid,text,text,text),
  public.finish_gmail_authorization(uuid,text,text,text,text,text,text,timestamptz),
  public.disconnect_gmail(uuid), public.request_gmail_sync(uuid), public.fail_gmail_authorization(uuid,text)
  from public, anon, authenticated;
grant execute on function public.project_gmail_connection_status(),
  public.begin_gmail_authorization(uuid,text,text,text,text),
  public.consume_gmail_authorization(uuid,text,text,text),
  public.finish_gmail_authorization(uuid,text,text,text,text,text,text,timestamptz),
  public.disconnect_gmail(uuid), public.request_gmail_sync(uuid), public.fail_gmail_authorization(uuid,text) to service_role;
grant all on public.gmail_connections, public.gmail_oauth_states,
  public.gmail_connection_statuses, public.gmail_sync_runs to service_role;
