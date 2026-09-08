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
select pg_temp.assert_true((select access_token_encrypted is null and refresh_token_encrypted is null and status = 'revoked' and not daily_sync_enabled from public.gmail_connections), 'disconnect retained credentials');
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
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
select pg_temp.assert_true((select count(*) = 1 from public.gmail_connection_status), 'owner cannot see safe status');
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',true);
select pg_temp.assert_true((select count(*) = 0 from public.gmail_connection_status), 'other user sees status');
rollback;
