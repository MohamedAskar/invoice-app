import { attachments, detectDocument, filterAttachment, invoiceNamed, receiptNamed, senderOf, type DetectedMime, type GmailMessage, type IssuedInvoice, type MimePart, type VendorRule } from '../_shared/gmail-candidate-filter.ts';
export type { GmailMessage };
export interface SyncSummary { candidates: number; documents: number; ignored: number; skipped: number; needsReview: number }
export interface Cursor { mode: 'search' | 'history'; pageToken?: string; historyStart?: string; targetHistory: string; after?: string; pendingIds?: string[]; attachmentOffset?: number; nextPageToken?: string }
export interface SyncConnection { id: string; userId: string; address: string; runId: string; cursor: Cursor | null }
export interface CandidateDocument { attachmentId: string; filename: string; declaredMime: string; detectedMime: DetectedMime; bytes: Uint8Array; sha256: string; role: 'invoice' | 'receipt' | 'supporting'; primary: boolean; reason: string; ruleId: string | null }
export interface Candidate { messageId: string; threadId?: string; senderEmail: string; senderDomain: string; vendor: string; receivedAt: string; multiple: boolean; complete: boolean; ignored: number; skipped: number; documents: CandidateDocument[] }
export interface SyncDependencies {
  claim(userId: string): Promise<SyncConnection | null>;
  rules(c: SyncConnection): Promise<VendorRule[]>; issuedInvoices(c: SyncConnection): Promise<IssuedInvoice[]>;
  page(c: SyncConnection): Promise<{ messages: GmailMessage[]; next: Cursor | null; resume?: Cursor; historyId?: string }>;
  attachment(c: SyncConnection, m: GmailMessage, p: MimePart): Promise<Uint8Array>;
  seen(c: SyncConnection, messageId: string, attachmentId: string): Promise<boolean>;
  hasChecksum(c: SyncConnection, sha: string): Promise<boolean>;
  insertExpense(c: SyncConnection, candidate: Candidate): Promise<{ candidates: number; documents: number; skipped: number }>;
  completeCandidate?(c: SyncConnection, messageId: string): Promise<void>;
  finish(c: SyncConnection, cursor: Cursor | null, summary: SyncSummary, historyId?: string): Promise<void>;
  fail(c: SyncConnection, revoked: boolean): Promise<void>;
}
export class GmailSyncError extends Error { constructor(public code: 'reauthorization_required' | 'sync_failed' | 'busy' = 'sync_failed') { super(code); } }
export async function syncForUser(userId: string, deps: SyncDependencies): Promise<SyncSummary> {
  const c = await deps.claim(userId);
  if (!c) throw new GmailSyncError('busy');
  const summary: SyncSummary = { candidates: 0, documents: 0, ignored: 0, skipped: 0, needsReview: 0 };
  try {
    const [rules, issued] = await Promise.all([deps.rules(c), deps.issuedInvoices(c)]);
    const page = await deps.page(c);
    if (page.messages.length > 100) throw new GmailSyncError();
    let used = 0, bytesBudget = 0, next = page.next;
    for (let i = 0; i < page.messages.length; i++) {
      const m = page.messages[i];
      const sender = senderOf(m);
      const allParts = attachments(m.payload);
      const offset = i === 0 && m.id === c.cursor?.pendingIds?.[0] ? c.cursor?.attachmentOffset ?? 0 : 0;
      const remaining = allParts.slice(offset);
      const selected: MimePart[] = [];
      for (const part of remaining.slice(0, 200 - used)) {
        const size = Math.min(part.body?.size ?? 0, 15 * 1024 * 1024);
        if (bytesBudget + size > 32 * 1024 * 1024) break;
        bytesBudget += size; selected.push(part);
      }
      const candidate: Candidate = { messageId: m.id, threadId: m.threadId, senderEmail: sender.email, senderDomain: sender.domain, vendor: sender.vendor,
        receivedAt: new Date(Number(m.internalDate)).toISOString(), multiple: allParts.filter(p => invoiceNamed(p.filename ?? '') && filterAttachment(m,p,c.address,rules,issued).include).length > 1, complete: selected.length === remaining.length, ignored: 0, skipped: 0, documents: [] };
      for (const part of selected) {
        used++;
        const filtered = filterAttachment(m, part, c.address, rules, issued);
        if (!filtered.include) { summary.ignored++; candidate.ignored++; continue; }
        const attachmentId = part.body!.attachmentId!;
        if (await deps.seen(c, m.id, attachmentId)) { summary.skipped++; candidate.skipped++; continue; }
        const bytes = await deps.attachment(c, m, part);
        const mime = detectDocument(bytes, part);
        if (!mime) { summary.ignored++; candidate.ignored++; continue; }
        const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>))].map(b => b.toString(16).padStart(2,'0')).join('');
        if (candidate.documents.some(d => d.sha256 === sha) || await deps.hasChecksum(c, sha)) { summary.skipped++; candidate.skipped++; continue; }
        candidate.documents.push({ attachmentId, filename: [...part.filename!].filter(ch => ch.charCodeAt(0) >= 32).join('').slice(0,255), declaredMime: part.mimeType!, detectedMime: mime, bytes, sha256: sha,
          role: invoiceNamed(part.filename!) ? 'invoice' : receiptNamed(part.filename!) ? 'receipt' : 'supporting', primary: false, reason: filtered.reason, ruleId: filtered.ruleId });
      }
      if (candidate.documents.length) {
        (candidate.documents.find(d => d.role === 'invoice' && d.detectedMime === 'application/pdf') ?? candidate.documents[0]).primary = true;
        const imported = await deps.insertExpense(c, candidate);
        summary.candidates += imported.candidates; summary.needsReview += imported.candidates; summary.documents += imported.documents; summary.skipped += imported.skipped;
      } else if (offset > 0 && candidate.complete) {
        await deps.completeCandidate?.(c,m.id);
      }
      if (selected.length < remaining.length || (used === 200 && i + 1 < page.messages.length)) {
        if (!page.resume) throw new GmailSyncError();
        const partial = selected.length < remaining.length;
        next = { ...page.resume, pendingIds: [...page.messages.slice(partial ? i : i + 1).map(m => m.id), ...(page.next?.pendingIds ?? [])], attachmentOffset: partial ? offset + selected.length : 0 };
        break;
      }
    }
    await deps.finish(c, next, summary, page.historyId);
    return summary;
  } catch (error) {
    const revoked = error instanceof GmailSyncError && error.code === 'reauthorization_required';
    await deps.fail(c, revoked);
    throw new GmailSyncError(revoked ? 'reauthorization_required' : 'sync_failed');
  }
}
export async function handleManualSync(request: Request, deps: { origin: string; authenticate(jwt: string): Promise<string | null>; sync(user: string): Promise<SyncSummary> }) {
  const headers = { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': deps.origin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' };
  const response = (body: unknown, status = 200) => Response.json(body, { status, headers });
  if (request.headers.get('origin') && request.headers.get('origin') !== deps.origin) return response({ error: 'Origin not allowed.' }, 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return response({ error: 'Method not allowed.' }, 405);
  const jwt = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
  const user = jwt ? await deps.authenticate(jwt) : null;
  if (!user) return response({ error: 'Sign in to sync Gmail.' }, 401);
  try { return response(await deps.sync(user)); }
  catch (error) { return response({ error: error instanceof GmailSyncError && error.code === 'reauthorization_required' ? 'Reconnect Gmail to continue.' : 'Could not sync Gmail. Try again.', code: error instanceof GmailSyncError ? error.code : 'sync_failed' }, error instanceof GmailSyncError && error.code === 'busy' ? 409 : 503); }
}
if (import.meta.main) {
  const { syncRuntime } = await import('../_shared/gmail-sync-runtime.ts');
  Deno.serve(async request => {
    try { const runtime = syncRuntime(name => Deno.env.get(name)); return await handleManualSync(request, runtime); }
    catch { return Response.json({ error: 'Gmail sync is unavailable.' }, { status: 503 }); }
  });
}
