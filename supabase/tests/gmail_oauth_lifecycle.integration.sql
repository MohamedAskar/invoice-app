-- Local synthetic records only; every fixture and owner override is rolled back.
begin;
create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%', message; end if; end;
$$;
create or replace function public.is_owner() returns boolean language sql stable set search_path = '' as $$
  select auth.uid() = '11111111-1111-1111-1111-111111111111'::uuid;
$$;
insert into auth.users (id, aud, role, email) values
  ('11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'owner@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'other@example.test');
select pg_temp.assert_true(not has_table_privilege('authenticated', 'public.gmail_connections', 'SELECT'), 'client can read credentials');
select pg_temp.assert_true(not has_table_privilege('authenticated', 'public.gmail_oauth_states', 'SELECT'), 'client can read state');
select pg_temp.assert_true(not has_table_privilege('authenticated', 'public.gmail_disconnect_jobs', 'SELECT'), 'client can read revocation credentials');
select pg_temp.assert_true(not has_table_privilege('anon', 'public.gmail_disconnect_jobs', 'SELECT'), 'anonymous can read revocation credentials');
select pg_temp.assert_true((select relrowsecurity from pg_class where oid='public.gmail_disconnect_jobs'::regclass), 'revocation work lacks RLS');
select pg_temp.assert_true(not has_function_privilege('authenticated', 'public.finish_gmail_disconnect(uuid,uuid,text)', 'EXECUTE'), 'client can release disconnect lock');
select pg_temp.assert_true(not has_function_privilege('authenticated', 'public.disconnect_gmail(uuid)', 'EXECUTE'), 'client can bypass handler');
select pg_temp.assert_true(not has_function_privilege('anon', 'public.consume_gmail_authorization(uuid,text,text,text)', 'EXECUTE'), 'anonymous can consume state');
set local role service_role;
select public.begin_gmail_authorization('11111111-1111-1111-1111-111111111111', repeat('a',64), 'synthetic-pkce', 'https://project.example/functions/v1/gmail-callback', 'https://app.example');
select pg_temp.assert_true((select count(*) = 0 from public.consume_gmail_authorization('22222222-2222-2222-2222-222222222222', repeat('a',64), 'https://project.example/functions/v1/gmail-callback', 'https://app.example')), 'wrong user accepted');
select pg_temp.assert_true((select count(*) = 0 from public.consume_gmail_authorization('11111111-1111-1111-1111-111111111111', repeat('a',64), 'https://evil.example', 'https://app.example')), 'wrong callback accepted');
select pg_temp.assert_true((select count(*) = 0 from public.consume_gmail_authorization('11111111-1111-1111-1111-111111111111', repeat('a',64), 'https://project.example/functions/v1/gmail-callback', 'https://evil.example')), 'wrong origin accepted');
update public.gmail_oauth_states set created_at = now() - interval '2 minutes', expires_at = now() - interval '1 minute';
select pg_temp.assert_true((select count(*) = 0 from public.consume_gmail_authorization('11111111-1111-1111-1111-111111111111', repeat('a',64), 'https://project.example/functions/v1/gmail-callback', 'https://app.example')), 'expired state accepted');
select public.begin_gmail_authorization('11111111-1111-1111-1111-111111111111', repeat('b',64), 'synthetic-pkce', 'https://project.example/functions/v1/gmail-callback', 'https://app.example');
select pg_temp.assert_true((select count(*) = 1 from public.consume_gmail_authorization('11111111-1111-1111-1111-111111111111', repeat('b',64), 'https://project.example/functions/v1/gmail-callback', 'https://app.example')), 'valid state rejected');
select pg_temp.assert_true((select count(*) = 0 from public.consume_gmail_authorization('11111111-1111-1111-1111-111111111111', repeat('b',64), 'https://project.example/functions/v1/gmail-callback', 'https://app.example')), 'state replay accepted');
select public.finish_gmail_authorization('11111111-1111-1111-1111-111111111111', repeat('b',64), 'https://project.example/functions/v1/gmail-callback', 'https://app.example', 'owner@example.test', 'synthetic-encrypted-access', 'synthetic-encrypted-refresh', now()+interval '1 hour');
select pg_temp.assert_true((select status = 'active' and daily_sync_enabled from public.gmail_connection_statuses), 'projection not updated atomically');
select public.request_gmail_sync('11111111-1111-1111-1111-111111111111');
select public.request_gmail_sync('11111111-1111-1111-1111-111111111111');
select pg_temp.assert_true((select count(*) = 1 from public.gmail_sync_runs), 'duplicate queued sync');
insert into public.gmail_imports (user_id, connection_id, gmail_message_id, filter_reason)
  select user_id, id, 'synthetic-message', 'test receipt' from public.gmail_connections;
