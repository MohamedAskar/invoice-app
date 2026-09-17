import {
  Expense,
  ExpenseCategory,
  ExpenseDocument,
  ExpenseDocumentRole,
  ExpenseInput,
  ExpenseSource,
  ExpenseStatus,
  expenseCategories,
  expenseDocumentRoles,
  expenseStatuses,
} from '@/types/finance';
import { supabase } from './supabase';

const EXPENSE_DOCUMENT_BUCKET = 'expense-documents';
const ISSUED_INVOICE_BUCKET = 'issued-invoices';
const MAX_EXPENSE_DOCUMENT_BYTES = 15 * 1024 * 1024;
const MAX_ISSUED_INVOICE_BYTES = 10 * 1024 * 1024;
// `expense_documents` deliberately has both a simple and an owner-scoped
// foreign key to expenses. PostgREST cannot infer which relation to embed, so
// every nested expense-document query must name the direct expense relation.
const EXPENSE_DOCUMENT_RELATION = 'expense_documents!expense_documents_expense_id_fkey';
const EXPENSE_SELECT = `*, ${EXPENSE_DOCUMENT_RELATION}(*)`;

export type TaxExportKind = 'issued_invoices' | 'business_expenses';
export interface TaxExportJob {
  id: string;
  kind: TaxExportKind;
  year: number;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'expired';
  requestedAt: string;
  expiresAt?: string;
  downloadUrl?: string;
  errorCode?: string;
  errorMessage?: string;
}

async function invokeTaxExport(body: Record<string, unknown>): Promise<TaxExportJob> {
  const { data, error } = await supabase.functions.invoke('create-tax-export', { body });
  if (error || !data?.id || !['queued', 'running', 'completed', 'failed', 'expired'].includes(data.status)) {
    throw new FinanceStorageError('Could not create the export. Check your documents and try again.');
  }
  // Never render arbitrary server/database text or accept a non-HTTP download link.
  const job = data as TaxExportJob;
  if (job.downloadUrl) {
    const url = new URL(job.downloadUrl);
    if (!['https:', 'http:'].includes(url.protocol)) throw new FinanceStorageError('Export download is unavailable.');
  }
  return { ...job, errorMessage: job.status === 'failed' ? 'Could not create the export. Check your documents and try again.' : undefined };
}

export async function requestAnnualExport(kind: TaxExportKind, year: number): Promise<TaxExportJob> {
  if (!['issued_invoices', 'business_expenses'].includes(kind) || !Number.isInteger(year) || year < 2000 || year > new Date().getFullYear()) {
    throw new FinanceValidationError('Choose a year from 2000 through the current year.');
  }
  return invokeTaxExport({ kind, year });
}

export async function getAnnualExportJob(jobId: string): Promise<TaxExportJob> {
  return invokeTaxExport({ mode: 'status', jobId });
}

export interface AnnualExportPreview {
  recordCount: number;
  fileCount: number;
  missingCount: number;
  totals: { net: number; vat: number; gross: number };
}

