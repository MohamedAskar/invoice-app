import { deepEqual, equal, match, rejects, throws } from 'node:assert/strict';
import { unzipSync, zipSync } from 'fflate';
import { buildPackage, csv, ownedPath, sha256, validateRequest, type ExpenseRecord, type InvoiceRecord } from './package.ts';

const original = new TextEncoder().encode('%PDF-1.7\noriginal immutable PDF bytes');
const hash = await sha256(original);
const invoice: InvoiceRecord = { id: 'invoice-1', invoice_number: 'INV-2026/001', date: '2026-01-01', client_name: 'Müller; "Design"', subtotal: 100, vat_amount: 19, total: 119, status: 'paid', pdf_storage_path: 'owner/invoice-1/original.pdf', pdf_sha256: hash };
const expense: ExpenseRecord = { id: 'expense-1', user_id: 'owner', expense_date: '2025-12-31', paid_date: '2026-01-02', vendor: 'Vendor', vendor_invoice_number: 'V-1', category: 'software', description: 'Annual subscription', net_amount: 100, vat_amount: 19, gross_amount: 119, source: 'upload', status: 'booked', voided_at: null, void_reason: null, expense_documents: [
  { id: 'doc-1', user_id: 'owner', expense_id: 'expense-1', storage_path: 'owner/expense-1/original.pdf', filename: 'invoice.pdf', is_primary: true, sha256: hash },
  { id: 'doc-2', user_id: 'owner', expense_id: 'expense-1', storage_path: 'owner/expense-1/receipt.pdf', filename: 'receipt.pdf', is_primary: false, sha256: hash },
] };
const base = { userId: 'owner', year: 2026, generatedAt: '2026-09-08T00:00:00.000Z', download: async () => original };
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

Deno.test('validates kind/year and rejects caller-supplied identity', () => {
  const now = new Date('2026-09-08T00:00:00Z');
  deepEqual(validateRequest({ kind: 'issued_invoices', year: 2000 }, now), { kind: 'issued_invoices', year: 2000 });
  for (const year of [1999, 2027, 2026.5, '2026', null]) throws(() => validateRequest({ kind: 'issued_invoices', year }, now));
  throws(() => validateRequest({ kind: 'issued_invoices', year: 2026, user_id: 'other' }, now));
  throws(() => validateRequest({ kind: 'anything', year: 2026 }, now));
});

Deno.test('ZIP roundtrip preserves archived PDF bytes, BOM, semicolons, Unicode, README totals and date boundaries', async () => {
  const files = await buildPackage({ ...base, kind: 'issued_invoices', invoices: [invoice,
    { ...invoice, id: 'draft', status: 'draft' }, { ...invoice, id: 'past', date: '2025-12-31' }, { ...invoice, id: 'future', date: '2027-01-01' },
  ] });
  const unzipped = unzipSync(zipSync(files, { level: 0 }));
  equal(Object.keys(unzipped).length, 3);
  const pdf = Object.keys(unzipped).find((name) => name.endsWith('.pdf'))!;
  deepEqual(unzipped[pdf], original);
  const register = unzipped['issued-invoices-2026.csv'];
  deepEqual([...register.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  match(decode(register), /"Müller; ""Design""";"100.00";"19.00";"119.00"/);
  match(decode(register), /invoices\/invoice-1-INV-2026_001.pdf/);
  match(decode(unzipped['README.txt']), /Included-count: 1\r\nDocument-count: 1\r\nMissing-count: 0/);
  match(decode(unzipped['README.txt']), /Total gross \(EUR\): 119.00/);
});

Deno.test('booked expenses use payment date fallback and include every original; voids are a separate audit register', async () => {
  const files = await buildPackage({ ...base, kind: 'business_expenses', expenses: [expense,
    { ...expense, id: 'void', status: 'voided', void_reason: 'Duplicate', voided_at: '2026-02-01T00:00:00Z', expense_documents: [] },
    { ...expense, id: 'review', status: 'needs_review' },
    { ...expense, id: 'outside', paid_date: '2027-01-01' },
  ] });
  equal(Object.keys(files).filter((name) => name.startsWith('expenses/')).length, 2);
  const register = decode(files['business-expenses-2026.csv']);
  match(register, /"2026-01-02";"2025-12-31";"2026-01-02"/);
  match(register, /doc-1-invoice.pdf/);
  match(register, /doc-2-receipt.pdf/);
  match(decode(files['voided-expenses-2026.csv']), /Duplicate/);
  match(decode(files['README.txt']), /Voided-count: 1/);
  match(decode(files['README.txt']), /Total gross \(EUR\): 119.00/);
  const fallback = await buildPackage({ ...base, kind: 'business_expenses', expenses: [{ ...expense, paid_date: null, expense_date: '2026-03-04' }] });
  match(decode(fallback['business-expenses-2026.csv']), /"2026-03-04";"2026-03-04";""/);
});

Deno.test('missing PDF, missing original, wrong owner and corrupted bytes cannot produce a final package', async () => {
  await rejects(buildPackage({ ...base, kind: 'issued_invoices', invoices: [{ ...invoice, pdf_storage_path: null }] }), /missing_invoice_pdf/);
  await rejects(buildPackage({ ...base, kind: 'business_expenses', expenses: [{ ...expense, expense_documents: [] }] }), /missing_expense_document/);
  let downloads = 0;
  await rejects(buildPackage({ ...base, download: async () => { downloads++; return original; }, kind: 'issued_invoices', invoices: [{ ...invoice, pdf_storage_path: 'other/invoice.pdf' }] }), /invalid_document/);
  equal(downloads, 0);
  await rejects(buildPackage({ ...base, kind: 'business_expenses', expenses: [{ ...expense, user_id: 'other' }] }), /invalid_document/);
  await rejects(buildPackage({ ...base, kind: 'business_expenses', expenses: [{ ...expense, expense_documents: [{ ...expense.expense_documents[0], user_id: 'other' }] }] }), /invalid_document/);
  await rejects(buildPackage({ ...base, kind: 'issued_invoices', download: async () => new Uint8Array([1, 2]), invoices: [invoice] }), /invalid_document/);
  await rejects(buildPackage({ ...base, kind: 'issued_invoices', download: async () => { throw new Error('Missing storage object'); }, invoices: [invoice] }), /Missing storage object/);
});

Deno.test('rejects traversal paths and prevents spreadsheet formulas', () => {
  for (const path of ['other/a.pdf', 'owner/../a.pdf', 'owner/a\\b.pdf', 'owner//a.pdf']) throws(() => ownedPath(path, 'owner'));
  match(decode(csv([['=HYPERLINK("https://example.test")', '+cmd', '@sum', 'safe']])), /"'=HYPERLINK/);
});