select public.begin_gmail_authorization('11111111-1111-1111-1111-111111111111', repeat('c',64), 'synthetic-pkce', 'https://project.example/functions/v1/gmail-callback', 'https://app.example');
select count(*) from public.consume_gmail_authorization('11111111-1111-1111-1111-111111111111', repeat('c',64), 'https://project.example/functions/v1/gmail-callback', 'https://app.example');
select public.fail_gmail_authorization('11111111-1111-1111-1111-111111111111', repeat('c',64));
select pg_temp.assert_true((select status = 'reauthorization_required' and not daily_sync_enabled and last_failed_at is not null from public.gmail_connection_statuses), 'exchange failure did not stop scheduling');
select pg_temp.assert_true((select access_token_encrypted is null and refresh_token_encrypted is null from public.gmail_connections), 'failure retained access');
select public.begin_gmail_authorization('11111111-1111-1111-1111-111111111111', repeat('d',64), 'synthetic-pkce', 'https://project.example/functions/v1/gmail-callback', 'https://app.example');
select count(*) from public.consume_gmail_authorization('11111111-1111-1111-1111-111111111111', repeat('d',64), 'https://project.example/functions/v1/gmail-callback', 'https://app.example');
select public.finish_gmail_authorization('11111111-1111-1111-1111-111111111111', repeat('d',64), 'https://project.example/functions/v1/gmail-callback', 'https://app.example', 'owner@example.test', 'synthetic-encrypted-access', 'synthetic-encrypted-refresh', now()+interval '1 hour');
select public.begin_gmail_authorization('11111111-1111-1111-1111-111111111111', repeat('e',64), 'synthetic-pkce', 'https://project.example/functions/v1/gmail-callback', 'https://app.example');
select count(*) from public.consume_gmail_authorization('11111111-1111-1111-1111-111111111111', repeat('e',64), 'https://project.example/functions/v1/gmail-callback', 'https://app.example');
select pg_temp.assert_true((select refresh_token_encrypted = 'synthetic-encrypted-refresh' from public.disconnect_gmail('11111111-1111-1111-1111-111111111111')), 'revocation credential not returned to service');
select pg_temp.assert_true((select access_token_encrypted is null and refresh_token_encrypted is null and status = 'disconnecting' and not daily_sync_enabled from public.gmail_connections), 'disconnect retained usable credentials');
select pg_temp.assert_true((select count(*) = 0 from public.disconnect_gmail('11111111-1111-1111-1111-111111111111')), 'duplicate revoke claim');
select pg_temp.assert_true((select status = 'disconnecting' and not daily_sync_enabled from public.gmail_connection_statuses), 'pending revocation shown as active');
select pg_temp.assert_true((select count(*) = 0 from public.gmail_oauth_states), 'disconnect retained state');
select pg_temp.assert_true((select count(*) = 0 from public.gmail_sync_runs where status in ('queued','running')), 'disconnect retained runnable work');
select pg_temp.assert_true((select count(*) = 1 from public.gmail_imports), 'disconnect removed imports');
do $$ begin
  begin
    perform public.finish_gmail_authorization('11111111-1111-1111-1111-111111111111', repeat('e',64), 'https://project.example/functions/v1/gmail-callback', 'https://app.example', 'owner@example.test', 'synthetic-access', 'synthetic-refresh', now()+interval '1 hour');
    raise exception 'in-flight exchange restored disconnected access';
  exception when others then
    if sqlerrm <> 'gmail_authorization_unavailable' then raise; end if;
  end;
end; $$;
do $$ begin
  begin
    perform public.begin_gmail_authorization('11111111-1111-1111-1111-111111111111', repeat('f',64), 'synthetic-pkce', 'https://project.example/functions/v1/gmail-callback', 'https://app.example');
    raise exception 'authorization started during disconnect';
  exception when others then
    if sqlerrm <> 'gmail_disconnect_pending' then raise; end if;
  end;
  begin
    perform public.finish_gmail_disconnect('11111111-1111-1111-1111-111111111111', gen_random_uuid(), 'revoked');
    raise exception 'stale attempt released disconnect';
  exception when others then
    if sqlerrm <> 'gmail_disconnect_attempt_unavailable' then raise; end if;
  end;
end; $$;
select public.finish_gmail_disconnect(user_id, attempt_id, 'retry') from public.gmail_disconnect_jobs;
select pg_temp.assert_true((select attempt_id is null and last_outcome = 'retry' and refresh_token_encrypted is not null from public.gmail_disconnect_jobs), 'failed revoke cannot retry');
select count(*) from public.disconnect_gmail('11111111-1111-1111-1111-111111111111');
select public.finish_gmail_disconnect(user_id, attempt_id, 'uncertain') from public.gmail_disconnect_jobs;
select pg_temp.assert_true((select attempt_id is not null and last_outcome = 'uncertain' from public.gmail_disconnect_jobs), 'ambiguous remote outcome released exclusion');
select pg_temp.assert_true((select count(*) = 0 from public.disconnect_gmail('11111111-1111-1111-1111-111111111111')), 'uncertain revoke taken over');
select public.finish_gmail_disconnect(user_id, attempt_id, 'revoked') from public.gmail_disconnect_jobs;
select pg_temp.assert_true((select count(*) = 0 from public.gmail_disconnect_jobs), 'revoked token not securely erased');
select pg_temp.assert_true((select status = 'revoked' and not daily_sync_enabled from public.gmail_connection_statuses), 'disconnect not finalized');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
select pg_temp.assert_true((select count(*) = 1 from public.gmail_connection_status), 'owner cannot see safe status');
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',true);
select pg_temp.assert_true((select count(*) = 0 from public.gmail_connection_status), 'other user sees status');
rollback;
