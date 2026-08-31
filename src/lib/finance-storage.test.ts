import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));

import {
  FinanceValidationError,
  UnsupportedDocumentError,
  saveExpense,
  toExpense,
  uploadExpenseDocument,
  uploadIssuedInvoicePdf,
} from './finance-storage';

describe('toExpense', () => {
  it('maps numeric database values and documents to an Expense', () => {
    expect(
      toExpense({
        id: 'e1',
        vendor: 'Figma',
        vendor_invoice_number: 'FIG-1',
        net_amount: '10.00',
        vat_amount: '1.90',
        gross_amount: '11.90',
        expense_date: '2026-01-05',
        paid_date: null,
        category: 'software',
        description: null,
        currency: 'EUR',
        status: 'booked',
        source: 'upload',
        notes: null,
        created_at: '2026-01-05T00:00:00Z',
        updated_at: '2026-01-05T00:00:00Z',
        expense_documents: [],
      })
    ).toMatchObject({
      grossAmount: 11.9,
      netAmount: 10,
      vatAmount: 1.9,
      vendorInvoiceNumber: 'FIG-1',
    });
  });

  it('orders the primary invoice before other documents deterministically', () => {
    const expense = toExpense({
      id: 'e1',
      vendor: 'Figma',
      vendor_invoice_number: null,
      net_amount: '10.00',
      vat_amount: '1.90',
      gross_amount: '11.90',
      expense_date: '2026-01-05',
      paid_date: null,
      category: 'software',
      description: null,
      currency: 'EUR',
      status: 'booked',
      source: 'upload',
      notes: null,
      created_at: '2026-01-05T00:00:00Z',
      updated_at: '2026-01-05T00:00:00Z',
      expense_documents: [
        documentRow({ id: 'supporting', document_role: 'supporting', is_primary: false, filename: 'z.pdf' }),
        documentRow({ id: 'receipt', document_role: 'receipt', is_primary: false, filename: 'a.pdf' }),
        documentRow({ id: 'invoice', document_role: 'invoice', is_primary: true, filename: 'm.pdf' }),
      ],
    });

    expect(expense.documents.map((document) => document.id)).toEqual([
      'invoice',
      'receipt',
      'supporting',
    ]);
  });
});

describe('finance storage validation', () => {
  it('requires EUR and non-negative manual amounts before making a request', async () => {
    await expect(
      saveExpense({
        vendor: 'Figma',
        category: 'software',
        expenseDate: '2026-01-05',
        netAmount: -1,
        vatAmount: 0,
        currency: 'EUR',
        status: 'needs_review',
      })
    ).rejects.toBeInstanceOf(FinanceValidationError);
  });

  it('rejects unsupported uploads before reading the session or storage', async () => {
    await expect(
      uploadExpenseDocument(new File(['not a receipt'], 'receipt.txt', { type: 'text/plain' }), 'e1')
    ).rejects.toBeInstanceOf(UnsupportedDocumentError);
    await expect(uploadIssuedInvoicePdf('i1', new Blob(['not a PDF'], { type: 'text/plain' }))).rejects.toBeInstanceOf(
      UnsupportedDocumentError
    );
  });
});

function documentRow(
  overrides: Record<string, unknown>
): NonNullable<Parameters<typeof toExpense>[0]['expense_documents']>[number] {
  return {
    id: 'document',
    expense_id: 'e1',
    document_role: 'invoice',
    is_primary: false,
    storage_path: 'user/e1/document.pdf',
    filename: 'document.pdf',
    declared_mime_type: 'application/pdf',
    detected_mime_type: 'application/pdf',
    byte_size: 100,
    sha256: 'a'.repeat(64),
    created_at: '2026-01-05T00:00:00Z',
    updated_at: '2026-01-05T00:00:00Z',
    ...overrides,
  } as NonNullable<Parameters<typeof toExpense>[0]['expense_documents']>[number];
}
