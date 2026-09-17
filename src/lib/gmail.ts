import { supabase } from '@/lib/supabase';

export interface GmailConnection {
  status: 'active' | 'reauthorization_required' | 'revoked' | 'error' | 'disconnecting';
  gmailAddress: string; dailySyncEnabled: boolean;
  lastSyncedAt: string | null; lastFailedAt?: string | null;
  syncStatus?: 'queued' | 'running' | 'completed' | 'failed' | null;
}
const message = 'Could not update Gmail. Check your connection and try again.';
async function invoke(name: string, body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error || !data || data.error) throw new Error(message);
  return data;
}
export async function startGmailConnection(): Promise<{ authorizationUrl: string }> {
  const data = await invoke('gmail-authorize', { action: 'connect' });
  const url = new URL(data.authorizationUrl);
  if (url.origin !== 'https://accounts.google.com' || url.pathname !== '/o/oauth2/v2/auth' || url.username || url.password) throw new Error(message);
  return { authorizationUrl: url.toString() };
}
export async function getGmailConnection(): Promise<GmailConnection | null> {
  return (await invoke('gmail-authorize', { action: 'status' })).connection;
}
export async function setGmailSchedule(enabled: boolean): Promise<GmailConnection | null> {
  return (await invoke('gmail-authorize', { action: 'schedule', enabled })).connection;
}
export async function requestGmailSync(): Promise<GmailConnection | null> {
  return (await invoke('gmail-authorize', { action: 'sync' })).connection;
}
export async function disconnectGmail(): Promise<{ connection: GmailConnection | null; revocationAttempted: boolean }> {
  return invoke('gmail-authorize', { action: 'disconnect' });
}

// Share an in-flight completion across React StrictMode's effect replay. The
// fragment is stripped before awaiting network/auth work and is never persisted.
let completion: Promise<boolean> | null = null;
export function completePendingGmailConnection(): Promise<boolean> {
  const params = new URLSearchParams(window.location.hash.slice(1));
  if (params.has('gmail_state')) {
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    const body = params.has('gmail_error')
      ? { state: params.get('gmail_state'), denied: true }
      : { state: params.get('gmail_state'), code: params.get('gmail_code') };
    completion = invoke('gmail-callback', body).then((data) => {
      const expected = new URL(`${import.meta.env.BASE_URL}settings/finance?gmail=connected`, window.location.origin);
      if (data.redirectTo !== expected.href) throw new Error(message);
      return true;
    }).finally(() => { completion = null; });
  }
  return completion ?? Promise.resolve(false);
}
