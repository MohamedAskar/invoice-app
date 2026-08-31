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
const EXPENSE_SELECT = '*, expense_documents(*)';

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

export async function deleteDraftExpense(id: string): Promise<void> {
  const expense = await getExpenseById(id);
  if (!expense) throw new FinanceStorageError('The expense was not found.', 'expense_not_found');
  if (expense.status !== 'needs_review') throw new FinancialRecordImmutableError();

  const documentPaths = expense.documents.map((document) => document.storagePath);
  if (documentPaths.length) {
    const { error: storageError } = await supabase.storage
      .from(EXPENSE_DOCUMENT_BUCKET)
      .remove(documentPaths);
    if (storageError) throw toSafeError(storageError, 'delete the review expense documents');
  }

  const { data, error } = await supabase.rpc('delete_review_expense', { p_expense_id: id });
  if (error) {
    throw new FinanceStorageError(
      'The receipt files were removed, but the review expense still needs deletion. Please retry.',
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

async function discardUnarchivedInvoicePdf(
  invoiceId: string,
  storagePath: string,
  checksum: string
): Promise<void> {
  const { data, error } = await supabase.rpc('discard_unarchived_invoice_pdf', {
    p_invoice_id: invoiceId,
    p_storage_path: storagePath,
    p_sha256: checksum,
  });
  if (error || !data) {
    throw toSafeError(error, 'clean up the unarchived invoice PDF');
  }
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

export async function uploadIssuedInvoicePdf(invoiceId: string, blob: Blob): Promise<void> {
  const mimeType = blob.type.toLowerCase().split(';', 1)[0];
  if (mimeType !== 'application/pdf') throw new UnsupportedDocumentError();
  if (blob.size <= 0) throw new FinanceValidationError('Archive a non-empty PDF.');
  if (blob.size > MAX_ISSUED_INVOICE_BYTES) throw new DocumentTooLargeError(MAX_ISSUED_INVOICE_BYTES);

  const userId = await requireAuthenticatedUserId();
  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices')
    .select('id, status, pdf_storage_path, pdf_sha256')
    .eq('id', invoiceId)
    .maybeSingle();
  if (invoiceError) throw toSafeError(invoiceError, 'prepare the invoice archive');
  if (!invoice) throw new FinanceStorageError('The invoice was not found.', 'invoice_not_found');
  if (
    invoice.status !== 'draft' ||
    invoice.pdf_storage_path ||
    invoice.pdf_sha256
  ) {
    throw new FinancialRecordImmutableError('The issued invoice PDF is already archived.');
  }

  const checksum = await sha256Hex(await blob.arrayBuffer());
  const path = `${userId}/${invoiceId}/${checksum}.pdf`;
  const { error: uploadError } = await supabase.storage
    .from(ISSUED_INVOICE_BUCKET)
    .upload(path, blob, { cacheControl: '31536000', contentType: 'application/pdf', upsert: false });
  if (uploadError) throw toSafeError(uploadError, 'archive the invoice PDF');

  const { data: archived, error: archiveError } = await supabase.rpc('archive_issued_invoice_pdf', {
    p_invoice_id: invoiceId,
    p_storage_path: path,
    p_sha256: checksum,
  });

  if (archiveError || !archived) {
    try {
      await discardUnarchivedInvoicePdf(invoiceId, path, checksum);
    } catch {
      throw new FinanceStorageError(
        'The invoice was not issued and its uploaded PDF needs cleanup. Please retry.',
        'invoice_archive_cleanup_failed'
      );
    }
    if (!archiveError) {
      throw new FinancialRecordImmutableError('The invoice changed before its PDF could be archived.');
    }
    throw toSafeError(archiveError, 'archive the invoice PDF');
  }
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
