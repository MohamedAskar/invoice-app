import { createClient } from '@supabase/supabase-js';
import { type GmailConfig, type GmailDependencies, type GmailStatus, type GmailStore, validateConfig } from './google-oauth.ts';

export function gmailDependencies(env: (name: string) => string | undefined): GmailDependencies {
  const required = (name: string) => { const value = env(name); if (!value) throw new Error('invalid_configuration'); return value; };
  const config: GmailConfig = {
    clientId: required('GOOGLE_OAUTH_CLIENT_ID'), clientSecret: required('GOOGLE_OAUTH_CLIENT_SECRET'),
    redirectUri: required('GOOGLE_OAUTH_REDIRECT_URI'), encryptionKey: required('GMAIL_TOKEN_ENCRYPTION_KEY'),
    appOrigin: required('GMAIL_APP_ORIGIN'), appBasePath: env('GMAIL_APP_BASE_PATH') ?? '/invoice-app',
  };
  validateConfig(config);
  const url = required('SUPABASE_URL');
  const anon = required('SUPABASE_ANON_KEY');
  const admin = createClient(url, required('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
  const binding = { p_redirect_uri: config.redirectUri, p_app_origin: config.appOrigin };
  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await admin.rpc(name, args);
    if (error) throw new Error('gmail_persistence_failed');
    return data;
  }
  const store: GmailStore = {
    async begin(userId, hash, verifier) {
      await rpc('begin_gmail_authorization', { p_user_id: userId, p_state_hash: hash, p_verifier: verifier, ...binding });
    },
    async consume(userId, hash) {
      const states = await rpc('consume_gmail_authorization', { p_user_id: userId, p_state_hash: hash, ...binding });
      if (!Array.isArray(states)) throw new Error('gmail_persistence_failed');
      return states[0] ?? null;
    },
    async finish(userId, hash, address, access, refresh, expires) {
      await rpc('finish_gmail_authorization', { p_user_id: userId, p_state_hash: hash, ...binding,
        p_address: address, p_access_token: access, p_refresh_token: refresh, p_expires_at: expires });
    },
    async fail(userId, hash) {
      await rpc('fail_gmail_authorization', { p_user_id: userId, p_state_hash: hash });
    },
    async disconnect(userId) {
      const rows = await rpc('disconnect_gmail', { p_user_id: userId });
      if (!Array.isArray(rows)) throw new Error('gmail_persistence_failed');
      return rows[0] ?? null;
    },
    async finishDisconnect(userId, attemptId, outcome) {
      await rpc('finish_gmail_disconnect', { p_user_id: userId, p_attempt_id: attemptId, p_outcome: outcome });
    },
    async schedule(userId, enabled) {
      const { data, error } = await admin.from('gmail_connections').update({ daily_sync_enabled: enabled })
        .eq('user_id', userId).eq('status', 'active').select('id').maybeSingle();
      if (error || !data) throw new Error('gmail_connection_unavailable');
    },
    async sync(userId) { await rpc('request_gmail_sync', { p_user_id: userId }); },
    async status(userId) {
      const { data, error } = await admin.from('gmail_connection_statuses')
        .select('connection_id,status,gmail_address,daily_sync_enabled,last_synced_at,last_failed_at').eq('user_id', userId).maybeSingle();
      if (error) throw new Error('gmail_status_unavailable');
      if (!data) return null;
      const runs = await admin.from('gmail_sync_runs').select('status').eq('user_id', userId)
        .eq('connection_id', data.connection_id).order('created_at', { ascending: false }).limit(1);
      if (runs.error) throw new Error('gmail_status_unavailable');
      return { status: data.status, gmailAddress: data.gmail_address, dailySyncEnabled: data.daily_sync_enabled,
        lastSyncedAt: data.last_synced_at, lastFailedAt: data.last_failed_at, syncStatus: runs.data?.[0]?.status ?? null } as GmailStatus;
    },
  };
  return {
    config, store, fetch,
    async authenticate(jwt) {
      const client = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${jwt}` } },
        auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await client.auth.getUser(jwt);
      if (error || !data.user) return null;
      const owner = await client.rpc('is_owner');
      return !owner.error && owner.data === true ? data.user.id : null;
    },
  };
}
