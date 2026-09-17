import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { zipSync } from 'fflate';
import { buildPackage, ExportError, ownedPath, sha256, validateRequest, type DocumentRecord, type ExpenseRecord, type ExportKind, type InvoiceRecord } from './package.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { ...cors, 'Cache-Control': 'no-store' } });
const genericError = 'Could not create the export. Check your documents and try again.';
const day = 24 * 60 * 60 * 1000;
const jobColumns = 'id,user_id,tax_year,export_kind,status,requested_at,completed_at,expires_at,storage_path,error_code,worker_token,lease_expires_at,cleanup_pending';
interface Job {
  id: string; user_id: string; tax_year: number; export_kind: 'issued_invoices' | 'expenses';
  status: string; requested_at: string; completed_at: string | null; expires_at: string | null;
  storage_path: string | null; error_code: string | null;
  worker_token: string | null; lease_expires_at: string; cleanup_pending: boolean;
}
const pathFor = (job: Job) => `${job.user_id}/${job.export_kind === 'expenses' ? 'business_expenses' : job.export_kind}-${job.tax_year}-${job.id}.zip`;
async function jobRpc(admin: SupabaseClient, name: string, args: Record<string, unknown>): Promise<Job | undefined> {
  const { data, error } = await admin.rpc(name, args);
  if (error || !Array.isArray(data)) throw new ExportError('job_update_failed');
  return data[0] as Job | undefined;
}

async function deleteOutput(admin: SupabaseClient, job: Job): Promise<void> {
  const path = pathFor(job);
  if (job.storage_path && job.storage_path !== path) throw new ExportError('invalid_document');
  const { error } = await admin.storage.from('tax-exports').remove([path]);
  if (error) throw new ExportError('cleanup_failed');
  await jobRpc(admin, 'ack_tax_export_cleanup', { p_id: job.id, p_user_id: job.user_id });
}

async function recoverWorker(admin: SupabaseClient, job: Job, token: string, error: unknown): Promise<Job> {
  // Revoke the lease before deleting output. If completion committed but its
  // HTTP response was lost, the RPC returns completed and preserves that ZIP.
  // Persistence itself may throw: retry, then rely on the deadline committed
  // at INSERT and the independent database cron reaper, never a JS-only retry.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const current = await jobRpc(admin, 'fail_tax_export_job', {
        p_id: job.id, p_user_id: job.user_id, p_token: token,
        p_error_code: error instanceof ExportError ? error.code : 'export_failed',
      });
      if (!current) throw new ExportError('job_unavailable');
      if (current.cleanup_pending && ['failed', 'expired'].includes(current.status)) {
        try { await deleteOutput(admin, current); }
        catch { /* cleanup_pending stays committed for the next scheduled retry. */ }
      }
      return current;
    } catch { /* The original lease deadline remains durable during an outage. */ }
  }
  console.error('Tax export recovery persistence unavailable; database lease recovery is scheduled.');
  return { ...job, status: 'failed', error_code: 'export_failed' };
}

// Every query is paginated: an API row limit must never silently create a partial final ZIP.
async function pages<T>(query: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await query(offset, offset + 199);
    if (error || !Array.isArray(data)) throw new ExportError('records_unavailable');
    rows.push(...data as T[]);
    if (rows.length > 10000) throw new ExportError('package_too_large');
    if (data.length < 200) return rows;
  }
}

async function runExport(userClient: SupabaseClient, admin: SupabaseClient, job: Job, kind: ExportKind) {
  const path = pathFor(job);
  const token = crypto.randomUUID();
  try {
    const claimed = await jobRpc(admin, 'claim_tax_export_job', { p_id: job.id, p_user_id: job.user_id, p_token: token });
    if (!claimed) throw new ExportError('worker_lease_lost');
    job = claimed;
    const start = `${job.tax_year}-01-01`;
    const end = `${job.tax_year + 1}-01-01`;
    let invoices: InvoiceRecord[] = [];
    let expenses: ExpenseRecord[] = [];
    if (kind === 'issued_invoices') {
      // Legacy invoices have no user_id column. The caller client enforces the
      // application's is_owner RLS; every archived path is also owner-checked.
      invoices = await pages<InvoiceRecord>((from, to) => userClient.from('invoices')
        .select('id,invoice_number,date,client_name,subtotal,vat_amount,total,status,pdf_storage_path,pdf_sha256')
        .neq('status', 'draft').gte('date', start).lt('date', end).order('id').range(from, to));
    } else {
      expenses = await pages<ExpenseRecord>((from, to) => userClient.from('expenses').select('*')
        .eq('user_id', job.user_id).in('status', ['booked', 'voided'])
        .or(`and(paid_date.gte.${start},paid_date.lt.${end}),and(paid_date.is.null,expense_date.gte.${start},expense_date.lt.${end})`)
        .order('id').range(from, to));
      for (const expense of expenses) expense.expense_documents = [];
      const booked = expenses.filter((expense) => expense.status === 'booked');
      const byId = new Map(booked.map((expense) => [expense.id, expense]));
      for (let offset = 0; offset < booked.length; offset += 200) {
        const ids = booked.slice(offset, offset + 200).map((expense) => expense.id);
        const documents = await pages<DocumentRecord>((from, to) => userClient.from('expense_documents')
          .select('id,user_id,expense_id,storage_path,filename,is_primary,sha256').eq('user_id', job.user_id)
          .in('expense_id', ids).order('id').range(from, to));
        for (const document of documents) byId.get(document.expense_id)!.expense_documents.push(document);
      }
    }
    const files = await buildPackage({
      userId: job.user_id, kind, year: job.tax_year, invoices, expenses, generatedAt: new Date().toISOString(),
      download: async (bucket, documentPath) => {
        const { data, error } = await userClient.storage.from(bucket).download(ownedPath(documentPath, job.user_id));
        if (error || !data) throw new ExportError('document_unavailable');
        return new Uint8Array(await data.arrayBuffer());
      },
    });
    // Stored ZIP entries avoid CPU-heavy recompression of already compressed PDFs/images.
    const zip = zipSync(files, { level: 0 });
    if (zip.byteLength > 50 * 1024 * 1024) throw new ExportError('package_too_large');
    const { error } = await admin.storage.from('tax-exports').upload(path, zip, { contentType: 'application/zip', upsert: false });
    if (error) throw new ExportError('upload_failed');
    const completed = await jobRpc(admin, 'complete_tax_export_job', {
      p_id: job.id, p_user_id: job.user_id, p_token: token,
      p_sha256: await sha256(zip), p_byte_size: zip.byteLength,
    });
    if (!completed) throw new ExportError('worker_lease_lost');
    return completed;
  } catch (error) {
    return recoverWorker(admin, job, token, error);
  }
}

