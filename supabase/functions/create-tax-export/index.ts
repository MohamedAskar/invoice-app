import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { zipSync } from 'fflate';
import { buildPackage, ExportError, ownedPath, sha256, validateRequest, type DocumentRecord, type ExpenseRecord, type ExportKind, type InvoiceRecord } from './package.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { ...cors, 'Cache-Control': 'no-store' } });
const genericError = 'Could not create the export. Check your documents and try again.';
const day = 24 * 60 * 60 * 1000;
const jobColumns = 'id,user_id,tax_year,export_kind,status,requested_at,completed_at,expires_at,storage_path,error_code';
interface Job {
  id: string; user_id: string; tax_year: number; export_kind: 'issued_invoices' | 'expenses';
  status: string; requested_at: string; completed_at: string | null; expires_at: string | null;
  storage_path: string | null; error_code: string | null;
}
const pathFor = (job: Job) => `${job.user_id}/${job.export_kind === 'expenses' ? 'business_expenses' : job.export_kind}-${job.tax_year}-${job.id}.zip`;
async function updateJob(admin: SupabaseClient, job: Job, values: Record<string, unknown>) {
  const { data, error } = await admin.from('tax_export_jobs').update(values).eq('id', job.id).eq('user_id', job.user_id).select(jobColumns).single();
  if (error || !data) throw new ExportError('job_update_failed');
  return data as Job;
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
  try {
    job = await updateJob(admin, job, { status: 'running', storage_path: path });
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
    return await updateJob(admin, job, {
      status: 'completed', completed_at: new Date().toISOString(), expires_at: new Date(Date.now() + day).toISOString(),
      sha256: await sha256(zip), byte_size: zip.byteLength, error_code: null, error_message: null,
    });
  } catch (error) {
    // Keep the exact path on the job until deletion succeeds, so scheduled cleanup
    // can retry an interrupted upload or a temporary Storage deletion failure.
    const removed = await admin.storage.from('tax-exports').remove([path]);
    return await updateJob(admin, job, {
      status: 'failed', completed_at: new Date().toISOString(),
      storage_path: removed.error ? path : null,
      error_code: error instanceof ExportError ? error.code : 'export_failed', error_message: genericError,
    });
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
  // Retryable, bounded batches; expiry metadata exists from job creation even
  // when the worker dies before upload/completion. Never delete source buckets.
  const { data, error } = await admin.from('tax_export_jobs').select(jobColumns)
    .lte('expires_at', new Date().toISOString()).neq('status', 'expired').order('expires_at').limit(100);
  if (error) throw new ExportError('cleanup_failed');
  let expired = 0;
  let failed = 0;
  for (const job of data as Job[]) {
    const path = pathFor(job);
    if (job.storage_path && job.storage_path !== path) { failed++; continue; }
    const removed = await admin.storage.from('tax-exports').remove([path]);
    if (removed.error) { failed++; continue; }
    await updateJob(admin, job, { status: 'expired', storage_path: null });
    expired++;
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
      if (['queued', 'running'].includes(job.status) && Date.parse(job.requested_at) < Date.now() - 10 * 60 * 1000) {
        job = await updateJob(admin, job, { status: 'failed', error_code: 'export_timeout', error_message: genericError });
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
      runtime.waitUntil(work.catch(() => console.error('Tax export worker failed; durable job expiry will clean up.')));
      return json(await publicJob(userClient, job), 202);
    }
    return json(await publicJob(userClient, await work));
  } catch (error) {
    return json({ error: genericError }, error instanceof ExportError && error.code === 'invalid_request' ? 400 : 500);
  }
}

if (import.meta.main) Deno.serve(handleRequest);
