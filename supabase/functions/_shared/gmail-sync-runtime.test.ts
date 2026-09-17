import { deepStrictEqual as equal, rejects, ok } from 'node:assert/strict';
import * as runtime from './gmail-sync-runtime.ts';
import { encryptSecret } from './google-oauth.ts';
import { validPdf } from './gmail-test-fixtures.ts';

Deno.test('bounded JSON reader rejects declared oversize before reading and cancels chunked overflow', async () => {
  ok('readBoundedJson' in runtime, 'Provider JSON needs a reader that caps bytes before buffering.');
  const read = runtime.readBoundedJson as (response: Response, cap: number) => Promise<unknown>;
  let pulls = 0, cancelled = false;
  const stream = () => new ReadableStream<Uint8Array>({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(8)); }, cancel() { cancelled=true; } },{highWaterMark:0});
  await rejects(read(new Response(stream(),{headers:{'Content-Length':'100'}}),16));
  equal(pulls,0); equal(cancelled,true);
  pulls=0; cancelled=false;
  await rejects(read(new Response(stream()),16));
  equal(pulls,3); equal(cancelled,true);
  equal(await read(new Response('{"ok":true}'),16),{ok:true});
});

async function runtimeFixture(ambiguous = false, retryMessageId?: string) {
  const env: Record<string,string> = { SUPABASE_URL:'http://127.0.0.1:54321',SUPABASE_ANON_KEY:'synthetic',SUPABASE_SERVICE_ROLE_KEY:'synthetic',
    GOOGLE_OAUTH_CLIENT_ID:'synthetic',GOOGLE_OAUTH_CLIENT_SECRET:'synthetic',GOOGLE_OAUTH_REDIRECT_URI:'http://127.0.0.1:54321/functions/v1/gmail-callback',
    GMAIL_APP_ORIGIN:'https://app.example',GMAIL_TOKEN_ENCRYPTION_KEY:btoa('01234567890123456789012345678901') };
  const encrypted = await encryptSecret('synthetic-access',env.GMAIL_TOKEN_ENCRYPTION_KEY,'user:access');
  const rpcCalls: {name:string;body:Record<string,unknown>}[] = []; const removed:string[] = [], referenced:string[] = [];
  const persistence: typeof fetch = async (input,options) => {
    const url = new URL(String(input)); const body = typeof options?.body === 'string' ? JSON.parse(options.body) : {};
    if(url.pathname.includes('/rest/v1/rpc/')) {
      const name = url.pathname.split('/').at(-1)!; rpcCalls.push({name,body});
      if(name === 'claim_gmail_sync') return Response.json([{id:'connection',user_id:'user',gmail_address:'me@example.test',sync_run_id:'run',sync_cursor:null,access_token_encrypted:encrypted,refresh_token_encrypted:'synthetic',token_expires_at:new Date(Date.now()+3600000).toISOString(),history_id:null}]);
      if(name === 'import_gmail_candidate') {
        referenced.push(...body.p_candidate.documents.map((d:{storagePath:string}) => d.storagePath));
        if(ambiguous) throw new Error('Connection closed after database commit');
        return Response.json({candidates:1,documents:body.p_candidate.documents.length,skipped:0});
      }
      if(name === 'gmail_object_is_unreferenced') return Response.json(!referenced.includes(body.p_path));
      return Response.json(null);
    }
    if(url.pathname === '/rest/v1/gmail_imports' && (!options?.method || options.method === 'GET')) {
      if (!retryMessageId) return Response.json([]);
      return Response.json(url.searchParams.get('select') === 'import_state'
        ? [{import_state:'failed'}] : [{gmail_message_id:retryMessageId}]);
    }
    if(url.pathname.startsWith('/rest/v1/')) return Response.json([]);
    if(url.pathname.startsWith('/storage/v1/object/')) {
      if(options?.method === 'DELETE') removed.push(...body.prefixes);
      return Response.json({Key:'synthetic'});
    }
    throw new Error('Unexpected persistence request');
  };
  const provider: typeof fetch = async input => {
    const url = new URL(String(input)); equal(url.hostname,'gmail.googleapis.com');
    if(url.pathname.endsWith('/profile')) return Response.json({emailAddress:'me@example.test',historyId:'100'});
    if(url.pathname.endsWith('/messages')) return Response.json({messages:(ambiguous?['good']:['missing','metadata-error','attachment-error','good']).map(id=>({id}))});
    if(url.pathname.includes('/attachments/')) {
      if(url.pathname.includes('attachment-error')) return new Response('private provider body',{status:503});
      const bytes=validPdf(); return Response.json({data:btoa(String.fromCharCode(...bytes)),size:bytes.length});
    }
    const id=url.pathname.split('/').at(-1)!;
    if(id==='missing') return new Response('private missing message',{status:404});
    if(id==='metadata-error') return new Response('private provider body',{status:503});
    return Response.json({id,internalDate:'1788220800000',payload:{headers:[{name:'From',value:'billing@supplier.test'}],parts:[{filename:'Invoice.pdf',mimeType:'application/octet-stream',body:{attachmentId:'a',size:500}}]}});
  };
  return {sync:runtime.syncRuntime(name=>env[name],provider,persistence).sync,rpcCalls,removed,referenced};
}

Deno.test('runtime records generic metadata/attachment errors and finishes later messages without exposing provider bodies', async () => {
  const f=await runtimeFixture();
  equal(await f.sync('user'),{candidates:1,documents:1,ignored:0,skipped:3,needsReview:1});
  equal(f.rpcCalls.filter(c=>c.name==='record_gmail_item_error').map(c=>c.body.p_message_id),['missing','metadata-error','attachment-error']);
  const finish=f.rpcCalls.find(c=>c.name==='finish_gmail_sync')!;
  equal(finish.body.p_cursor,null); equal(finish.body.p_history_id,'100');
  ok(!JSON.stringify(f.rpcCalls).includes('private provider')); equal(f.removed,[]);
});

Deno.test('a persisted transient failure is retried before normal discovery and can import once', async () => {
  const f=await runtimeFixture(false,'retry-message');
  equal(await f.sync('user'),{candidates:1,documents:1,ignored:0,skipped:0,needsReview:1});
  const imported=f.rpcCalls.find(call=>call.name==='import_gmail_candidate');
  equal((imported?.body.p_candidate as {messageId?:string} | undefined)?.messageId,'retry-message');
  const finish=f.rpcCalls.find(call=>call.name==='finish_gmail_sync')!;
  equal(finish.body.p_cursor,null);
});

Deno.test('ambiguous import RPC response retains referenced storage and preserves the unfinished cursor', async () => {
  const f=await runtimeFixture(true);
  await rejects(f.sync('user'));
  equal(f.referenced.length,1); equal(f.removed,[]);
  ok(f.rpcCalls.some(c=>c.name==='gmail_object_is_unreferenced'));
  ok(!f.rpcCalls.some(c=>c.name==='finish_gmail_sync'));
});
