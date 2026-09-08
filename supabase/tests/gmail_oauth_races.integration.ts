// Actual handlers, Auth and PostgreSQL; only Google is synthetic. Local-only.
import { createClient } from '@supabase/supabase-js';
import { equal, ok } from 'node:assert/strict';
import { gmailDependencies } from '../functions/_shared/gmail-runtime.ts';
import { decryptSecret, GMAIL_SCOPE, handleAuthorize, handleCallback } from '../functions/_shared/google-oauth.ts';

async function sql(statement: string) {
  const child = new Deno.Command('docker', { args: ['exec', '-i', 'supabase_db_finance-dashboard', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], stdin: 'piped', stdout: 'piped', stderr: 'piped' }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(statement)); await writer.close();
  const result = await child.output();
  ok(result.success, 'Local synthetic SQL failed.');
  return new TextDecoder().decode(result.stdout).trim();
}
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

async function fixture(run: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const f = await setup();
  try { await run(f); } finally { await f.cleanup(); }
}
async function setup() {
  equal(await sql('select count(*) from auth.users'), '0', 'Requires an empty disposable local Auth database.');
  const cli = await new Deno.Command('npx', { args: ['--yes', 'supabase@2.117.0', 'status', '--output', 'json'], stdout: 'piped', stderr: 'piped' }).output();
  ok(cli.success, 'Local Supabase must be running.');
  const local = JSON.parse(new TextDecoder().decode(cli.stdout));
  equal(new URL(local.API_URL).hostname, '127.0.0.1', 'Never run against a remote database.');
  const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const ownerClient = createClient(local.API_URL, local.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const previousOwner = await sql("select pg_get_functiondef('public.is_owner()'::regprocedure)");
  const email = `gmail-${crypto.randomUUID()}@example.test`; const password = `${crypto.randomUUID()}-Aa1!`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  ok(!created.error && created.data.user); const owner = created.data.user.id;
  const signedIn = await ownerClient.auth.signInWithPassword({ email, password });
  ok(!signedIn.error && signedIn.data.session);
  await sql(`create or replace function public.is_owner() returns boolean language sql stable set search_path='' as $$ select auth.uid()='${owner}'::uuid $$;`);
  const env: Record<string, string> = {
    SUPABASE_URL: local.API_URL, SUPABASE_ANON_KEY: local.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
    GOOGLE_OAUTH_CLIENT_ID: 'synthetic-client', GOOGLE_OAUTH_CLIENT_SECRET: 'synthetic-secret',
    GOOGLE_OAUTH_REDIRECT_URI: `${local.API_URL}/functions/v1/gmail-callback`,
    GMAIL_APP_ORIGIN: 'https://app.example', GMAIL_APP_BASE_PATH: '/invoice-app',
    GMAIL_TOKEN_ENCRYPTION_KEY: btoa('01234567890123456789012345678901'),
  };
  const deps = gmailDependencies((name) => env[name]);
  const issued = new Set<string>(); let revocations = 0;
  const provider: typeof fetch = async (url, options) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      const body = options?.body as URLSearchParams;
      equal(body.get('redirect_uri'), env.GOOGLE_OAUTH_REDIRECT_URI);
      const code = body.get('code')!; issued.add(code);
      return Response.json({ access_token: `access-${code}`, refresh_token: `refresh-${code}`, scope: GMAIL_SCOPE, token_type: 'Bearer', expires_in: 3600 });
    }
    if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/profile') return Response.json({ emailAddress: 'mailbox@example.test' });
    if (url === 'https://oauth2.googleapis.com/revoke') { revocations++; issued.clear(); return new Response(null, { status: 200 }); }
    throw new Error('Real Google and unexpected network access are forbidden.');
  };
  deps.fetch = provider;
  const request = (body: unknown, url = `${local.API_URL}/gmail-callback`, origin = env.GMAIL_APP_ORIGIN) => new Request(url, {
    method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${signedIn.data.session!.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const action = (action: string) => handleAuthorize(request({ action }, `${local.API_URL}/gmail-authorize`), deps);
  const begin = async () => {
    const response = await action('connect'); equal(response.status, 200);
    const url = new URL((await response.json()).authorizationUrl);
    equal(url.searchParams.get('redirect_uri'), env.GOOGLE_OAUTH_REDIRECT_URI);
    return url.searchParams.get('state')!;
  };
  const complete = (state: string, code: string, url?: string) => handleCallback(request({ state, code }, url), deps);
  const connection = async () => {
    const { data, error } = await admin.from('gmail_connections').select('*').eq('user_id', owner).single();
    ok(!error && data); return data;
  };
  return { deps, owner, admin, local, request, action, begin, complete, connection, provider, issued, revocations: () => revocations,
    cleanup: async () => {
      await sql(`delete from public.gmail_imports where user_id='${owner}'; delete from public.gmail_sync_runs where user_id='${owner}'; delete from public.gmail_connections where user_id='${owner}'; delete from public.gmail_oauth_states where user_id='${owner}'; delete from auth.users where id='${owner}'; ${previousOwner}`);
    },
  };
}

Deno.test('callback accepts gateway-stripped GET and POST while preserving exact public redirect binding', async () => {
  await fixture(async (f) => {
    const state = await f.begin(); const workerUrl = `${f.local.API_URL}/gmail-callback`;
    const relay = await handleCallback(new Request(`${workerUrl}?state=${state}&code=gateway`), f.deps);
    equal(relay.status, 303);
    equal(new URL(relay.headers.get('Location')!).origin, f.deps.config.appOrigin);
    for (const url of [`${workerUrl}/other`, `${f.local.API_URL}/other`, 'https://evil.example/gmail-callback']) {
      equal((await f.complete(state, 'invalid', url)).status, 400);
    }
    equal((await handleCallback(f.request({ state, code: 'invalid' }, workerUrl, 'https://evil.example'), f.deps)).status, 403);
    equal((await f.complete(state, 'gateway', workerUrl)).status, 200);
    equal((await f.connection()).status, 'active');
  });
});

Deno.test('callback A pauses exchange, B completes, and A resumes without revoking B', async () => {
  await fixture(async (f) => {
    const paused = deferred(); const release = deferred();
    f.deps.fetch = async (url, options) => {
      if (url === 'https://oauth2.googleapis.com/token' && (options?.body as URLSearchParams).get('code') === 'A') { paused.resolve(); await release.promise; }
      return f.provider(url, options);
    };
    const first = f.complete(await f.begin(), 'A'); await paused.promise;
    try {
      equal((await f.complete(await f.begin(), 'B')).status, 200);
    } finally { release.resolve(); }
    equal((await first).status, 400);
    equal(f.revocations(), 0, 'Stale callback must never revoke a Google grant.');
    ok(f.issued.has('B'), 'New grant is still usable.');
    const row = await f.connection(); equal(row.status, 'active'); equal(row.daily_sync_enabled, true);
    equal(await decryptSecret(row.refresh_token_encrypted, f.deps.config.encryptionKey, `${f.owner}:refresh`), 'refresh-B');
  });
});

Deno.test('disconnect excludes reconnect and duplicate revocation until the provider result is finalized', async () => {
  await fixture(async (f) => {
    equal((await f.complete(await f.begin(), 'original')).status, 200);
    const pendingState = await f.begin(); const paused = deferred(); const release = deferred();
    f.deps.fetch = async (url, options) => {
      if (url === 'https://oauth2.googleapis.com/revoke') { paused.resolve(); await release.promise; }
      return f.provider(url, options);
    };
    const disconnect = f.action('disconnect'); await paused.promise;
    try {
      equal((await f.action('connect')).status, 400, 'New authorization must wait for disconnect.');
      equal((await f.complete(pendingState, 'superseded')).status, 400);
      equal((await f.action('disconnect')).status, 200, 'Repeated disconnect must not start a second revoke.');
      const row = await f.connection(); equal(row.status, 'disconnecting'); equal(row.daily_sync_enabled, false);
      equal(row.access_token_encrypted, null); equal(row.refresh_token_encrypted, null);
      equal((await f.action('sync')).status, 400);
    } finally { release.resolve(); await disconnect; }
    equal(f.revocations(), 1);
    equal((await f.connection()).status, 'revoked');
    equal((await f.complete(await f.begin(), 'reconnected')).status, 200);
    ok(f.issued.has('reconnected')); equal((await f.connection()).daily_sync_enabled, true);
  });
});

Deno.test('provider failure retains private retry work and import history with no usable credentials or schedule', async () => {
  await fixture(async (f) => {
    equal((await f.complete(await f.begin(), 'original')).status, 200);
    const original = await f.connection();
    const inserted = await f.admin.from('gmail_imports').insert({ user_id: f.owner, connection_id: original.id, gmail_message_id: 'synthetic-history', filter_reason: 'synthetic' }); ok(!inserted.error);
    f.deps.fetch = async (url, options) => url === 'https://oauth2.googleapis.com/revoke' ? new Response(null, { status: 503 }) : f.provider(url, options);
    equal((await f.action('disconnect')).status, 200);
    const row = await f.connection(); equal(row.status, 'disconnecting'); equal(row.daily_sync_enabled, false);
    equal(row.access_token_encrypted, null); equal(row.refresh_token_encrypted, null);
    const pending = await f.admin.from('gmail_disconnect_jobs').select('*').eq('user_id', f.owner).single();
    ok(!pending.error); equal(pending.data.last_outcome, 'retry'); equal(pending.data.attempt_id, null);
    ok(pending.data.refresh_token_encrypted.startsWith('v1.'), 'Only ciphertext is retained for retry.');
    equal((await f.action('connect')).status, 400);
    f.deps.fetch = f.provider;
    equal((await f.action('disconnect')).status, 200);
    equal((await f.connection()).status, 'revoked');
    equal((await f.admin.from('gmail_disconnect_jobs').select('user_id').eq('user_id', f.owner)).data?.length, 0, 'Finalization erases retry credentials.');
    const history = await f.admin.from('gmail_imports').select('gmail_message_id').eq('user_id', f.owner);
    equal(history.data?.length, 1);
    equal((await f.complete(await f.begin(), 'retried')).status, 200);
    equal((await f.connection()).id, original.id);
  });
});

Deno.test('ambiguous transport outcome cannot be taken over by a retry or permit reconnection', async () => {
  await fixture(async (f) => {
    equal((await f.complete(await f.begin(), 'original')).status, 200);
    let requests = 0;
    f.deps.fetch = async (url, options) => {
      if (url === 'https://oauth2.googleapis.com/revoke') { requests++; throw new Error('synthetic transport failure'); }
      return f.provider(url, options);
    };
    equal((await f.action('disconnect')).status, 200);
    const pending = await f.admin.from('gmail_disconnect_jobs').select('attempt_id,last_outcome').eq('user_id', f.owner).single();
    ok(!pending.error && pending.data.attempt_id); equal(pending.data.last_outcome, 'uncertain');
    equal((await f.action('disconnect')).status, 200); equal(requests, 1);
    equal((await f.action('connect')).status, 400);
    const row = await f.connection(); equal(row.status, 'disconnecting'); equal(row.daily_sync_enabled, false);
  });
});

Deno.test('lost persistence after Google revocation remains excluded and cannot send an old-token revoke twice', async () => {
  await fixture(async (f) => {
    equal((await f.complete(await f.begin(), 'original')).status, 200);
    f.deps.store.finishDisconnect = async () => { throw new Error('synthetic database outage'); };
    equal((await f.action('disconnect')).status, 400);
    equal(f.revocations(), 1);
    equal((await f.action('connect')).status, 400);
    equal((await f.action('disconnect')).status, 200); equal(f.revocations(), 1);
    const row = await f.connection(); equal(row.status, 'disconnecting'); equal(row.daily_sync_enabled, false);
    equal(row.access_token_encrypted, null); equal(row.refresh_token_encrypted, null);
  });
});
