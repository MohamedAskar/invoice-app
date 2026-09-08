export type ExportKind = 'issued_invoices' | 'business_expenses';
type Amount = number | string;
export interface InvoiceRecord {
  id: string; invoice_number: string; date: string; client_name: string;
  subtotal: Amount; vat_amount: Amount; total: Amount; status: string;
  pdf_storage_path: string | null; pdf_sha256: string | null;
}
export interface DocumentRecord {
  id: string; user_id: string; expense_id: string; storage_path: string;
  filename: string; is_primary: boolean; sha256: string;
}
export interface ExpenseRecord {
  id: string; user_id: string; expense_date: string; paid_date: string | null;
  vendor: string; vendor_invoice_number: string | null; category: string;
  description: string | null; net_amount: Amount; vat_amount: Amount; gross_amount: Amount;
  source: string; status: string; voided_at: string | null; void_reason: string | null;
  expense_documents: DocumentRecord[];
}
export class ExportError extends Error {
  constructor(public code: string) { super(code); }
}
export function validateRequest(value: unknown, now = new Date()): { kind: ExportKind; year: number } {
  if (!value || typeof value !== 'object') throw new ExportError('invalid_request');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !['kind', 'year'].includes(key)) ||
    !['issued_invoices', 'business_expenses'].includes(String(input.kind)) ||
    typeof input.year !== 'number' || !Number.isInteger(input.year) || input.year < 2000 || input.year > now.getUTCFullYear()) {
    throw new ExportError('invalid_request');
  }
  return { kind: input.kind as ExportKind, year: input.year };
}
export function ownedPath(path: string | null, userId: string): string {
  if (!path || !path.startsWith(`${userId}/`) || path.includes('..') || path.includes('\\') ||
    path.split('/').some((part) => !part) || [...path].some((character) => character.charCodeAt(0) < 32)) throw new ExportError('invalid_document');
  return path;
}
export function csv(rows: unknown[][]): Uint8Array {
  const cell = (value: unknown) => {
    let text = String(value ?? '');
    // Quoting alone does not prevent spreadsheet formula execution.
    if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return new TextEncoder().encode('\uFEFF' + rows.map((row) => row.map(cell).join(';')).join('\r\n') + '\r\n');
}
const money = (value: Amount) => {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new ExportError('invalid_record');
  return number.toFixed(2);
};
const cents = (value: Amount) => Math.round(Number(money(value)) * 100);
const inYear = (date: string, year: number) => date >= `${year}-01-01` && date < `${year + 1}-01-01`;
const filename = (name: string) => name.normalize('NFC').replace(/[^\p{L}\p{N}._-]/gu, '_').replace(/\.{2,}/g, '_').slice(-120) || 'document';
export async function sha256(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export async function buildPackage(input: {
  userId: string; kind: ExportKind; year: number; invoices?: InvoiceRecord[]; expenses?: ExpenseRecord[];
  generatedAt: string; download: (bucket: string, path: string) => Promise<Uint8Array>;
}): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = Object.create(null);
  let bytes = 0;
  const totals = [0, 0, 0];
  const addDocument = async (bucket: string, path: string | null, name: string, hash: string | null) => {
    ownedPath(path, input.userId);
    if (!hash || !/^[a-f0-9]{64}$/.test(hash)) throw new ExportError('invalid_document');
    const contents = await input.download(bucket, path!);
    if (!contents.byteLength || await sha256(contents) !== hash) throw new ExportError('invalid_document');
    bytes += contents.byteLength;
    // Leave headroom for CSVs and ZIP directory within the 50 MiB bucket limit.
    if (bytes > 48 * 1024 * 1024) throw new ExportError('package_too_large');
    if (files[name]) throw new ExportError('invalid_document');
    files[name] = contents;
    return name;
  };
  let count = 0;
  let voidedCount = 0;
  if (input.kind === 'issued_invoices') {
    const invoices = (input.invoices ?? []).filter((row) => row.status !== 'draft' && inYear(row.date, input.year));
    if (invoices.some((row) => !row.pdf_storage_path)) throw new ExportError('missing_invoice_pdf');
    const rows: unknown[][] = [['Invoice number', 'Issue date', 'Client', 'Net', 'VAT', 'Gross', 'Status', 'PDF filename']];
    for (const row of invoices) {
      const name = await addDocument('issued-invoices', row.pdf_storage_path, `invoices/${filename(row.id)}-${filename(row.invoice_number)}.pdf`, row.pdf_sha256);
      rows.push([row.invoice_number, row.date, row.client_name, money(row.subtotal), money(row.vat_amount), money(row.total), row.status, name]);
      [row.subtotal, row.vat_amount, row.total].forEach((amount, index) => { totals[index] += cents(amount); });
    }
    count = invoices.length;
    files[`issued-invoices-${input.year}.csv`] = csv(rows);
  } else {
    const expenses = (input.expenses ?? []).filter((row) => inYear(row.paid_date || row.expense_date, input.year));
    if (expenses.some((row) => row.user_id !== input.userId)) throw new ExportError('invalid_document');
    const booked = expenses.filter((row) => row.status === 'booked');
    const voided = expenses.filter((row) => row.status === 'voided');
    if (booked.some((row) => !row.expense_documents.length)) throw new ExportError('missing_expense_document');
    const headers = ['Accounting date', 'Document date', 'Paid date', 'Vendor', 'Vendor invoice number', 'Category', 'Description', 'Net', 'VAT', 'Gross', 'Source', 'Primary invoice filename', 'Supporting-document filenames'];
    const rows: unknown[][] = [headers];
    const fields = (row: ExpenseRecord) => [row.paid_date || row.expense_date, row.expense_date, row.paid_date, row.vendor, row.vendor_invoice_number, row.category, row.description, money(row.net_amount), money(row.vat_amount), money(row.gross_amount), row.source];
    for (const row of booked) {
      const names: { name: string; primary: boolean }[] = [];
      for (const doc of row.expense_documents) {
        if (doc.user_id !== input.userId || doc.expense_id !== row.id) throw new ExportError('invalid_document');
        const name = await addDocument('expense-documents', doc.storage_path, `expenses/${filename(row.id)}/${filename(doc.id)}-${filename(doc.filename)}`, doc.sha256);
        names.push({ name, primary: doc.is_primary });
      }
      rows.push([...fields(row), names.filter((doc) => doc.primary).map((doc) => doc.name).join(' | '), names.filter((doc) => !doc.primary).map((doc) => doc.name).join(' | ')]);
      [row.net_amount, row.vat_amount, row.gross_amount].forEach((amount, index) => { totals[index] += cents(amount); });
    }
    count = booked.length;
    voidedCount = voided.length;
    files[`business-expenses-${input.year}.csv`] = csv(rows);
    if (voided.length) files[`voided-expenses-${input.year}.csv`] = csv([
      [...headers.slice(0, 11), 'Voided at', 'Void reason'],
      ...voided.map((row) => [...fields(row), row.voided_at, row.void_reason]),
    ]);
  }
  const documentCount = Object.keys(files).filter((name) => name.startsWith('invoices/') || name.startsWith('expenses/')).length;
  files['README.txt'] = new TextEncoder().encode([
    `Annual tax documents: ${input.year}`, `Kind: ${input.kind}`, `Generated at (UTC): ${input.generatedAt}`,
    `Filter: ${input.year}-01-01 inclusive to ${input.year + 1}-01-01 exclusive.`,
    input.kind === 'issued_invoices' ? 'Issued invoices: issue date; drafts excluded. PDFs are original archived bytes, never regenerated.' : 'Booked expenses: accounting date is paid date when present, otherwise document date. All linked original documents included. Review records excluded. Voided records are audit CSV only; their documents and amounts are excluded from this package and totals.',
    `Included-count: ${count}`, `Document-count: ${documentCount}`, 'Missing-count: 0', `Voided-count: ${voidedCount}`,
    `Total net (EUR): ${(totals[0] / 100).toFixed(2)}`, `Total VAT (EUR): ${(totals[1] / 100).toFixed(2)}`, `Total gross (EUR): ${(totals[2] / 100).toFixed(2)}`,
    'CSVs: UTF-8 BOM, semicolon delimiter, quoted cells, CRLF. Formula-like text is prefixed with an apostrophe for spreadsheet safety.',
    'Download links expire after 15 minutes. Export copies expire after 24 hours; source documents remain archived.',
    'Overview for your tax advisor; not a filed return.',
  ].join('\r\n') + '\r\n');
  return files;
}