export async function getAnnualExportPreview(year: number): Promise<Record<TaxExportKind, AnnualExportPreview>> {
  if (!Number.isInteger(year) || year < 2000 || year > new Date().getFullYear()) throw new FinanceValidationError('Choose a valid tax year.');
  const userId = await requireAuthenticatedUserId();
  const start = `${year}-01-01`;
  const end = `${year + 1}-01-01`;
  const empty = (): AnnualExportPreview => ({ recordCount: 0, fileCount: 0, missingCount: 0, totals: { net: 0, vat: 0, gross: 0 } });
  const invoices = empty();
  const expenses = empty();
  const add = (preview: AnnualExportPreview, net: number | string, vat: number | string, gross: number | string, files: number) => {
    preview.recordCount++;
    preview.fileCount += files;
    if (!files) preview.missingCount++;
    preview.totals.net += Math.round(Number(net) * 100);
    preview.totals.vat += Math.round(Number(vat) * 100);
    preview.totals.gross += Math.round(Number(gross) * 100);
  };
  await Promise.all([
    (async () => {
      for (let offset = 0; ; offset += 200) {
        const { data, error } = await supabase.from('invoices').select('subtotal,vat_amount,total,pdf_storage_path')
          .neq('status', 'draft').gte('date', start).lt('date', end).order('id').range(offset, offset + 199);
        if (error || !data) throw new FinanceStorageError('Could not load report data.');
        for (const row of data) add(invoices, row.subtotal, row.vat_amount, row.total, row.pdf_storage_path ? 1 : 0);
        if (data.length < 200) break;
      }
    })(),
    (async () => {
      for (let offset = 0; ; offset += 200) {
        const { data, error } = await supabase.from('expenses').select(`net_amount,vat_amount,gross_amount,${EXPENSE_DOCUMENT_RELATION}(count)`)
          .eq('user_id', userId).eq('status', 'booked')
          .or(`and(paid_date.gte.${start},paid_date.lt.${end}),and(paid_date.is.null,expense_date.gte.${start},expense_date.lt.${end})`)
          .order('id').range(offset, offset + 199);
        if (error || !data) throw new FinanceStorageError('Could not load report data.');
        for (const row of data) add(expenses, row.net_amount, row.vat_amount, row.gross_amount, Number(row.expense_documents[0]?.count ?? 0));
        if (data.length < 200) break;
      }
    })(),
  ]);
  for (const preview of [invoices, expenses]) {
    preview.totals.net /= 100; preview.totals.vat /= 100; preview.totals.gross /= 100;
  }
  return { issued_invoices: invoices, business_expenses: expenses };
}

const acceptedDocumentMimeTypes = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const);

type AcceptedDocumentMimeType = 'application/pdf' | 'image/jpeg' | 'image/png';

interface ExpenseDocumentRow {
  id: string;
  expense_id: string;
  document_role: ExpenseDocumentRole;
  is_primary: boolean;
  storage_path: string;
  filename: string;
  declared_mime_type: string | null;
  detected_mime_type: AcceptedDocumentMimeType;
  byte_size: number | string;
  sha256: string;
  created_at: string;
  updated_at: string;
}

interface ExpenseRow {
  id: string;
  vendor: string;
  vendor_invoice_number: string | null;
  category: ExpenseCategory;
  description: string | null;
  expense_date: string;
  paid_date: string | null;
  net_amount: number | string;
  vat_amount: number | string;
  gross_amount: number | string;
  currency: 'EUR';
  status: ExpenseStatus;
  source: ExpenseSource;
  notes: string | null;
  voided_at?: string | null;
  void_reason?: string | null;
  created_at: string;
  updated_at: string;
  expense_documents?: ExpenseDocumentRow[];
  gmail_received_at?: string | null;
  gmail_sender_domain?: string | null;
  gmail_filter_reasons?: string[];
  gmail_multiple_possible_invoices?: boolean;
  gmail_ignored_count?: number;
  gmail_skipped_count?: number;
  gmail_review_confirmed?: boolean;
}

export class FinanceStorageError extends Error {
  readonly code: string;

  constructor(message: string, code = 'finance_storage_error') {
    super(message);
    this.name = 'FinanceStorageError';
    this.code = code;
  }
}

export class FinancialRecordImmutableError extends FinanceStorageError {
  constructor(message = 'Booked and voided financial records cannot be deleted or changed.') {
    super(message, 'financial_record_immutable');
    this.name = 'FinancialRecordImmutableError';
  }
}

export class DuplicateExpenseDocumentError extends FinanceStorageError {
  constructor() {
    super('This document is already attached to an expense.', 'duplicate_expense_document');
    this.name = 'DuplicateExpenseDocumentError';
  }
}

export class UnsupportedDocumentError extends FinanceStorageError {
  constructor() {
    super('Only PDF, JPEG, and PNG documents can be uploaded.', 'unsupported_document');
    this.name = 'UnsupportedDocumentError';
  }
}

