// Two real local PostgreSQL sessions. All IDs/data are synthetic and cleaned up.
import postgres from 'npm:postgres@3.4.7';
import { equal, ok } from 'node:assert/strict';

const connect = () => postgres('postgres://postgres:postgres@127.0.0.1:54322/postgres', { max: 1, onnotice() {} });
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
async function fixture(run: (f: { db: ReturnType<typeof connect>; other: ReturnType<typeof connect>; user: string; runId: string; candidate: ReturnType<typeof candidate> }) => Promise<void>) {
  const db = connect(), other = connect(); const user = crypto.randomUUID();
  const previousOwner = (await db`select pg_get_functiondef('public.is_owner()'::regprocedure) as sql`)[0].sql;
  try {
    equal((await db`select count(*)::int as count from auth.users`)[0].count, 0, 'Requires disposable local Auth database.');
    await db`insert into auth.users(id,email) values(${user},${`${user}@example.test`})`;
    await db.unsafe(`create or replace function public.is_owner() returns boolean language sql stable set search_path='' as $$ select auth.uid()='${user}'::uuid $$`);
    await db`insert into public.gmail_connections(user_id,gmail_address,access_token_encrypted,refresh_token_encrypted,status,daily_sync_enabled)
      values(${user},'owner@example.test','synthetic','synthetic','active',false)`;
    const row = (await db`select * from public.claim_gmail_sync(${user})`)[0];
    await run({ db, other, user, runId: row.sync_run_id, candidate: candidate(user) });
  } finally {
    await db`delete from public.gmail_imports where user_id=${user}`;
    await db`delete from public.expense_documents where user_id=${user}`;
    await db`delete from public.expenses where user_id=${user}`;
    await db`delete from public.gmail_sync_runs where user_id=${user}`;
    await db`delete from public.gmail_connections where user_id=${user}`;
    await db`delete from auth.users where id=${user}`;
    await db.unsafe(previousOwner);
    await Promise.all([db.end(), other.end()]);
  }
}
function candidate(user: string) {
  return { messageId: 'message', vendor: 'Synthetic', senderDomain: 'supplier.test', senderEmail: 'billing@supplier.test', receivedAt: '2026-09-01T10:00:00Z', multiple: true, complete: true, ignored: 0, skipped: 0,
    documents: [0,1,2].map(i => ({ attachmentId: `attachment-${i}`, filename: `Invoice-${i}.pdf`, role: 'invoice', primary: i === 0, reason: 'invoice_filename', sha256: String(i).repeat(64), declaredMime: 'application/pdf', detectedMime: 'application/pdf', byteSize: 100, storagePath: `${user}/gmail/run/${i}` })) };
}

Deno.test('ambiguous import cleanup waits for the importing transaction before authorizing deletion', async () => {
  await fixture(async f => {
    const imported = deferred(), release = deferred(), cleanupStarted = deferred();
    let cleanupFinished = false;
    const transaction = f.db.begin(async tx => {
      await tx`set local role service_role`;
      await tx`select public.import_gmail_candidate(${f.user},${f.runId},${tx.json(f.candidate)})`;
      imported.resolve(); await release.promise;
    });
    await imported.promise;
    const cleanup = f.other.begin(async tx => {
      await tx`set local role service_role`;
      cleanupStarted.resolve();
      const result = (await tx`select public.gmail_object_is_unreferenced(${f.user},${f.candidate.documents[0].storagePath}) as safe`)[0].safe;
      cleanupFinished = true; return result;
    });
    await cleanupStarted.promise;
    try {
      // The RPC response is lost while its importing transaction remains open.
      await new Promise(r => setTimeout(r, 150));
      equal(cleanupFinished, false, 'Cleanup returned true from an uncommitted snapshot.');
    } finally { release.resolve(); await transaction; }
    equal(await cleanup, false, 'Referenced evidence was authorized for deletion.');
  });
});

Deno.test('cleanup winning first permanently prevents a delayed import from referencing its path', async () => {
  await fixture(async f => {
    await f.db.begin(async tx => {
      await tx`set local role service_role`;
      equal((await tx`select public.gmail_object_is_unreferenced(${f.user},${f.candidate.documents[0].storagePath}) as safe`)[0].safe,true);
    });
    let rejected = false;
    try { await f.other`select public.import_gmail_candidate(${f.user},${f.runId},${f.other.json(f.candidate)})`; }
    catch { rejected = true; }
    ok(rejected, 'Delayed import referenced a path already reserved for deletion.');
    equal((await f.db`select count(*)::int as count from public.expense_documents where user_id=${f.user}`)[0].count,0);
  });
});

Deno.test('two split sessions cannot move the same document twice or detach its import mapping', async () => {
  await fixture(async f => {
    await f.db`select public.import_gmail_candidate(${f.user},${f.runId},${f.db.json(f.candidate)})`;
    const document = (await f.db`select id,expense_id from public.expense_documents where user_id=${f.user} and filename='Invoice-0.pdf'`)[0];
    const locked = deferred(), release = deferred();
    const first = f.db.begin(async tx => {
      await tx`select * from public.expenses where id=${document.expense_id} for update`;
      await tx`select set_config('request.jwt.claims',${JSON.stringify({sub:f.user,role:'authenticated'})},true)`;
      locked.resolve(); await release.promise;
      return (await tx`select public.split_gmail_expense_document(${document.id}) as id`)[0].id;
    });
    await locked.promise;
    let secondError = '';
    const second = f.other.begin(async tx => {
      await tx`select set_config('request.jwt.claims',${JSON.stringify({sub:f.user,role:'authenticated'})},true)`;
      await tx`select public.split_gmail_expense_document(${document.id})`;
    }).catch(error => { secondError=error.message; });
    await new Promise(r => setTimeout(r,150)); release.resolve();
    const finalId = await first; await second;
    equal(secondError,'split_unavailable','A stale document snapshot permitted a second split.');
    const rows = await f.db`select d.expense_id=i.expense_id as matches,d.expense_id from public.expense_documents d join public.gmail_imports i on i.storage_path=d.storage_path where d.id=${document.id}`;
    equal(rows[0].matches,true); equal(rows[0].expense_id,finalId);
    equal((await f.db`select count(*)::int as count from public.expenses where user_id=${f.user}`)[0].count,2);
  });
});
