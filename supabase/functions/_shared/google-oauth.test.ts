// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { decryptSecret, encryptSecret, GMAIL_SCOPE, handleAuthorize, handleCallback, randomSecret, stateHash, validateConfig, type GmailConfig, type GmailDependencies, type GmailStatus } from './google-oauth';

const config: GmailConfig = {
  clientId: 'synthetic-client', clientSecret: 'synthetic-secret', appOrigin: 'https://app.example',
  appBasePath: '/invoice-app', redirectUri: 'https://project.example/functions/v1/gmail-callback',
  encryptionKey: btoa('01234567890123456789012345678901'),
};
async function fixture() {
  const state = randomSecret(); const hash = await stateHash(state);
  const verifier = await encryptSecret('test-verifier', config.encryptionKey, `owner:pkce:${hash}`);
  const row = { userId: 'owner', hash, expiresAt: Date.now() + 600000, consumed: false, finalized: false, exists: true };
  let connection: GmailStatus | null = null;
  const saved: string[] = [];
  const store: GmailDependencies['store'] = {
    begin: vi.fn(async () => {}),
    consume: vi.fn(async (user, candidate) => {
      if (!row.exists || row.consumed || row.userId !== user || row.hash !== candidate || row.expiresAt <= Date.now()) return null;
      row.consumed = true;
      return { pkce_verifier_encrypted: verifier };
    }),
    finish: vi.fn(async (_user, _hash, address, access, refresh) => {
      if (!row.exists || row.finalized) throw new Error('state_unavailable');
      row.finalized = true; saved.push(access, refresh);
      connection = { status: 'active', gmailAddress: address, dailySyncEnabled: true, lastSyncedAt: null, lastFailedAt: null, syncStatus: 'queued' };
    }),
    fail: vi.fn(async () => { row.finalized = true; }),
    status: vi.fn(async () => connection),
    disconnect: vi.fn(async () => {
      row.exists = false;
      const refresh = saved[1]; saved.length = 0;
      if (connection) connection = { ...connection, status: 'disconnecting', dailySyncEnabled: false, syncStatus: 'failed' };
      return refresh ? { attempt_id: 'synthetic-attempt', refresh_token_encrypted: refresh } : null;
    }),
    finishDisconnect: vi.fn(async (_user, _attempt, outcome) => {
      if (connection && ['revoked', 'key_unavailable'].includes(outcome)) connection = { ...connection, status: 'revoked' };
    }),
    schedule: vi.fn(async () => {}), sync: vi.fn(async () => {}),
  };
  const provider = vi.fn<typeof fetch>(async (url) => {
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({
      access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', scope: GMAIL_SCOPE, token_type: 'Bearer', expires_in: 3600,
    });
    if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/profile') return Response.json({ emailAddress: 'ME@example.com' });
    if (url === 'https://oauth2.googleapis.com/revoke') return new Response(null, { status: 200 });
    throw new Error('Unexpected network request');
  });
  const deps: GmailDependencies = { config, store, fetch: provider, authenticate: vi.fn(async (jwt) => jwt === 'owner-jwt' ? 'owner' : jwt === 'other-jwt' ? 'other' : null) };
  const request = (body: Record<string, unknown>, jwt = 'owner-jwt', origin = config.appOrigin, url = 'https://project.example/gmail-callback') =>
    new Request(url, { method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const callback = (overrides: Record<string, unknown> = {}, jwt = 'owner-jwt', origin = config.appOrigin) => handleCallback(request({ state, code: 'synthetic-code', ...overrides }, jwt, origin), deps);
  return { state, hash, row, store, provider, deps, request, callback, saved };
}
describe('Gmail OAuth trust boundaries', () => {
  it('requests authorization-code readonly offline consent with random state and PKCE', async () => {
    const f = await fixture();
    const response = await handleAuthorize(f.request({ action: 'connect' }), f.deps);
    const url = new URL((await response.json()).authorizationUrl);
    expect(url.origin).toBe('https://accounts.google.com');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ scope: GMAIL_SCOPE, access_type: 'offline', prompt: 'consent', response_type: 'code', redirect_uri: config.redirectUri, code_challenge_method: 'S256', include_granted_scopes: 'false' });
    expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(f.store.begin).toHaveBeenCalledWith('owner', await stateHash(url.searchParams.get('state')!), expect.stringMatching(/^v1\./));
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(config.appOrigin);
    expect(f.provider).not.toHaveBeenCalled();
  });
  it('requires a verified caller and ignores client identity claims', async () => {
    const f = await fixture();
    expect((await f.callback({}, 'expired-jwt')).status).toBe(401);
    expect((await handleAuthorize(f.request({ action: 'connect', userId: 'victim' }), f.deps)).status).toBe(400);
    expect(f.store.consume).not.toHaveBeenCalled(); expect(f.store.begin).not.toHaveBeenCalled();
  });
  it('accepts once, stores only ciphertext, and redirects to the fixed settings URL', async () => {
    const f = await fixture(); const response = await f.callback();
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ redirectTo: `${config.appOrigin}/invoice-app/settings/finance?gmail=connected` });
    expect(body).not.toMatch(/synthetic-access|synthetic-refresh|synthetic-secret/);
    expect(f.saved).toHaveLength(2);
    expect(await decryptSecret(f.saved[0], config.encryptionKey, 'owner:access')).toBe('synthetic-access');
    expect(await decryptSecret(f.saved[1], config.encryptionKey, 'owner:refresh')).toBe('synthetic-refresh');
    expect((await f.callback()).status).toBe(400);
    expect(f.provider).toHaveBeenCalledTimes(2); expect(f.store.finish).toHaveBeenCalledOnce();
    expect(f.store.fail).not.toHaveBeenCalled();
  });
  it('rejects callback from a different signed-in user without consuming or exchanging', async () => {
    const f = await fixture(); expect((await f.callback({}, 'other-jwt')).status).toBe(400);
    expect(f.row.consumed).toBe(false); expect(f.provider).not.toHaveBeenCalled();
    expect(f.store.finish).not.toHaveBeenCalled(); expect(f.store.fail).not.toHaveBeenCalled();
  });
  it('rejects expired or unknown states before token exchange', async () => {
    const f = await fixture(); f.row.expiresAt = Date.now() - 1;
    expect((await f.callback()).status).toBe(400);
    f.row.expiresAt = Date.now() + 10000;
    expect((await f.callback({ state: randomSecret() })).status).toBe(400);
    expect(f.provider).not.toHaveBeenCalled(); expect(f.store.finish).not.toHaveBeenCalled();
  });
  it('blocks unconfigured origins, return URLs, and callback hosts', async () => {
    const f = await fixture();
    const response = await f.callback({}, 'owner-jwt', 'https://evil.example');
    expect(response.status).toBe(403); expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect((await f.callback({ redirectUri: 'https://evil.example' })).status).toBe(400);
    expect((await handleCallback(f.request({ state: f.state, code: 'code' }, 'owner-jwt', config.appOrigin, 'https://evil.example/functions/v1/gmail-callback'), f.deps)).status).toBe(400);
    expect(f.provider).not.toHaveBeenCalled(); expect(f.store.consume).not.toHaveBeenCalled();
  });
  it('relays Google GET without a token exchange, then demands the current session on POST', async () => {
    const f = await fixture();
    const response = await handleCallback(new Request(`https://project.example/gmail-callback?state=${f.state}&code=synthetic-code`), f.deps);
    expect(response.status).toBe(303);
    const target = new URL(response.headers.get('Location')!);
    expect(target.origin).toBe(config.appOrigin); expect(target.pathname).toBe('/invoice-app/settings/finance');
    expect(target.search).toBe(''); expect(new URLSearchParams(target.hash.slice(1)).get('gmail_code')).toBe('synthetic-code');
    expect(f.store.consume).not.toHaveBeenCalled(); expect(f.provider).not.toHaveBeenCalled();
    expect((await f.callback({}, '')).status).toBe(401);
  });
  it('consumes denied and failed exchanges, redacts provider errors, and cannot be replayed', async () => {
    const f = await fixture();
    f.provider.mockResolvedValueOnce(Response.json({ error: 'invalid_grant', error_description: 'LEAK synthetic-refresh' }, { status: 400 }));
    const response = await f.callback();
    expect(response.status).toBe(400); expect(await response.text()).not.toMatch(/LEAK|synthetic|invalid_grant/);
    expect(f.store.fail).toHaveBeenCalledWith('owner', f.hash); expect(f.store.finish).not.toHaveBeenCalled();
    expect((await f.callback()).status).toBe(400); expect(f.provider).toHaveBeenCalledOnce();
    const denied = await fixture();
    expect((await denied.callback({ denied: true })).status).toBe(400);
    expect(denied.row.consumed).toBe(true); expect(denied.provider).not.toHaveBeenCalled();
  });
  it('rejects expanded scopes and discards tokens without grant-wide revocation', async () => {
    const f = await fixture();
    f.provider.mockResolvedValueOnce(Response.json({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', scope: `${GMAIL_SCOPE} https://www.googleapis.com/auth/gmail.modify`, token_type: 'Bearer', expires_in: 3600 }));
    expect((await f.callback()).status).toBe(400);
    expect(f.store.finish).not.toHaveBeenCalled();
    expect(f.provider).toHaveBeenCalledOnce();
  });
  it('disconnect removes usable credentials first and retains an uncertain revoke lock', async () => {
    const f = await fixture(); await f.callback();
    f.provider.mockImplementationOnce(async () => {
      expect(f.row.exists).toBe(false);
      throw new Error('LEAK provider unavailable synthetic-refresh');
    });
    const response = await handleAuthorize(f.request({ action: 'disconnect' }), f.deps);
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ connection: { status: 'disconnecting', dailySyncEnabled: false }, revocationAttempted: false });
    expect(f.store.disconnect).toHaveBeenCalledWith('owner');
    expect(f.store.finishDisconnect).toHaveBeenCalledWith('owner', 'synthetic-attempt', 'uncertain');
    expect((await f.callback()).status).toBe(400);
  });
  it('cannot finalize an in-flight callback after disconnect', async () => {
    const f = await fixture();
    f.provider.mockImplementationOnce(async () => {
      await f.store.disconnect('owner');
      return Response.json({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', scope: GMAIL_SCOPE, token_type: 'Bearer', expires_in: 3600 });
    });
    expect((await f.callback()).status).toBe(400); expect(f.saved).toHaveLength(0);
    expect(f.provider.mock.calls.some(([url]) => url === 'https://oauth2.googleapis.com/revoke')).toBe(false);
  });
  it('securely finalizes erasure when the stored revocation credential cannot be decrypted', async () => {
    const f = await fixture(); await f.callback();
    f.saved[1] = 'unreadable-ciphertext'; f.provider.mockClear();
    const response = await handleAuthorize(f.request({ action: 'disconnect' }), f.deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ connection: { status: 'revoked', dailySyncEnabled: false }, revocationAttempted: false });
    expect(f.store.finishDisconnect).toHaveBeenCalledWith('owner', 'synthetic-attempt', 'key_unavailable');
    expect(f.provider).not.toHaveBeenCalled();
  });
  it('rejects weak encryption keys and untrusted origins; binds ciphertext to user and purpose', async () => {
    expect(() => validateConfig({ ...config, appOrigin: 'https://app.example/evil' })).toThrow();
    expect(() => validateConfig({ ...config, redirectUri: 'https://project.example/functions/v1/gmail-callback?next=evil' })).toThrow();
    expect(() => validateConfig({ ...config, encryptionKey: btoa('short') })).toThrow();
    const ciphertext = await encryptSecret('synthetic-refresh', config.encryptionKey, 'owner:refresh');
    await expect(decryptSecret(ciphertext, config.encryptionKey, 'other:refresh')).rejects.toThrow();
    await expect(decryptSecret(ciphertext, config.encryptionKey, 'owner:access')).rejects.toThrow();
    expect(await encryptSecret('synthetic-refresh', config.encryptionKey, 'owner:refresh')).not.toBe(ciphertext);
  });
});
