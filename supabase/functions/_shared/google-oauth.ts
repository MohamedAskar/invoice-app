export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const encoder = new TextEncoder();
const safeError = 'Gmail connection could not be updated. Reconnect and try again.';
export interface GmailConfig {
  clientId: string; clientSecret: string; redirectUri: string;
  appOrigin: string; appBasePath: string; encryptionKey: string;
}
export interface OAuthState { pkce_verifier_encrypted: string }
export type RevocationOutcome = 'revoked' | 'retry' | 'uncertain' | 'key_unavailable';
export interface GmailDisconnect { attempt_id: string; refresh_token_encrypted: string }
export interface GmailStatus {
  status: 'active' | 'reauthorization_required' | 'revoked' | 'error' | 'disconnecting';
  gmailAddress: string; dailySyncEnabled: boolean;
  lastSyncedAt: string | null; lastFailedAt: string | null;
  syncStatus: 'queued' | 'running' | 'completed' | 'failed' | null;
}
export interface GmailStore {
  begin(userId: string, hash: string, verifier: string): Promise<void>;
  consume(userId: string, hash: string): Promise<OAuthState | null>;
  finish(userId: string, hash: string, address: string, access: string, refresh: string, expires: string): Promise<void>;
  fail(userId: string, hash: string): Promise<void>;
  status(userId: string): Promise<GmailStatus | null>;
  disconnect(userId: string): Promise<GmailDisconnect | null>;
  finishDisconnect(userId: string, attemptId: string, outcome: RevocationOutcome): Promise<void>;
  schedule(userId: string, enabled: boolean): Promise<void>;
  sync(userId: string): Promise<void>;
}
export interface GmailDependencies {
  config: GmailConfig; store: GmailStore;
  authenticate(jwt: string): Promise<string | null>;
  fetch: typeof fetch;
}
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unbase64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
const url64 = (bytes: Uint8Array) => base64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const randomSecret = () => url64(crypto.getRandomValues(new Uint8Array(32)));
export async function stateHash(state: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(state))), (b) => b.toString(16).padStart(2, '0')).join('');
}
function keyBytes(encoded: string): Uint8Array<ArrayBuffer> {
  const bytes = unbase64(encoded);
  if (bytes.length !== 32 || base64(bytes) !== encoded) throw new Error('invalid_configuration');
  return bytes;
}
export async function encryptSecret(secret: string, key: string, context: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const imported = await crypto.subtle.importKey('raw', keyBytes(key), 'AES-GCM', false, ['encrypt']);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(context) }, imported, encoder.encode(secret));
  return `v1.${base64(iv)}.${base64(new Uint8Array(data))}`;
}
export async function decryptSecret(secret: string, key: string, context: string): Promise<string> {
  const [version, iv, data, extra] = secret.split('.');
  if (version !== 'v1' || !iv || !data || extra || unbase64(iv).length !== 12) throw new Error('invalid_ciphertext');
  const imported = await crypto.subtle.importKey('raw', keyBytes(key), 'AES-GCM', false, ['decrypt']);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unbase64(iv), additionalData: encoder.encode(context) }, imported, unbase64(data)));
}
export function validateConfig(config: GmailConfig): void {
  const origin = new URL(config.appOrigin);
  const redirect = new URL(config.redirectUri);
  const secure = (url: URL) => url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname));
  if (origin.origin !== config.appOrigin || !secure(origin) || !secure(redirect) ||
      redirect.username || redirect.password || redirect.hash || redirect.search ||
      redirect.pathname !== '/functions/v1/gmail-callback' ||
      !/^(?:\/[a-zA-Z0-9_-]+)*$/.test(config.appBasePath) || !config.clientId || !config.clientSecret) throw new Error('invalid_configuration');
  keyBytes(config.encryptionKey);
}
function headers(request: Request, config: GmailConfig): Record<string, string> {
  return {
    'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin',
    ...(request.headers.get('Origin') === config.appOrigin ? {
      'Access-Control-Allow-Origin': config.appOrigin,
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    } : {}),
  };
}
function json(request: Request, config: GmailConfig, body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: headers(request, config) });
}
async function caller(request: Request, deps: GmailDependencies): Promise<string | null> {
  const match = /^Bearer (\S+)$/.exec(request.headers.get('Authorization') ?? '');
  return match ? deps.authenticate(match[1]) : null;
}
function preflight(request: Request, config: GmailConfig, allowNavigation = false): Response | null {
  validateConfig(config);
  const origin = request.headers.get('Origin');
  if (origin !== config.appOrigin && !(allowNavigation && !origin && request.method === 'GET')) {
    return json(request, config, { error: 'Origin not allowed.' }, 403);
  }
  return request.method === 'OPTIONS' ? new Response(null, { status: 204, headers: headers(request, config) }) : null;
}
async function input(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new Error('invalid_request');
  const text = await request.text();
  if (text.length > 8192) throw new Error('invalid_request');
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_request');
  return value;
}
export async function handleAuthorize(request: Request, deps: GmailDependencies): Promise<Response> {
  const { config, store } = deps;
  try {
    const early = preflight(request, config);
    if (early) return early;
    if (request.method !== 'POST') return json(request, config, { error: 'Method not allowed.' }, 405);
    const userId = await caller(request, deps);
    if (!userId) return json(request, config, { error: 'Sign in to manage Gmail.' }, 401);
    const body = await input(request);
    if (Object.keys(body).some((key) => !['action', 'enabled'].includes(key))) throw new Error('invalid_request');
    if (body.action === 'connect') {
      const state = randomSecret();
      const verifier = randomSecret();
      const hash = await stateHash(state);
      const challenge = url64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier))));
      await store.begin(userId, hash, await encryptSecret(verifier, config.encryptionKey, `${userId}:pkce:${hash}`));
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri,
        response_type: 'code', scope: GMAIL_SCOPE, access_type: 'offline', prompt: 'consent',
        state, code_challenge: challenge, code_challenge_method: 'S256', include_granted_scopes: 'false' }).toString();
      return json(request, config, { authorizationUrl: url.toString() });
    }
    if (body.action === 'disconnect') {
      // Move the credential into service-only revocation work and disable all
      // use atomically. Only this attempt may revoke; reconnect stays blocked.
      const attempt = await store.disconnect(userId);
      let revocationAttempted = false;
      if (attempt) {
        let outcome: RevocationOutcome = 'key_unavailable';
        try {
          const token = await decryptSecret(attempt.refresh_token_encrypted, config.encryptionKey, `${userId}:refresh`);
          outcome = await revoke(deps, token);
        } catch { /* Unreadable ciphertext is erased without sending a request. */ }
        await store.finishDisconnect(userId, attempt.attempt_id, outcome);
        revocationAttempted = outcome === 'revoked';
      }
      return json(request, config, { connection: await store.status(userId), revocationAttempted });
    }
    if (body.action === 'schedule') {
      if (typeof body.enabled !== 'boolean') throw new Error('invalid_request');
      await store.schedule(userId, body.enabled);
    } else if (body.action === 'sync') {
      await store.sync(userId);
    } else if (body.action !== 'status') throw new Error('invalid_request');
    return json(request, config, { connection: await store.status(userId) });
  } catch { return json(request, config, { error: safeError }, 400); }
}
async function revoke(deps: GmailDependencies, token: string): Promise<RevocationOutcome> {
  try {
    const response = await deps.fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST', body: new URLSearchParams({ token }), redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    // Provider bodies can contain credential material; never return or log them.
    if (response.ok) {
      await response.body?.cancel();
      return 'revoked';
    }
    if (response.status === 400) {
      try {
        const body = await response.json() as unknown;
        if (body && typeof body === 'object' && 'error' in body && body.error === 'invalid_token') return 'revoked';
      } catch { /* Malformed provider errors remain retryable. */ }
    } else {
      await response.body?.cancel();
    }
    return 'retry';
  } catch {
    // A transport failure does not prove that Google stopped processing the
    // request. Keep exclusive ownership until the outcome is reconciled.
    return 'uncertain';
  }
}
const settingsUrl = (config: GmailConfig) => `${config.appOrigin}${config.appBasePath}/settings/finance`;
export async function handleCallback(request: Request, deps: GmailDependencies): Promise<Response> {
  const { config, store } = deps;
  let userId: string | null = null;
  let consumedHash: string | null = null;
  let newToken: string | null = null;
  try {
    const early = preflight(request, config, true);
    if (early) return early;
    const url = new URL(request.url);
    // The gateway strips /functions/v1 before invoking the worker. Provider
    // and persisted state continue to bind to the exact public redirect URI.
    const redirect = new URL(config.redirectUri);
    if (url.origin !== redirect.origin || url.pathname !== '/gmail-callback') throw new Error('invalid_callback');
    if (request.method === 'GET') {
      // Google navigation cannot carry a Supabase bearer token. Relay only code
      // and state in a fragment (not a query) to the fixed app, without consuming
      // state or contacting Google. The app strips it before authenticated POST.
      const state = url.searchParams.get('state') ?? '';
      const code = url.searchParams.get('code') ?? '';
      if (!/^[A-Za-z0-9_-]{43}$/.test(state) || code.length > 4096 || (!code && !url.searchParams.has('error')) ||
          ['state', 'code', 'error'].some((key) => url.searchParams.getAll(key).length > 1)) throw new Error('invalid_callback');
      const fragment = new URLSearchParams({ gmail_state: state });
      if (url.searchParams.has('error')) fragment.set('gmail_error', 'denied');
      else fragment.set('gmail_code', code);
      return new Response(null, { status: 303, headers: { ...headers(request, config), Location: `${settingsUrl(config)}#${fragment}` } });
    }
    if (request.method !== 'POST' || url.search) return json(request, config, { error: 'Method not allowed.' }, 405);
    userId = await caller(request, deps);
    if (!userId) return json(request, config, { error: 'Sign in to connect Gmail.' }, 401);
    const body = await input(request);
    if (Object.keys(body).some((key) => !['state', 'code', 'denied'].includes(key)) ||
        typeof body.state !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.state) ||
        (body.denied !== true && (typeof body.code !== 'string' || !body.code || body.code.length > 4096))) throw new Error('invalid_request');
    const hash = await stateHash(body.state);
    const state = await store.consume(userId, hash);
    if (!state) throw new Error('invalid_state');
    consumedHash = hash;
    if (body.denied) throw new Error('authorization_denied');
    const verifier = await decryptSecret(state.pkce_verifier_encrypted, config.encryptionKey, `${userId}:pkce:${hash}`);
    const response = await deps.fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret,
        redirect_uri: config.redirectUri, grant_type: 'authorization_code', code: body.code as string, code_verifier: verifier }),
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error('exchange_failed'); }
    const tokens = await response.json();
    if (typeof tokens.refresh_token === 'string') newToken = tokens.refresh_token;
    if (!newToken || typeof tokens.access_token !== 'string' || !tokens.access_token ||
        tokens.token_type?.toLowerCase() !== 'bearer' || tokens.scope !== GMAIL_SCOPE ||
        typeof tokens.expires_in !== 'number' || tokens.expires_in <= 0 || tokens.expires_in > 86400) throw new Error('invalid_token_response');
    const profileResponse = await deps.fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }, redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    if (!profileResponse.ok) { await profileResponse.body?.cancel(); throw new Error('profile_failed'); }
    const profile = await profileResponse.json();
    if (typeof profile.emailAddress !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.emailAddress)) throw new Error('invalid_profile');
    await store.finish(userId, hash, profile.emailAddress.trim().toLowerCase(),
      await encryptSecret(tokens.access_token, config.encryptionKey, `${userId}:access`),
      await encryptSecret(newToken, config.encryptionKey, `${userId}:refresh`),
      new Date(Date.now() + tokens.expires_in * 1000).toISOString());
    consumedHash = null;
    newToken = null;
    // A fetch client follows 303 as an unauthenticated navigation; return the
    // fixed destination instead so the authenticated SPA performs the redirect.
    return json(request, config, { redirectTo: `${settingsUrl(config)}?gmail=connected` });
  } catch {
    if (userId && consumedHash) {
      try { await store.fail(userId, consumedHash); } catch { /* Consumed state stays single-use even during database outage. */ }
    }
    // Discard failed/stale exchange results. Google revocation is grant-wide:
    // revoking here could invalidate a newer callback that already committed.
    return json(request, config, { error: safeError }, 400);
  }
}
