import { deepEqual, equal, match, ok } from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { handleRequest } from './index.ts';
import { sha256 } from './package.ts';

const userId = '11111111-1111-4111-8111-111111111111';
const jobId = '22222222-2222-4222-8222-222222222222';
const bytes = new TextEncoder().encode('%PDF-1.7\noriginal');
const hash = await sha256(bytes);
const initialJob = () => ({ id: jobId, user_id: userId, tax_year: 2026, export_kind: 'issued_invoices', status: 'queued', requested_at: new Date().toISOString(), completed_at: null, expires_at: new Date(Date.now() + 86400000).toISOString(), storage_path: null as string | null, error_code: null, worker_token: null as string | null, lease_expires_at: new Date(Date.now() + 600000).toISOString(), cleanup_pending: false });

async function fixture(run: (state: {
  requests: { path: string; method: string; auth: string | null; body: unknown }[];
  uploads: Uint8Array[];
  setInvoice: (value: Record<string, unknown>) => void;
  setExpired: () => void;
  onUpload: (callback: () => void) => void;
  revokeLease: () => void;
  throwDeletion: () => void;
  throwRecoveryPersistence: () => void;
  getJob: () => ReturnType<typeof initialJob>;
}) => Promise<void>) {
  const previousFetch = globalThis.fetch;
  const env = { SUPABASE_URL: 'https://export-test.invalid', SUPABASE_ANON_KEY: 'test-anon-key', SUPABASE_SERVICE_ROLE_KEY: 'test-server-key' };
  const previousEnv = Object.fromEntries(Object.keys(env).map((key) => [key, Deno.env.get(key)]));
  for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
  const requests: { path: string; method: string; auth: string | null; body: unknown }[] = [];
  const uploads: Uint8Array[] = [];
  let job = initialJob();
  let uploadCallback = () => {};
  let deletionThrows = false;
  let recoveryThrows = false;
  let invoice: Record<string, unknown> = { id: 'invoice-1', invoice_number: 'INV-1', date: '2026-01-01', client_name: 'Test', subtotal: 100, vat_amount: 19, total: 119, status: 'paid', pdf_storage_path: `${userId}/invoice-1/original.pdf`, pdf_sha256: hash };
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    equal(url.origin, env.SUPABASE_URL);
    const bodyBytes = new Uint8Array(await request.arrayBuffer());
    let body: unknown;
    if (request.headers.get('content-type')?.includes('application/json') && bodyBytes.length) body = JSON.parse(new TextDecoder().decode(bodyBytes));
    const auth = request.headers.get('authorization');
    requests.push({ path: url.pathname + url.search, method: request.method, auth, body });
    if (url.pathname === '/auth/v1/user') return auth === 'Bearer verified-user-token' ? Response.json({ id: userId, email: 'owner@example.test' }) : Response.json({ message: 'invalid token' }, { status: 401 });
    if (url.pathname === '/rest/v1/rpc/is_owner') return Response.json(true);
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const name = url.pathname.split('/').pop();
      const args = body as Record<string, string>;
      if (name === 'claim_tax_export_job') {
        if (job.status !== 'queued') return Response.json([]);
        job = { ...job, status: 'running', worker_token: args.p_token, storage_path: `${userId}/issued_invoices-2026-${jobId}.zip` };
      } else if (name === 'complete_tax_export_job') {
        if (job.status !== 'running' || job.worker_token !== args.p_token || Date.parse(job.lease_expires_at) <= Date.now()) return Response.json([]);
        job = { ...job, status: 'completed', worker_token: null };
      } else if (name === 'fail_tax_export_job') {
        if (recoveryThrows) throw new Error('Injected persistence outage');
        if (['queued', 'running'].includes(job.status)) job = { ...job, status: 'failed', worker_token: null, cleanup_pending: true };
      } else if (name === 'claim_tax_export_cleanup') {
        if (['queued', 'running'].includes(job.status) && Date.parse(job.lease_expires_at) > Date.now()) return Response.json([]);
        job = { ...job, status: job.status === 'completed' ? 'expired' : 'failed', worker_token: null, cleanup_pending: true };
      } else if (name === 'ack_tax_export_cleanup') job = { ...job, cleanup_pending: false, storage_path: null };
      else if (name === 'reap_tax_export_job' && ['queued', 'running'].includes(job.status) && Date.parse(job.lease_expires_at) <= Date.now()) job = { ...job, status: 'failed', worker_token: null, cleanup_pending: true };
      return Response.json([job]);
    }
    if (url.pathname === '/rest/v1/tax_export_jobs') {
      if (request.method === 'POST' || request.method === 'PATCH') { job = { ...job, ...(body as object) }; return Response.json(job); }
      if (url.searchParams.has('id')) return Response.json(job);
      return Response.json([job]);
    }
    if (url.pathname === '/rest/v1/invoices') return Response.json([invoice]);
    if (url.pathname.startsWith('/storage/v1/object/issued-invoices/')) return new Response(bytes, { headers: { 'Content-Type': 'application/pdf' } });
    if (url.pathname.startsWith('/storage/v1/object/sign/tax-exports/')) return Response.json({ signedURL: '/object/sign/tax-exports/test.zip?token=test' });
    if (url.pathname.startsWith('/storage/v1/object/tax-exports/') && request.method === 'POST') { uploads.push(bodyBytes); uploadCallback(); return Response.json({ Key: 'tax-exports/test.zip' }); }
    if (url.pathname === '/storage/v1/object/tax-exports' && request.method === 'DELETE') {
      if (deletionThrows) throw new Error('Injected deletion outage');
      return Response.json([]);
    }
    throw new Error(`Unexpected test request: ${request.method} ${url.pathname}`);
  };
  try { await run({ requests, uploads, setInvoice: (value) => { invoice = { ...invoice, ...value }; }, setExpired: () => { job = { ...job, status: 'completed', expires_at: new Date(Date.now() - 1000).toISOString() }; }, onUpload: (callback) => { uploadCallback = callback; }, revokeLease: () => { job = { ...job, status: 'failed', worker_token: null, cleanup_pending: true }; }, throwDeletion: () => { deletionThrows = true; }, throwRecoveryPersistence: () => { recoveryThrows = true; }, getJob: () => job }); }
  finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) { if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value); }
  }
}
const request = (body: unknown, token = 'verified-user-token') => new Request('https://function.test', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

Deno.test('handler validates JWT, derives job owner, uses RLS for originals, writes private ZIP and signs for 900 seconds', async () => {
  await fixture(async ({ requests, uploads }) => {
    const response = await handleRequest(request({ kind: 'issued_invoices', year: 2026 }));
    equal(response.status, 200);
    const result = await response.json();
    equal(result.status, 'completed', JSON.stringify({ result, requests }));
    match(result.downloadUrl, /\/storage\/v1\/object\/sign\/tax-exports/);
    const insert = requests.find((entry) => entry.path === '/rest/v1/tax_export_jobs?select=id%2Cuser_id%2Ctax_year%2Cexport_kind%2Cstatus%2Crequested_at%2Ccompleted_at%2Cexpires_at%2Cstorage_path%2Cerror_code' && entry.method === 'POST') ?? requests.find((entry) => entry.path.startsWith('/rest/v1/tax_export_jobs') && entry.method === 'POST');
    equal((insert!.body as { user_id: string }).user_id, userId);
    for (const entry of requests.filter((entry) => entry.path.startsWith('/rest/v1/invoices') || entry.path.includes('/object/issued-invoices/'))) equal(entry.auth, 'Bearer verified-user-token');
    const signed = requests.find((entry) => entry.path.includes('/object/sign/'))!;
    equal((signed.body as { expiresIn: number }).expiresIn, 900);
    equal(uploads.length, 1);
    const archive = unzipSync(uploads[0]);
    deepEqual(archive['invoices/invoice-1-INV-1.pdf'], bytes);
    deepEqual([...archive['issued-invoices-2026.csv'].slice(0, 3)], [239, 187, 191]);
    ok(archive['README.txt']);
    ok(!JSON.stringify(result).includes('test-server-key'));
  });
});

Deno.test('handler rejects forged identity and invalid JWT before creating a job', async () => {
  await fixture(async ({ requests }) => {
    equal((await handleRequest(request({ kind: 'issued_invoices', year: 2026, user_id: 'other' }))).status, 400);
    equal((await handleRequest(request({ kind: 'issued_invoices', year: 2026 }, 'invalid'))).status, 401);
    equal(requests.filter((entry) => entry.method === 'POST' && entry.path.startsWith('/rest/v1/tax_export_jobs')).length, 0);
  });
});

Deno.test('cross-owner archive path produces a failed job and no ZIP or signed URL', async () => {
  await fixture(async ({ setInvoice, requests, uploads }) => {
    setInvoice({ pdf_storage_path: 'other-user/invoice.pdf' });
    const result = await (await handleRequest(request({ kind: 'issued_invoices', year: 2026 }))).json();
    equal(result.status, 'failed');
    equal(result.downloadUrl, undefined);
    equal(uploads.length, 0);
    equal(requests.filter((entry) => entry.path.includes('/object/issued-invoices/')).length, 0);
    equal(result.errorMessage, 'Could not create the export. Check your documents and try again.');
  });
});

Deno.test('cleanup is server-only, removes only the derived export object, then clears completed paths', async () => {
  await fixture(async ({ setExpired, requests }) => {
    equal((await handleRequest(request({ mode: 'cleanup' }))).status, 401);
    setExpired();
    const response = await handleRequest(request({ mode: 'cleanup' }, 'test-server-key'));
    equal(response.status, 200);
    deepEqual(await response.json(), { expired: 1, failed: 0 });
    const removed = requests.find((entry) => entry.method === 'DELETE')!;
    equal(removed.path, '/storage/v1/object/tax-exports');
    deepEqual(removed.body, { prefixes: [`${userId}/issued_invoices-2026-${jobId}.zip`] });
    const update = requests.find((entry) => entry.path.endsWith('/ack_tax_export_cleanup'))!;
    deepEqual(update.body, { p_id: jobId, p_user_id: userId });
  });
});

Deno.test('late worker loses finalization CAS and deletes output after timeout revoked its lease', async () => {
  await fixture(async ({ onUpload, revokeLease, requests, getJob }) => {
    onUpload(revokeLease);
    const result = await (await handleRequest(request({ kind: 'issued_invoices', year: 2026 }))).json();
    equal(result.status, 'failed');
    equal(result.downloadUrl, undefined);
    ok(requests.some((entry) => entry.method === 'DELETE'));
    equal(getJob().status, 'failed');
    equal(getJob().cleanup_pending, false);
    ok(!requests.some((entry) => entry.path.includes('/object/sign/')));
  });
});

Deno.test('throwing deletion leaves a durable failed job with retryable cleanup', async () => {
  await fixture(async ({ onUpload, revokeLease, throwDeletion, getJob }) => {
    onUpload(revokeLease); throwDeletion();
    const result = await (await handleRequest(request({ kind: 'issued_invoices', year: 2026 }))).json();
    equal(result.status, 'failed');
    equal(getJob().status, 'failed');
    equal(getJob().cleanup_pending, true);
    ok(getJob().storage_path);
  });
});

Deno.test('recovery persistence outage retries and preserves the original durable lease deadline', async () => {
  await fixture(async ({ setInvoice, throwRecoveryPersistence, getJob, requests }) => {
    setInvoice({ pdf_storage_path: null }); throwRecoveryPersistence();
    const result = await (await handleRequest(request({ kind: 'issued_invoices', year: 2026 }))).json();
    equal(result.status, 'failed');
    equal(getJob().status, 'running');
    ok(Date.parse(getJob().lease_expires_at) > 0);
    equal(requests.filter((entry) => entry.path.endsWith('/fail_tax_export_job')).length, 2);
  });
});
