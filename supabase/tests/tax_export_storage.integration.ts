// Explicit local integration: real Auth, PostgREST, RLS, Storage and ZIP bytes.
// Requires an empty local Auth database. Never accepts a remote API origin.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { deepEqual, equal, match, ok } from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { handleRequest } from '../functions/create-tax-export/index.ts';
import { sha256 } from '../functions/create-tax-export/package.ts';

const encode = (value: string) => new TextEncoder().encode(value);
const decode = (value: Uint8Array) => new TextDecoder().decode(value);
async function db(statement: string) {
  const child = new Deno.Command('docker', { args: ['exec', '-i', 'supabase_db_finance-dashboard', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], stdin: 'piped', stdout: 'piped', stderr: 'piped' }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(encode(statement)); await writer.close();
  const output = await child.output();
  if (!output.success) throw new Error(`Local SQL failed: ${decode(output.stderr)}`);
  return decode(output.stdout).trim();
}
async function value<T extends { data: unknown; error: unknown }>(query: PromiseLike<T>): Promise<NonNullable<T['data']>> {
  const { data, error } = await query;
  if (error || data === null) throw new Error(`Local fixture API failed: ${JSON.stringify(error)}`);
  return data as NonNullable<T['data']>;
}

Deno.test('actual local two-user exports preserve original ZIP bytes and enforce RLS/lease/expiry boundaries', async () => {
  equal(await db('select count(*) from auth.users'), '0', 'Use an empty disposable local Auth database for this test.');
  const cli = await new Deno.Command('npx', { args: ['--yes', 'supabase@2.117.0', 'status', '--output', 'json'], stdout: 'piped', stderr: 'piped' }).output();
  ok(cli.success, 'Compatible local Supabase CLI must be available.');
  const config = JSON.parse(decode(cli.stdout));
  equal(new URL(config.API_URL).hostname, '127.0.0.1', 'This integration test is local-only.');
  const previousOwner = await db("select pg_get_functiondef('public.is_owner()'::regprocedure)");
  const env = { SUPABASE_URL: config.API_URL, SUPABASE_ANON_KEY: config.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: config.SERVICE_ROLE_KEY };
  const oldEnv = Object.fromEntries(Object.keys(env).map((key) => [key, Deno.env.get(key)]));
  for (const [key, entry] of Object.entries(env)) Deno.env.set(key, entry);
  const admin = createClient(config.API_URL, config.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const userIds: string[] = [];
  const expenseIds: string[] = [];
  const invoiceIds: string[] = [];
  const clientId = crypto.randomUUID();
  const objects: { bucket: string; path: string }[] = [];
  const password = crypto.randomUUID() + '-aA1!';
  const documentBytes = encode('%PDF-1.7\nLocal original invoice bytes.');
  const supportBytes = encode('%PDF-1.7\nLocal original supporting receipt.');
  const privateBytes = encode('%PDF-1.7\nOTHER USER SECRET DOCUMENT');
  const hashes = await Promise.all([documentBytes, supportBytes, privateBytes].map(sha256));
  const year = 2001;
  let owner: SupabaseClient;
  let other: SupabaseClient;
  try {
    for (const label of ['owner', 'other']) {
      const email = `tax-export-${label}-${crypto.randomUUID()}@example.test`;
      const created = await value(admin.auth.admin.createUser({ email, password, email_confirm: true }));
      ok(created.user); userIds.push(created.user.id);
      const client = createClient(config.API_URL, config.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
      await value(client.auth.signInWithPassword({ email, password }));
      if (label === 'owner') owner = client; else other = client;
    }
    await db(`create or replace function public.is_owner() returns boolean language sql stable security invoker set search_path='' as $$ select auth.uid()='${userIds[0]}'::uuid $$;`);
    const ownerToken = (await value(owner!.auth.getSession())).session!.access_token;
    const otherToken = (await value(other!.auth.getSession())).session!.access_token;
    const call = (body: unknown, token = ownerToken) => handleRequest(new Request(`${config.API_URL}/functions/v1/create-tax-export`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));

    // One owner expense with two originals; another user's booked expense must
    // remain absent from every owner-visible query and resulting ZIP.
    for (let index = 0; index < 2; index++) {
      const expenseId = crypto.randomUUID(); expenseIds.push(expenseId);
      await value(admin.from('expenses').insert({ id: expenseId, user_id: userIds[index], vendor: index ? 'Private other vendor' : 'Visible vendor', category: 'software', expense_date: `${year - 1}-12-31`, paid_date: `${year}-01-02`, net_amount: 100, vat_amount: 19 }).select('id'));
      const docs = index ? [privateBytes] : [documentBytes, supportBytes];
      for (let documentIndex = 0; documentIndex < docs.length; documentIndex++) {
        const bytes = docs[documentIndex];
        const id = crypto.randomUUID();
        const path = `${userIds[index]}/${expenseId}/${id}.pdf`;
        await value(admin.storage.from('expense-documents').upload(path, bytes, { contentType: 'application/pdf' }));
        objects.push({ bucket: 'expense-documents', path });
        await value(admin.from('expense_documents').insert({ id, expense_id: expenseId, user_id: userIds[index], document_role: documentIndex ? 'supporting' : 'invoice', is_primary: documentIndex === 0, storage_path: path, filename: documentIndex ? 'support.pdf' : 'invoice.pdf', declared_mime_type: 'application/pdf', detected_mime_type: 'application/pdf', byte_size: bytes.length, sha256: hashes[index ? 2 : documentIndex] }).select('id'));
      }
      await value(admin.from('expenses').update({ status: 'booked' }).eq('id', expenseId).select('id'));
    }
    equal((await value(owner!.from('expenses').select('id'))).length, 1);
    equal((await value(other!.from('expenses').select('id'))).length, 0);
    const otherPath = objects.find((object) => object.path.startsWith(userIds[1]))!.path;
    ok((await owner!.storage.from('expense-documents').download(otherPath)).error);
    ok((await other!.storage.from('expense-documents').download(objects[0].path)).error);

    const expenseJob = await (await call({ kind: 'business_expenses', year })).json();
    equal(expenseJob.status, 'completed', JSON.stringify(expenseJob));
    const expenseDownload = await fetch(expenseJob.downloadUrl);
    equal(expenseDownload.status, 200);
    const expenseZip = unzipSync(new Uint8Array(await expenseDownload.arrayBuffer()));
    const csv = expenseZip[`business-expenses-${year}.csv`];
    deepEqual([...csv.slice(0, 3)], [239, 187, 191]);
    match(decode(csv), /"2001-01-02";"2000-12-31";"2001-01-02";"Visible vendor"/);
    ok(!decode(csv).includes('Private other vendor'));
    const originals = Object.entries(expenseZip).filter(([name]) => name.startsWith('expenses/')).map(([, bytes]) => decode(bytes));
    deepEqual(originals.sort(), [decode(documentBytes), decode(supportBytes)].sort());
    ok(!originals.includes(decode(privateBytes)));
    match(decode(expenseZip['README.txt']), /Document-count: 2/);
    match(decode(expenseZip['README.txt']), /Total gross \(EUR\): 119.00/);
    equal((await call({ kind: 'business_expenses', year }, otherToken)).status, 403);
    equal((await value(other!.from('tax_export_jobs').select('id').eq('id', expenseJob.id))).length, 0);

    await value(owner!.from('clients').insert({ id: clientId, name: 'Archive fixture' }).select('id'));
    const invoiceId = crypto.randomUUID(); invoiceIds.push(invoiceId);
    await value(owner!.from('invoices').insert({ id: invoiceId, invoice_number: `LOCAL-${invoiceId}`, date: `${year}-03-01`, due_date: `${year}-03-15`, client_id: clientId, client_name: 'Archive fixture', status: 'draft', subtotal: 100, vat_amount: 19, total: 119 }).select('id'));
    equal(await value(owner!.rpc('prepare_invoice_archive', { p_invoice_id: invoiceId, p_expected_revision: 0, p_intent: 'issue' })), true);
    const invoicePath = `${userIds[0]}/${invoiceId}/${hashes[0]}.pdf`;
    await value(owner!.storage.from('issued-invoices').upload(invoicePath, documentBytes, { contentType: 'application/pdf' }));
    objects.push({ bucket: 'issued-invoices', path: invoicePath });
    equal(await value(owner!.rpc('archive_issued_invoice_pdf', { p_invoice_id: invoiceId, p_storage_path: invoicePath, p_sha256: hashes[0], p_expected_revision: 0, p_intent: 'issue' })), true);
    const invoiceJob = await (await call({ kind: 'issued_invoices', year })).json();
    equal(invoiceJob.status, 'completed', JSON.stringify(invoiceJob));
    const invoiceDownload = await fetch(invoiceJob.downloadUrl);
    equal(invoiceDownload.status, 200);
    const invoiceZip = unzipSync(new Uint8Array(await invoiceDownload.arrayBuffer()));
    const archived = Object.entries(invoiceZip).filter(([name]) => name.endsWith('.pdf'));
    equal(archived.length, 1); deepEqual(archived[0][1], documentBytes);

    const jobs = await value(admin.from('tax_export_jobs').select('id,storage_path').in('user_id', userIds));
    for (const job of jobs) if (job.storage_path) objects.push({ bucket: 'tax-exports', path: job.storage_path });
    const invoiceZipPath = jobs.find((job) => job.id === invoiceJob.id)!.storage_path;
    ok((await other!.storage.from('tax-exports').createSignedUrl(invoiceZipPath, 900)).error);
    // A real DB deadline blocks both the function and direct Storage signing.
    await db(`update public.tax_export_jobs set expires_at=requested_at+interval '1 millisecond' where id='${invoiceJob.id}';`);
    const expired = await (await call({ mode: 'status', jobId: invoiceJob.id })).json();
    equal(expired.status, 'expired'); equal(expired.downloadUrl, undefined);
    ok((await owner!.storage.from('tax-exports').createSignedUrl(invoiceZipPath, 900)).error);
    const cleanup = await call({ mode: 'cleanup' }, config.SERVICE_ROLE_KEY);
    equal(cleanup.status, 200);
    equal((await cleanup.json()).failed, 0);
    ok((await admin.storage.from('tax-exports').download(invoiceZipPath)).error);
    ok((await admin.storage.from('tax-exports').upload(invoiceZipPath, documentBytes, { contentType: 'application/zip' })).error, 'Revoked/expired lease must reject a late upload after cleanup.');

    // Real status timeout wins the finalization race and no lease can be reused.
    const leaseId = crypto.randomUUID(); const leaseToken = crypto.randomUUID();
    await value(admin.from('tax_export_jobs').insert({ id: leaseId, user_id: userIds[0], tax_year: year, export_kind: 'issued_invoices', expires_at: new Date(Date.now() + 86400000).toISOString() }).select('id'));
    equal((await value(admin.rpc('claim_tax_export_job', { p_id: leaseId, p_user_id: userIds[0], p_token: leaseToken }))).length, 1);
    await db(`update public.tax_export_jobs set lease_expires_at=now()-interval '1 second' where id='${leaseId}';`);
    equal((await (await call({ mode: 'status', jobId: leaseId })).json()).status, 'failed');
    equal((await value(admin.rpc('complete_tax_export_job', { p_id: leaseId, p_user_id: userIds[0], p_token: leaseToken, p_sha256: hashes[0], p_byte_size: 100 }))).length, 0);
  } finally {
    // Restrict cleanup to generated fixture IDs. Triggers are bypassed only in
    // this local cleanup transaction because booked sources are immutable.
    for (const object of objects) await admin.storage.from(object.bucket).remove([object.path]);
    const quoted = (ids: string[]) => ids.map((id) => `'${id}'::uuid`).join(',') || 'null::uuid';
    await db(`begin; set local session_replication_role=replica;
      delete from public.tax_export_jobs where user_id in (${quoted(userIds)});
      delete from public.expense_audit_log where user_id in (${quoted(userIds)});
      delete from public.expense_documents where expense_id in (${quoted(expenseIds)});
      delete from public.expenses where id in (${quoted(expenseIds)});
      delete from public.invoice_line_items where invoice_id in (${quoted(invoiceIds)});
      delete from public.invoices where id in (${quoted(invoiceIds)});
      delete from public.clients where id='${clientId}';
      ${previousOwner}; commit;`);
    for (const id of userIds) await admin.auth.admin.deleteUser(id);
    for (const [key, entry] of Object.entries(oldEnv)) { if (entry === undefined) Deno.env.delete(key); else Deno.env.set(key, entry); }
  }
});
