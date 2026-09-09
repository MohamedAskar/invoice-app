import { createClient } from '@supabase/supabase-js';
import { decryptSecret, GMAIL_SCOPE } from './google-oauth.ts';
import { gmailDependencies } from './gmail-runtime.ts';
import { type Cursor, GmailSyncError, type SyncConnection, type SyncDependencies, syncForUser } from '../gmail-sync/index.ts';
import { type GmailMessage, type MimePart, MAX_ATTACHMENT_BYTES } from './gmail-candidate-filter.ts';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const MAX_METADATA_JSON_BYTES = 2 * 1024 * 1024;
export const MAX_ATTACHMENT_JSON_BYTES = Math.ceil(MAX_ATTACHMENT_BYTES * 4 / 3) + 1024;
export async function readBoundedJson<T = unknown>(response: Response, limit: number): Promise<T> {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
    await response.body?.cancel(); throw new GmailSyncError();
  }
  if (!response.body) throw new GmailSyncError();
  const reader = response.body.getReader(); const bytes = new Uint8Array(limit); let size = 0;
  try {
    while (true) {
      const {value,done} = await reader.read(); if(done) break;
      if(size + value.byteLength > limit) { await reader.cancel(); throw new GmailSyncError(); }
      bytes.set(value,size); size += value.byteLength;
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,size))) as T;
}
interface GmailPageData {
  emailAddress?: string; historyId?: string; nextPageToken?: string;
  history?: { messagesAdded?: { message: { id:string } }[] }[]; messages?: {id:string}[];
}
export const DISCOVERY_QUERY = '-in:sent has:attachment {subject:invoice subject:rechnung subject:receipt subject:beleg subject:quittung filename:invoice filename:rechnung filename:receipt filename:beleg filename:quittung}';
export function syncRuntime(env: (name: string) => string | undefined, transport: typeof fetch = fetch, persistenceTransport: typeof fetch = fetch) {
  const required = (name: string) => { const value = env(name); if (!value) throw new GmailSyncError(); return value; };
  const lifecycle = gmailDependencies(env);
  const admin = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), { global: { fetch: persistenceTransport }, auth: { persistSession: false, autoRefreshToken: false } });
  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await admin.rpc(name, args);
    if (error) throw new GmailSyncError();
    return data;
  }
  const forUser = (): SyncDependencies => {
    // This closure belongs to exactly one invocation/user. Never cache credentials globally.
    let token: string | undefined;
    let grant: { refresh_token_encrypted: string; access_token_encrypted: string; token_expires_at: string; history_id: string | null } | undefined;
    const args = (c: SyncConnection) => ({ p_user_id: c.userId, p_run_id: c.runId });
    async function access(c: SyncConnection): Promise<string> {
      if (token) return token;
      if (!grant) throw new GmailSyncError();
      if (new Date(grant.token_expires_at).getTime() > Date.now() + 60000) {
        token = await decryptSecret(grant.access_token_encrypted, lifecycle.config.encryptionKey, `${c.userId}:access`);
      } else {
        const refresh = await decryptSecret(grant.refresh_token_encrypted, lifecycle.config.encryptionKey, `${c.userId}:refresh`);
        const response = await transport('https://oauth2.googleapis.com/token', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
          body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, client_id: lifecycle.config.clientId, client_secret: lifecycle.config.clientSecret }) });
        if (!response.ok) {
          // Only inspect the OAuth error code in memory; never log provider bodies.
          const result = await readBoundedJson<{error?:string}>(response,65536).catch(() => ({} as {error?:string}));
          throw new GmailSyncError(result.error === 'invalid_grant' || response.status === 401 ? 'reauthorization_required' : 'sync_failed');
        }
        const result = await readBoundedJson<{access_token?:string;scope?:string}>(response,65536);
        if (typeof result.access_token !== 'string' || !result.access_token || (result.scope && result.scope !== GMAIL_SCOPE)) throw new GmailSyncError();
        token = result.access_token;
      }
      return token!;
    }
    async function get<T = GmailPageData>(c: SyncConnection, path: string, limit = MAX_METADATA_JSON_BYTES): Promise<T> {
      const response = await transport(`${API}/${path}`, { headers: { Authorization: `Bearer ${await access(c)}` }, redirect: 'error', signal: AbortSignal.timeout(20000) });
      if (!response.ok) { await response.body?.cancel(); if (response.status === 401) throw new GmailSyncError('reauthorization_required'); if (response.status === 404) throw new Error('history_or_message_missing'); throw new GmailSyncError(); }
      return readBoundedJson<T>(response,limit);
    }
    // Request MIME structure without any body data, snippets, or raw mail. Gmail
    // field selectors must spell out nested parts, so cover common nesting and
    // fail closed for deeper leaf-less structures (never download mail bodies).
    const partFields = (depth: number): string => `partId,filename,mimeType,headers,body(attachmentId,size)${depth ? `,parts(${partFields(depth - 1)})` : ''}`;
    const messageFields = `id,threadId,labelIds,internalDate,payload(${partFields(20)})`;
    async function messages(c: SyncConnection, ids: string[]) {
      const result: GmailMessage[] = [], failedMessageIds: string[] = [];
      for (const id of ids.slice(0, 100)) {
        try {
          const message = await get<GmailMessage>(c, `messages/${encodeURIComponent(id)}?format=full&fields=${encodeURIComponent(messageFields)}`);
          if (message.id !== id || !message.internalDate || !Number.isFinite(new Date(Number(message.internalDate)).getTime())) throw new GmailSyncError();
          result.push(message);
        } catch (error) {
          if (error instanceof GmailSyncError && error.code === 'reauthorization_required') throw error;
          failedMessageIds.push(id);
        }
      }
      return {messages:result,failedMessageIds};
    }
    return {
      async claim(userId) {
        const rows = await rpc('claim_gmail_sync', { p_user_id: userId });
        const row = rows?.[0]; if (!row) return null;
        grant = row;
        return { id: row.id, userId, address: row.gmail_address, runId: row.sync_run_id, cursor: row.sync_cursor };
      },
      async rules(c) { const r = await admin.from('expense_vendor_rules').select('id,sender_domain,vendor,action').eq('user_id',c.userId); if(r.error) throw new GmailSyncError(); return r.data; },
      async issuedInvoices() {
        const all = []; for(let offset = 0; ; offset += 500) { const r = await admin.from('invoices').select('invoice_number,pdf_storage_path').neq('status','draft').order('id').range(offset,offset+499); if(r.error) throw new GmailSyncError(); all.push(...r.data); if(r.data.length < 500) return all; }
      },
      async page(c) {
        let cursor = c.cursor;
        if (!cursor) {
          const profile = await get(c,'profile?fields=emailAddress,historyId');
          if (profile.emailAddress?.toLowerCase() !== c.address || typeof profile.historyId !== 'string') throw new GmailSyncError('reauthorization_required');
          cursor = { mode: grant?.history_id ? 'history' : 'search', historyStart: grant?.history_id ?? undefined, targetHistory: profile.historyId };
        }
        if (cursor.pendingIds?.length) {
          const next = cursor.pendingIds.length > 100 ? { ...cursor, pendingIds: cursor.pendingIds.slice(100), attachmentOffset: 0 } : cursor.nextPageToken ? { ...cursor, pageToken: cursor.nextPageToken, pendingIds: undefined, attachmentOffset: undefined, nextPageToken: undefined } : null;
          return { ...await messages(c, cursor.pendingIds), next, resume: cursor, historyId: cursor.targetHistory };
        }
        let ids: string[] = [], nextPageToken: string | undefined;
        if (cursor.mode === 'history') {
          try {
            const params = new URLSearchParams({ startHistoryId: cursor.historyStart!, historyTypes: 'messageAdded', maxResults:'100', fields: 'history(messagesAdded(message(id))),nextPageToken,historyId' });
            if (cursor.pageToken) params.set('pageToken',cursor.pageToken);
            const data = await get(c,`history?${params}`);
            ids = [...new Set<string>((data.history ?? []).flatMap((h: { messagesAdded?: { message: { id: string } }[] }) => (h.messagesAdded ?? []).map(a => a.message.id)))];
            nextPageToken = data.nextPageToken;
            cursor = { ...cursor, targetHistory: data.historyId ?? cursor.targetHistory };
          } catch(error) {
            if (!(error instanceof Error) || error.message !== 'history_or_message_missing') throw error;
            const profile = await get(c,'profile?fields=historyId');
            if (typeof profile.historyId !== 'string') throw new GmailSyncError();
            cursor = { mode: 'search', targetHistory: profile.historyId, after: new Date(Date.now() - 90 * 86400000).toISOString().slice(0,10).replaceAll('-','/') };
          }
        }
        if (cursor.mode === 'search') {
          const ruleDomains = await admin.from('expense_vendor_rules').select('sender_domain').eq('user_id',c.userId).in('action',['always_include','review']);
          if(ruleDomains.error) throw new GmailSyncError();
          const domains = ruleDomains.data.map(r=>r.sender_domain).filter((v): v is string => typeof v === 'string' && /^[a-z0-9.-]+$/.test(v));
          const query = domains.length ? `${DISCOVERY_QUERY.slice(0,-1)} ${domains.map(d=>`from:(@${d})`).join(' ')}}` : DISCOVERY_QUERY;
          const params = new URLSearchParams({ q: `${query}${cursor.after ? ` after:${cursor.after}` : ''}`, maxResults:'100', fields: 'messages(id),nextPageToken' });
          if(cursor.pageToken) params.set('pageToken',cursor.pageToken);
          const data = await get(c,`messages?${params}`); ids = (data.messages ?? []).map((m: { id:string })=>m.id); nextPageToken = data.nextPageToken;
        }
        // A single history record may name more than 100 messages. Persist its
        // remaining IDs before advancing to the next history page.
        const rest = ids.slice(100);
        const resume = { ...cursor, nextPageToken };
        const next: Cursor | null = rest.length ? { ...resume, pendingIds: rest } : nextPageToken ? { ...cursor, pageToken: nextPageToken } : null;
        return { ...await messages(c,ids), next, resume: rest.length ? { ...resume, pendingIds: rest } : resume, historyId: cursor.targetHistory };
      },
      async attachment(c,m,p: MimePart) {
        const data = await get<{data?:string;size?:number}>(c,`messages/${encodeURIComponent(m.id)}/attachments/${encodeURIComponent(p.body!.attachmentId!)}?fields=data,size`,MAX_ATTACHMENT_JSON_BYTES);
        if (typeof data.data !== 'string' || data.data.length > Math.ceil(MAX_ATTACHMENT_BYTES * 4 / 3) + 4 || !Number.isInteger(data.size) || data.size! > MAX_ATTACHMENT_BYTES) return new Uint8Array();
        try { return Uint8Array.from(atob(data.data.replaceAll('-','+').replaceAll('_','/')),ch=>ch.charCodeAt(0)); } catch { return new Uint8Array(); }
      },
      async seen(c,m,a) { const r = await admin.from('gmail_imports').select('id').eq('connection_id',c.id).eq('gmail_message_id',m).eq('gmail_attachment_id',a).limit(1); if(r.error) throw new GmailSyncError(); return !!r.data.length; },
      async hasChecksum(c,sha) { const r = await admin.from('expense_documents').select('id').eq('user_id',c.userId).eq('sha256',sha).limit(1); if(r.error) throw new GmailSyncError(); return !!r.data.length; },
      async insertExpense(c,candidate) {
        const docs = [];
        try {
          for(const doc of candidate.documents) {
            await rpc('assert_gmail_sync_lease',args(c));
            const path = `${c.userId}/gmail/${c.runId}/${crypto.randomUUID()}`;
            const uploaded = await admin.storage.from('expense-documents').upload(path,doc.bytes,{ contentType:doc.detectedMime,upsert:false });
            if(uploaded.error) throw new GmailSyncError();
            const { bytes, ...metadata } = doc; docs.push({ ...metadata, storagePath:path, byteSize:bytes.length });
          }
          const metadata = { ...candidate, documents: undefined };
          return await rpc('import_gmail_candidate',{ ...args(c), p_candidate: { ...metadata, documents:docs } });
        } finally {
          // The RPC waits on the import lock and reserves an unreferenced path
          // against delayed imports before allowing Storage removal.
          for(const doc of docs) {
            try { const safe = await rpc('gmail_object_is_unreferenced',{ p_user_id:c.userId,p_path:doc.storagePath }); if(safe) await admin.storage.from('expense-documents').remove([doc.storagePath]); } catch { /* Retryable private orphan; never remove on an uncertain database result. */ }
          }
        }
      },
      async completeCandidate(c,messageId) { await rpc('complete_gmail_candidate',{ ...args(c), p_message_id:messageId }); },
      async recordItemError(c,messageId,attachmentId) { await rpc('record_gmail_item_error',{...args(c),p_message_id:messageId,p_attachment_id:attachmentId}); },
      async finish(c,cursor,summary,historyId) { await rpc('finish_gmail_sync',{ ...args(c),p_cursor:cursor,p_summary:summary,p_history_id:historyId ?? null }); token = undefined; grant = undefined; },
      async fail(c,revoked) { try { await rpc('fail_gmail_sync',{ ...args(c),p_revoked:revoked }); } finally { token = undefined; grant = undefined; } },
    };
  };
  return { origin:lifecycle.config.appOrigin, authenticate:lifecycle.authenticate,
    sync:(user:string)=>syncForUser(user,forUser()), cronSecret:env('GMAIL_CRON_SECRET'),
    async scheduledUsers(queuedOnly: boolean) { return await rpc('gmail_scheduled_users',{p_queued_only:queuedOnly}) as { user_id:string }[]; },
  };
}