async function publicJob(userClient: SupabaseClient, job: Job) {
  const expired = job.expires_at && Date.parse(job.expires_at) <= Date.now();
  let downloadUrl: string | undefined;
  if (job.status === 'completed' && !expired && job.storage_path === pathFor(job)) {
    const seconds = Math.min(900, Math.floor((Date.parse(job.expires_at!) - Date.now()) / 1000));
    if (seconds > 0) {
      const { data, error } = await userClient.storage.from('tax-exports').createSignedUrl(job.storage_path, seconds, { download: true });
      if (error) throw new ExportError('download_unavailable');
      downloadUrl = data.signedUrl;
    }
  }
  return {
    id: job.id, year: job.tax_year, kind: job.export_kind === 'expenses' ? 'business_expenses' : job.export_kind,
    status: expired ? 'expired' : job.status, requestedAt: job.requested_at,
    expiresAt: job.expires_at, downloadUrl, errorCode: job.error_code,
    errorMessage: job.status === 'failed' ? genericError : undefined,
  };
}

async function cleanup(admin: SupabaseClient) {
  // Atomic revocation precedes deletion. Upload metadata and finalization use
  // the same database row lock, so a revoked worker cannot publish or recreate.
  const { data, error } = await admin.rpc('claim_tax_export_cleanup', { p_limit: 100 });
  if (error) throw new ExportError('cleanup_failed');
  let expired = 0;
  let failed = 0;
  for (const job of data as Job[]) {
    try { await deleteOutput(admin, job); expired++; }
    catch { failed++; } // Do not lose the remaining batch to one rejected promise.
  }
  return { expired, failed };
}

export async function handleRequest(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authorization = request.headers.get('Authorization') ?? '';
    if (!authorization.startsWith('Bearer ')) return json({ error: 'Sign in to export documents.' }, 401);
    const body = await request.json();
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    if (body?.mode === 'cleanup') {
      // Scheduler only: this is never accepted as authorization to create a user export.
      if (!serviceKey || authorization !== `Bearer ${serviceKey}`) return json({ error: 'Unauthorized.' }, 401);
      return json(await cleanup(admin));
    }
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: auth, error: authError } = await userClient.auth.getUser(authorization.slice(7));
    if (authError || !auth.user) return json({ error: 'Sign in to export documents.' }, 401);
    const userId = auth.user.id;
    const owner = await userClient.rpc('is_owner');
    if (owner.error || owner.data !== true) return json({ error: 'Not authorized to export documents.' }, 403);
    if (body?.mode === 'status') {
      if (Object.keys(body).some((key) => !['mode', 'jobId'].includes(key)) || typeof body.jobId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.jobId)) throw new ExportError('invalid_request');
      const { data, error } = await userClient.from('tax_export_jobs').select(jobColumns).eq('id', body.jobId).eq('user_id', userId).single();
      if (error || !data) return json({ error: 'Export unavailable.' }, 404);
      let job = data as Job;
      if (['queued', 'running'].includes(job.status)) {
        const current = await jobRpc(admin, 'reap_tax_export_job', { p_id: job.id, p_user_id: userId });
        if (!current) return json({ error: 'Export unavailable.' }, 404);
        job = current;
      }
      return json(await publicJob(userClient, job));
    }
    const { kind, year } = validateRequest(body);
    const { data, error } = await admin.from('tax_export_jobs').insert({
      user_id: userId, tax_year: year, export_kind: kind === 'business_expenses' ? 'expenses' : kind,
      status: 'queued', expires_at: new Date(Date.now() + day).toISOString(),
    }).select(jobColumns).single();
    if (error || !data) throw new ExportError('job_create_failed');
    const job = data as Job;
    const work = runExport(userClient, admin, job, kind);
    const runtime = (globalThis as typeof globalThis & { EdgeRuntime?: { waitUntil: (promise: Promise<unknown>) => void } }).EdgeRuntime;
    if (runtime) {
      runtime.waitUntil(work);
      return json(await publicJob(userClient, job), 202);
    }
    return json(await publicJob(userClient, await work));
  } catch (error) {
    return json({ error: genericError }, error instanceof ExportError && error.code === 'invalid_request' ? 400 : 500);
  }
}

if (import.meta.main) Deno.serve(handleRequest);