export class DocumentTooLargeError extends FinanceStorageError {
  constructor(maxBytes = MAX_EXPENSE_DOCUMENT_BYTES) {
    super(
      `Documents must be ${(maxBytes / 1024 / 1024).toFixed(0)} MB or smaller.`,
      'document_too_large'
    );
    this.name = 'DocumentTooLargeError';
  }
}

export class FinanceValidationError extends FinanceStorageError {
  constructor(message: string) {
    super(message, 'finance_validation_error');
    this.name = 'FinanceValidationError';
  }
}

function numeric(value: number | string): number {
  return Number(value);
}

function documentRoleRank(role: ExpenseDocumentRole): number {
  return expenseDocumentRoles.indexOf(role);
}

function toExpenseDocument(row: ExpenseDocumentRow): ExpenseDocument {
  return {
    id: row.id,
    expenseId: row.expense_id,
    documentRole: row.document_role,
    isPrimary: row.is_primary,
    storagePath: row.storage_path,
    filename: row.filename,
    declaredMimeType: row.declared_mime_type ?? undefined,
    detectedMimeType: row.detected_mime_type,
    byteSize: numeric(row.byte_size),
    sha256: row.sha256,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function compareDocuments(left: ExpenseDocument, right: ExpenseDocument): number {
  if (left.isPrimary !== right.isPrimary) return left.isPrimary ? -1 : 1;

  const roleDifference = documentRoleRank(left.documentRole) - documentRoleRank(right.documentRole);
  if (roleDifference !== 0) return roleDifference;

  return (
    left.createdAt.localeCompare(right.createdAt) ||
    left.filename.localeCompare(right.filename) ||
    left.id.localeCompare(right.id)
  );
}

// Exported solely for focused mapping tests. Application code should use the
// query helpers below so RLS remains the only data-access boundary.
export function toExpense(row: ExpenseRow): Expense {
  return {
    id: row.id,
    vendor: row.vendor,
    vendorInvoiceNumber: row.vendor_invoice_number ?? undefined,
    category: row.category,
    description: row.description ?? undefined,
    expenseDate: row.expense_date,
    paidDate: row.paid_date ?? undefined,
    netAmount: numeric(row.net_amount),
    vatAmount: numeric(row.vat_amount),
    grossAmount: numeric(row.gross_amount),
    currency: row.currency,
    status: row.status,
    source: row.source,
    notes: row.notes ?? undefined,
    voidedAt: row.voided_at ?? undefined,
    voidReason: row.void_reason ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    documents: (row.expense_documents ?? []).map(toExpenseDocument).sort(compareDocuments),
    ...(row.source === 'gmail' ? {
      gmailReceivedAt: row.gmail_received_at ?? undefined,
      gmailSenderDomain: row.gmail_sender_domain ?? undefined,
      gmailFilterReasons: row.gmail_filter_reasons ?? [],
      gmailMultiplePossibleInvoices: row.gmail_multiple_possible_invoices ?? false,
      gmailIgnoredCount: row.gmail_ignored_count ?? 0,
      gmailSkippedCount: row.gmail_skipped_count ?? 0,
      gmailReviewConfirmed: row.gmail_review_confirmed ?? false,
    } : {}),
  };
}

function isDatabaseError(value: unknown): value is { code?: string; message?: string } {
  return typeof value === 'object' && value !== null;
}

function toSafeError(error: unknown, action: string): FinanceStorageError {
  if (isDatabaseError(error)) {
    const message = error.message?.toLowerCase() ?? '';
    if (error.code === 'P0001' || message.includes('immutable')) {
      return new FinancialRecordImmutableError();
    }
    if (error.code === '23505') return new DuplicateExpenseDocumentError();
  }

  return new FinanceStorageError(`Could not ${action}. Please try again.`);
}

async function requireAuthenticatedUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new FinanceStorageError('Sign in before changing financial records.', 'authentication_required');
  }
  return data.user.id;
}

