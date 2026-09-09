import { GmailSyncError, handleManualSync, syncForUser, type SyncDependencies, type GmailMessage, type Candidate, type Cursor } from './index.ts';
import { handleScheduledSync } from '../gmail-sync-scheduled/index.ts';

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
const incomingMessage = (id: string, filenames: string[]): GmailMessage => ({
  id, internalDate: '1788220800000', labelIds: ['INBOX'],
  payload: { headers: [{ name: 'From', value: 'Supplier <billing@supplier.test>' }, { name: 'Subject', value: 'Your invoice and receipt' }],
    parts: filenames.map((filename, i) => ({ filename, mimeType: 'application/pdf', body: { attachmentId: `${id}-${i}`, size: 32 } })) },
});

function fixture(messages: GmailMessage[]) {
  const candidates: Candidate[] = [], events: string[] = [];
  let cursor: Cursor | null = null;
  const deps: SyncDependencies = {
    async claim(){return {id:'connection',userId:'user',address:'me@example.com',runId:'run',cursor:null};},
    async rules(){return [];},async issuedInvoices(){return [];},
    async page(){return {messages,next:null,resume:{mode:'search',targetHistory:'100'}};},
    async attachment(_c,m,p){events.push('download');return new TextEncoder().encode(`%PDF-1.7\n${m.id}-${p.filename}\n%%EOF`);},
    async seen(){return false;},async hasChecksum(){return false;},
    async insertExpense(_c,candidate){events.push('commit');candidates.push(candidate);return {candidates:1,documents:candidate.documents.length,skipped:0};},
    async finish(_c,next){events.push('cursor');cursor=next;},async fail(_c,revoked){events.push(revoked?'reauth':'failed');},
  };
  return {deps,candidates,events,cursor:()=>cursor};
}
Deno.test('multiple invoices stay grouped with the first invoice PDF primary and receipt supporting',async()=>{
  const f=fixture([incomingMessage('m',['Receipt.pdf','Invoice-a.pdf','Invoice-b.pdf'])]);
  await syncForUser('user',f.deps);
  equal(f.candidates.length,1);equal(f.candidates[0].multiple,true);
  equal(f.candidates[0].documents.map(d=>[d.role,d.primary]),[['receipt',false],['invoice',true],['invoice',false]]);
  equal(f.events.slice(-2),['commit','cursor']);
});
Deno.test('checksum duplicates never copy or create a candidate',async()=>{
  const f=fixture([incomingMessage('m',['Invoice.pdf'])]);f.deps.hasChecksum=async()=>true;
  equal(await syncForUser('user',f.deps),{candidates:0,documents:0,ignored:0,skipped:1,needsReview:0});equal(f.candidates.length,0);
});
Deno.test('imports are limited to 200 attachments with a resumable incomplete candidate',async()=>{
  const f=fixture([incomingMessage('m',Array.from({length:201},(_,i)=>`Invoice-${i}.pdf`))]);
  const result=await syncForUser('user',f.deps);
  equal(result.documents,200);equal(f.candidates[0].complete,false);equal(f.cursor()?.attachmentOffset,200);equal(f.cursor()?.pendingIds,['m']);
});
Deno.test('failed import preserves cursor and revoked authentication stops after one attempt',async()=>{
  for(const revoked of [false,true]) {
    const f=fixture([incomingMessage('m',['Invoice.pdf'])]);
    f.deps.insertExpense=async()=>{throw new GmailSyncError(revoked?'reauthorization_required':'sync_failed');};
    let code='';try{await syncForUser('user',f.deps);}catch(error){code=(error as GmailSyncError).code;}
    equal(code,revoked?'reauthorization_required':'sync_failed');equal(f.events.includes('cursor'),false);equal(f.events.at(-1),revoked?'reauth':'failed');
  }
});
Deno.test('manual endpoint verifies the JWT, owner and origin before accessing any mailbox',async()=>{
  const users:string[]=[];
  const deps={origin:'https://app.example',authenticate:async(jwt:string)=>jwt==='valid'?'owner':null,sync:async(user:string)=>{users.push(user);return {candidates:0,documents:0,ignored:0,skipped:0,needsReview:0};}};
  const request=(token?:string,origin='https://app.example')=>new Request('https://local/gmail-sync',{method:'POST',headers:{Origin:origin,...(token?{Authorization:`Bearer ${token}`}:{})}});
  equal((await handleManualSync(request(),deps)).status,401);equal((await handleManualSync(request('service-role'),deps)).status,401);
  equal((await handleManualSync(request('valid','https://evil.example'),deps)).status,403);equal(users.length,0);
  equal((await handleManualSync(request('valid'),deps)).status,200);equal(users,['owner']);
});
Deno.test('scheduled endpoint accepts only the dedicated secret and isolates failed users',async()=>{
  const users:string[]=[]; const secret='s'.repeat(48);
  const deps={cronSecret:secret,scheduledUsers:async()=>[{user_id:'a'},{user_id:'b'}],sync:async(user:string)=>{users.push(user);if(user==='a')throw new Error('provider private details');return {};}};
  const req=(headers:Record<string,string>)=>new Request('https://local/gmail-sync-scheduled',{method:'POST',headers,body:JSON.stringify({mode:'daily'})});
  equal((await handleScheduledSync(req({Authorization:'Bearer service-role'}),deps)).status,401);
  equal((await handleScheduledSync(req({'x-gmail-cron-secret':'wrong'}),deps)).status,401);equal(users.length,0);
  const response=await handleScheduledSync(req({'x-gmail-cron-secret':secret}),deps);equal(await response.json(),{completed:1,failed:1});equal(users,['a','b']);
});

Deno.test('groups an invoice and receipt while excluding unrelated and sent PDFs', async () => {
  const sent = incomingMessage('message-b', ['Rechnung-2026-008.pdf']); sent.labelIds = ['SENT'];
  let inserts = 0;
  const sources = new Set<string>();
  const deps: SyncDependencies = {
    async claim() { return { id: 'connection', userId: 'user', address: 'me@example.com', runId: 'run', cursor: null }; },
    async rules() { return []; }, async issuedInvoices() { return []; },
    async page() { return { messages: [incomingMessage('message-a', ['Invoice-123.pdf', 'Receipt-123.pdf', 'Terms.pdf']), sent], next: null }; },
    async attachment(_connection, message, part) { return new TextEncoder().encode(`%PDF-1.7\n${message.id}-${part.filename}\n%%EOF`); },
    async seen(_connection, messageId, attachmentId) { return sources.has(`${messageId}/${attachmentId}`); },
    async hasChecksum() { return false; },
    async insertExpense(_connection, candidate) { inserts++; for (const d of candidate.documents) sources.add(`${candidate.messageId}/${d.attachmentId}`); return { candidates: 1, documents: candidate.documents.length, skipped: 0 }; },
    async finish() {}, async fail() {},
  };
  equal(await syncForUser('user', deps), { candidates: 1, documents: 2, ignored: 2, skipped: 0, needsReview: 1 });
  equal(inserts, 1);
  equal(await syncForUser('user', deps), { candidates: 0, documents: 0, ignored: 2, skipped: 2, needsReview: 0 });
  equal(inserts, 1);
});