function validateExpenseInput(input: ExpenseInput): void {
  if (!input.vendor.trim()) throw new FinanceValidationError('Vendor is required.');
  if (!expenseCategories.includes(input.category)) {
    throw new FinanceValidationError('Choose a valid expense category.');
  }
  if (!expenseStatuses.includes(input.status)) {
    throw new FinanceValidationError('Choose a valid expense status.');
  }
  if (input.currency !== 'EUR') throw new FinanceValidationError('Expenses must be recorded in EUR.');
  if (!isIsoDate(input.expenseDate) || (input.paidDate && !isIsoDate(input.paidDate))) {
    throw new FinanceValidationError('Enter valid document and payment dates.');
  }
  if (!Number.isFinite(input.netAmount) || !Number.isFinite(input.vatAmount)) {
    throw new FinanceValidationError('Expense amounts must be numbers.');
  }
  if (input.netAmount < 0 || input.vatAmount < 0) {
    throw new FinanceValidationError('Expense amounts cannot be negative.');
  }
  if (input.grossAmount !== undefined && (!Number.isFinite(input.grossAmount) || Math.abs(Math.round(input.netAmount * 100) + Math.round(input.vatAmount * 100) - Math.round(input.grossAmount * 100)) > 1)) {
    throw new FinanceValidationError('Net plus VAT must equal gross within €0.01.');
  }
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function toExpensePayload(input: ExpenseInput) {
  return {
    vendor: input.vendor.trim(),
    vendor_invoice_number: input.vendorInvoiceNumber?.trim() || null,
    category: input.category,
    description: input.description?.trim() || null,
    expense_date: input.expenseDate,
    paid_date: input.paidDate || null,
    net_amount: input.netAmount,
    vat_amount: input.vatAmount,
    currency: 'EUR' as const,
    status: input.status,
    notes: input.notes?.trim() || null,
    ...(input.gmailReviewConfirmed !== undefined ? { gmail_review_confirmed: input.gmailReviewConfirmed } : {}),
  };
}

export async function getExpenses(): Promise<Expense[]> {
  const { data, error } = await supabase
    .from('expenses')
    .select(EXPENSE_SELECT)
    .order('expense_date', { ascending: false });

  if (error) throw toSafeError(error, 'load expenses');
  return ((data ?? []) as ExpenseRow[]).map(toExpense);
}

export async function getExpenseById(id: string): Promise<Expense | undefined> {
  const { data, error } = await supabase
    .from('expenses')
    .select(EXPENSE_SELECT)
    .eq('id', id)
    .maybeSingle();

  if (error) throw toSafeError(error, 'load the expense');
  return data ? toExpense(data as ExpenseRow) : undefined;
}

/**
 * Saves an editable expense. New records are intentionally created as review
 * drafts because the database only permits booking after a review record exists.
 */
export async function saveExpense(input: ExpenseInput, id?: string): Promise<Expense> {
  validateExpenseInput(input);
  if (input.status === 'voided') {
    throw new FinanceValidationError('Use the void action to record a reason for voiding an expense.');
  }
  const payload = toExpensePayload(input);

  if (!id) {
    if (input.status !== 'needs_review') {
      throw new FinanceValidationError('Create an expense for review before booking it.');
    }
    const userId = await requireAuthenticatedUserId();
    const { data, error } = await supabase
      .from('expenses')
      .insert({ ...payload, user_id: userId, source: 'upload' })
      .select(EXPENSE_SELECT)
      .single();

    if (error) throw toSafeError(error, 'save the expense');
    return toExpense(data as ExpenseRow);
  }

  const currentStatus = await getExpenseStatus(id);
  if (!currentStatus) throw new FinanceStorageError('The expense was not found.', 'expense_not_found');
  if (currentStatus !== 'needs_review') throw new FinancialRecordImmutableError();

  const { data, error } = await supabase
    .from('expenses')
    .update(payload)
    .eq('id', id)
    .select(EXPENSE_SELECT)
    .maybeSingle();

  if (error) throw toSafeError(error, 'save the expense');
  if (!data) throw new FinanceStorageError('The expense was not found.', 'expense_not_found');
  return toExpense(data as ExpenseRow);
}

async function getExpenseStatus(id: string): Promise<ExpenseStatus | undefined> {
  const { data, error } = await supabase
    .from('expenses')
    .select('status')
    .eq('id', id)
    .maybeSingle();

  if (error) throw toSafeError(error, 'read the expense status');
  return data?.status as ExpenseStatus | undefined;
}

export async function deleteDraftExpense(id: string, knownDocuments: ExpenseDocument[] = []): Promise<void> {
  const expense = await getExpenseById(id);
  if (!expense) throw new FinanceStorageError('The expense was not found.', 'expense_not_found');
  if (expense.status !== 'needs_review') throw new FinancialRecordImmutableError();

  const documents = expense.documents.length ? expense.documents : knownDocuments;
  for (const document of documents) await deleteExpenseDocument(document);

  const { data, error } = await supabase.rpc('delete_review_expense', { p_expense_id: id });
  if (error) {
    throw new FinanceStorageError(
      'The receipt references were removed, but the review expense still needs deletion. Please retry.',
      'expense_delete_cleanup_failed'
    );
  }
  if (!data) {
    const currentStatus = await getExpenseStatus(id);
    if (currentStatus && currentStatus !== 'needs_review') throw new FinancialRecordImmutableError();
    throw new FinanceStorageError('The expense was not found.', 'expense_not_found');
  }
}

/**
 * The row update, lifecycle trigger, and audit insert execute in one database
 * transaction. The update never touches document or Gmail-source fields.
 */
export async function voidExpense(id: string, reason: string): Promise<Expense> {
  const voidReason = reason.trim();
  if (!voidReason) throw new FinanceValidationError('A reason is required to void an expense.');

  const { data, error } = await supabase
    .from('expenses')
    .update({ status: 'voided', void_reason: voidReason })
    .eq('id', id)
    .in('status', ['needs_review', 'booked'])
    .select(EXPENSE_SELECT)
    .maybeSingle();

  if (error) throw toSafeError(error, 'void the expense');
  if (data) return toExpense(data as ExpenseRow);

  const status = await getExpenseStatus(id);
  if (status === 'voided') throw new FinancialRecordImmutableError('This expense has already been voided.');
  if (!status) throw new FinanceStorageError('The expense was not found.', 'expense_not_found');
  throw new FinanceStorageError('The expense could not be voided.', 'expense_void_failed');
}

export interface UploadExpenseDocumentOptions {
  documentRole?: ExpenseDocumentRole;
}

function getAcceptedMimeType(file: File): AcceptedDocumentMimeType {
  const mimeType = file.type.toLowerCase().split(';', 1)[0] as AcceptedDocumentMimeType;
  if (!acceptedDocumentMimeTypes.has(mimeType)) throw new UnsupportedDocumentError();
  return mimeType;
}

function safeDocumentFilename(file: File, mimeType: AcceptedDocumentMimeType): string {
  const extension =
    mimeType === 'application/pdf' ? 'pdf' : mimeType === 'image/jpeg' ? 'jpg' : 'png';
  const originalBase = file.name.replace(/\.[^.]*$/, '');
  const safeBase = originalBase
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return `${safeBase || 'document'}.${extension}`;
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function removeObjectQuietly(bucket: string, path: string): Promise<void> {
  await supabase.storage.from(bucket).remove([path]);
}

type InvoicePdfCleanupStatus = 'removed' | 'not_removed';

async function removeUnarchivedInvoicePdf(storagePath: string): Promise<InvoicePdfCleanupStatus> {
  const { data, error } = await supabase.storage
    .from(ISSUED_INVOICE_BUCKET)
    .remove([storagePath]);
  if (error) throw toSafeError(error, 'clean up the unarchived invoice PDF');
  return data.some((object) => object.name === storagePath) ? 'removed' : 'not_removed';
}

export async function uploadExpenseDocument(
  file: File,
  expenseId: string,
  options: UploadExpenseDocumentOptions = {}
): Promise<ExpenseDocument> {
  const mimeType = getAcceptedMimeType(file);
  if (file.size <= 0) throw new FinanceValidationError('Upload a non-empty document.');
  if (file.size > MAX_EXPENSE_DOCUMENT_BYTES) throw new DocumentTooLargeError();

  const userId = await requireAuthenticatedUserId();
  const bytes = await file.arrayBuffer();
  const checksum = await sha256Hex(bytes);

  const { data: expense, error: expenseError } = await supabase
    .from('expenses')
    .select('id, status')
    .eq('id', expenseId)
    .maybeSingle();
  if (expenseError) throw toSafeError(expenseError, 'prepare the document upload');
  if (!expense) throw new FinanceStorageError('The expense was not found.', 'expense_not_found');
  if (expense.status !== 'needs_review') throw new FinancialRecordImmutableError();

  const { data: duplicate, error: duplicateError } = await supabase
    .from('expense_documents')
    .select('id')
    .eq('user_id', userId)
    .eq('sha256', checksum)
    .maybeSingle();
  if (duplicateError) throw toSafeError(duplicateError, 'check for duplicate documents');
  if (duplicate) throw new DuplicateExpenseDocumentError();

  const { data: currentDocuments, error: currentDocumentsError } = await supabase
    .from('expense_documents')
    .select('id')
    .eq('expense_id', expenseId)
    .limit(1);
  if (currentDocumentsError) throw toSafeError(currentDocumentsError, 'prepare the document upload');

  const role = options.documentRole ?? 'invoice';
  if (!expenseDocumentRoles.includes(role)) {
    throw new FinanceValidationError('Choose a valid document role.');
  }
  const path = `${userId}/${expenseId}/${checksum}-${safeDocumentFilename(file, mimeType)}`;
  const { error: uploadError } = await supabase.storage
    .from(EXPENSE_DOCUMENT_BUCKET)
    .upload(path, file, { cacheControl: '31536000', contentType: mimeType, upsert: false });
  if (uploadError) throw toSafeError(uploadError, 'upload the document');

  const { data, error: metadataError } = await supabase
    .from('expense_documents')
    .insert({
      user_id: userId,
      expense_id: expenseId,
      document_role: role,
      is_primary: !currentDocuments?.length,
      storage_path: path,
      filename: file.name || safeDocumentFilename(file, mimeType),
      declared_mime_type: mimeType,
      detected_mime_type: mimeType,
      byte_size: file.size,
      sha256: checksum,
    })
    .select('*')
    .single();

  if (metadataError) {
    await removeObjectQuietly(EXPENSE_DOCUMENT_BUCKET, path);
    throw toSafeError(metadataError, 'save the document record');
  }
  return toExpenseDocument(data as ExpenseDocumentRow);
}

export async function getDocumentDownloadUrl(
  document: Pick<ExpenseDocument, 'storagePath'> | string,
  expiresInSeconds = 300
): Promise<string> {
  const safeExpiresIn = Math.max(1, Math.min(Math.floor(expiresInSeconds), 3600));
  let storagePath: string;

  if (typeof document === 'string') {
    const { data, error } = await supabase
      .from('expense_documents')
      .select('storage_path')
      .eq('id', document)
      .maybeSingle();
    if (error) throw toSafeError(error, 'prepare the document download');
    if (!data) throw new FinanceStorageError('The document was not found.', 'document_not_found');
    storagePath = data.storage_path as string;
  } else {
    storagePath = document.storagePath;
  }

  const { data, error } = await supabase.storage
    .from(EXPENSE_DOCUMENT_BUCKET)
    .createSignedUrl(storagePath, safeExpiresIn);
  if (error || !data?.signedUrl) throw toSafeError(error, 'create the document download link');
  return data.signedUrl;
}

/**
 * Removes a review-draft document in the recoverable order required for a
 * receipt: first sever the database reference, then clean up the now
 * unreferenced object. Retrying after a storage failure is safe because the
 * caller retains the original path and the RLS policy permits only an orphan
 * whose owning expense remains in review.
 */
export async function deleteExpenseDocument(document: ExpenseDocument): Promise<void> {
  const { data: removedDocument, error: metadataError } = await supabase
    .from('expense_documents')
    .delete()
    .eq('id', document.id)
    .select('storage_path')
    .maybeSingle();
  if (metadataError) throw toSafeError(metadataError, 'remove the document record');

  const storagePath = removedDocument?.storage_path ?? document.storagePath;
  const { data: removedObjects, error: storageError } = await supabase.storage
    .from(EXPENSE_DOCUMENT_BUCKET)
    .remove([storagePath]);
  if (storageError || !removedObjects?.some((object) => object.name === storagePath)) {
    throw new FinanceStorageError(
      'The document record was removed, but its private file needs cleanup. Retry removal to clean up the orphan.',
      'expense_document_orphan_cleanup_failed'
    );
  }
}

export async function setExpenseDocumentPrimary(documentId: string): Promise<ExpenseDocument> {
  const { data, error } = await supabase
    .rpc('set_review_document_primary', { p_document_id: documentId })
    .maybeSingle();
  if (error) throw toSafeError(error, 'mark the replacement document as primary');
  if (!data) throw new FinanceStorageError('The replacement document was not found.', 'document_not_found');
  return toExpenseDocument(data as ExpenseDocumentRow);
}

export interface GmailSyncSummary { candidates: number; documents: number; ignored: number; skipped: number; needsReview: number }
export async function syncGmailReceipts(): Promise<GmailSyncSummary> {
  // Static deployments cannot rely on the client SDK's implicit session lookup
  // for Edge Function calls. Send the current user token explicitly, matching
  // the Gmail connection controls, so the sync function can verify ownership.
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new FinanceStorageError('Sign in before syncing Gmail.');
  const { data, error } = await supabase.functions.invoke('gmail-sync', {
    body: {}, headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (error || !data || !['candidates','documents','ignored','skipped','needsReview'].every(key => Number.isInteger(data[key]) && data[key] >= 0)) {
    throw new FinanceStorageError('Could not sync Gmail. Check the connection status and try again.');
  }
  return { candidates: data.candidates, documents: data.documents, ignored: data.ignored, skipped: data.skipped, needsReview: data.needsReview };
}
export async function splitGmailExpenseDocument(documentId: string): Promise<string> {
  const { data, error } = await supabase.rpc('split_gmail_expense_document', { p_document_id: documentId });
  if (error || typeof data !== 'string') throw new FinanceStorageError('Could not split this review document.');
  return data;
}
export async function rememberGmailVendor(expenseId: string, action: 'always_include' | 'ignore'): Promise<void> {
  const { error } = await supabase.rpc('remember_gmail_vendor', { p_expense_id: expenseId, p_action: action });
  if (error) throw new FinanceStorageError('Could not remember this vendor preference.');
}

export async function prepareInvoiceArchive(
  invoiceId: string, expectedRevision: number | undefined, intent: 'issue' | 'backfill'
): Promise<void> {
  if (expectedRevision === undefined || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new FinanceValidationError('Reload the invoice before archiving it.');
  }
  const { data, error } = await supabase.rpc('prepare_invoice_archive', {
    p_invoice_id: invoiceId, p_expected_revision: expectedRevision, p_intent: intent,
  });
  if (error) throw toSafeError(error, 'prepare the invoice archive');
  if (!data) throw new FinancialRecordImmutableError('The invoice changed. Reload it before archiving.');
}

export async function uploadIssuedInvoicePdf(
  invoiceId: string, blob: Blob, expectedRevision?: number, intent: 'issue' | 'backfill' = 'issue'
): Promise<void> {
  const mimeType = blob.type.toLowerCase().split(';', 1)[0];
  if (mimeType !== 'application/pdf') throw new UnsupportedDocumentError();
  if (blob.size <= 0) throw new FinanceValidationError('Archive a non-empty PDF.');
  if (blob.size > MAX_ISSUED_INVOICE_BYTES) throw new DocumentTooLargeError(MAX_ISSUED_INVOICE_BYTES);
  if (expectedRevision === undefined || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new FinanceValidationError('Reload the invoice before archiving it.');
  }

  const userId = await requireAuthenticatedUserId();
  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices')
    .select('id, status, pdf_storage_path, pdf_sha256')
    .eq('id', invoiceId)
    .maybeSingle();
  if (invoiceError) throw toSafeError(invoiceError, 'prepare the invoice archive');
  if (!invoice) throw new FinanceStorageError('The invoice was not found.', 'invoice_not_found');
  if (
    !['draft', 'pending', 'paid', 'overdue'].includes(invoice.status) ||
    invoice.pdf_storage_path ||
    invoice.pdf_sha256
  ) {
    throw new FinancialRecordImmutableError('The issued invoice PDF is already archived.');
  }

  const checksum = await sha256Hex(await blob.arrayBuffer());
  const path = `${userId}/${invoiceId}/${checksum}.pdf`;
  let { error: uploadError } = await supabase.storage
    .from(ISSUED_INVOICE_BUCKET)
    .upload(path, blob, { cacheControl: '31536000', contentType: 'application/pdf', upsert: false });
  // A previous attempt may lose its response or fail cleanup. Only orphan-only
  // RLS may remove a collision before retrying the immutable INSERT.
  if (uploadError && (('statusCode' in uploadError && String(uploadError.statusCode) === '409')
    || uploadError.message === 'The resource already exists')) {
    if (await removeUnarchivedInvoicePdf(path) !== 'removed') {
      throw new FinancialRecordImmutableError('The existing invoice PDF could not be removed safely.');
    }
    ({ error: uploadError } = await supabase.storage.from(ISSUED_INVOICE_BUCKET)
      .upload(path, blob, { cacheControl: '31536000', contentType: 'application/pdf', upsert: false }));
  }
  if (uploadError) throw toSafeError(uploadError, 'archive the invoice PDF');

  const { data: archived, error: archiveError } = await supabase.rpc('archive_issued_invoice_pdf', {
    p_invoice_id: invoiceId,
    p_storage_path: path,
    p_sha256: checksum,
    p_expected_revision: expectedRevision,
    p_intent: intent,
  });

  if (archiveError || !archived) {
    try {
      const cleanupStatus = await removeUnarchivedInvoicePdf(path);
      if (cleanupStatus !== 'removed') throw new Error('Invoice PDF was not removed');
    } catch {
      throw new FinanceStorageError(
        'The invoice PDF archive is missing and its uploaded file needs cleanup. Please retry.',
        'invoice_archive_cleanup_failed'
      );
    }
    if (!archiveError) {
      throw new FinancialRecordImmutableError('The invoice changed before its PDF could be archived.');
    }
    throw toSafeError(archiveError, 'archive the invoice PDF');
  }
}

/** Creates a short-lived private download URL for a frozen invoice PDF. */
export async function getIssuedInvoicePdfDownloadUrl(
  storagePath: string,
  expiresInSeconds = 300
): Promise<string> {
  const safeExpiresIn = Math.max(1, Math.min(Math.floor(expiresInSeconds), 3600));
  const { data, error } = await supabase.storage
    .from(ISSUED_INVOICE_BUCKET)
    .createSignedUrl(storagePath, safeExpiresIn);
  if (error || !data?.signedUrl) {
    throw toSafeError(error, 'create the archived invoice PDF download link');
  }
  return data.signedUrl;
}

export async function getMissingInvoicePdfIds(year: number): Promise<string[]> {
  if (!Number.isInteger(year) || year < 2000 || year > 2200) {
    throw new FinanceValidationError('Choose a valid tax year.');
  }

  const start = `${year}-01-01`;
  const end = `${year + 1}-01-01`;
  const { data, error } = await supabase
    .from('invoices')
    .select('id')
    .gte('date', start)
    .lt('date', end)
    .neq('status', 'draft')
    .is('pdf_storage_path', null);

  if (error) throw toSafeError(error, 'check invoice archives');
  return (data ?? []).map((invoice) => invoice.id as string);
}
