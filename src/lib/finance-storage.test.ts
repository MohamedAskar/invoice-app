import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMock = vi.hoisted(() => ({
  auth: { getUser: vi.fn() },
  from: vi.fn(),
  rpc: vi.fn(),
  storage: { from: vi.fn() },
}));

vi.mock('./supabase', () => ({ supabase: supabaseMock }));

import {
  FinanceValidationError,
  UnsupportedDocumentError,
  deleteDraftExpense,
  saveExpense,
  toExpense,
  uploadExpenseDocument,
  uploadIssuedInvoicePdf,
} from './finance-storage';

beforeEach(() => {
  vi.clearAllMocks();
});

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

  it('refuses to edit a booked expense before sending an update', async () => {
    supabaseMock.from.mockReturnValue(statusQuery('booked'));

    await expect(
      saveExpense(
        {
          vendor: 'Figma',
          category: 'software',
          expenseDate: '2026-01-05',
          netAmount: 10,
          vatAmount: 1.9,
          currency: 'EUR',
          status: 'booked',
        },
        'e1'
      )
    ).rejects.toMatchObject({ code: 'financial_record_immutable' });
  });

  it('uses Storage RLS cleanup when the issue race is rejected', async () => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'invoices') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { id: 'i1', status: 'draft', pdf_storage_path: null, pdf_sha256: null },
                  error: null,
                }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });
    const upload = vi.fn().mockResolvedValue({ error: null });
    const remove = vi.fn().mockImplementation(([path]: string[]) =>
      Promise.resolve({ data: [{ name: path }], error: null })
    );
    supabaseMock.storage.from.mockReturnValue({ upload, remove });
    supabaseMock.rpc.mockResolvedValueOnce({ data: false, error: null });

    await expect(uploadIssuedInvoicePdf('i1', new Blob(['PDF'], { type: 'application/pdf' }))).rejects.toMatchObject({
      code: 'financial_record_immutable',
    });

    expect(supabaseMock.rpc).toHaveBeenNthCalledWith(
      1,
      'archive_issued_invoice_pdf',
      expect.objectContaining({ p_invoice_id: 'i1' })
    );
    expect(remove).toHaveBeenCalledWith([
      expect.stringMatching(/^u1\/i1\/[0-9a-f]{64}\.pdf$/),
    ]);
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
  });

  it('reports an orphan cleanup failure when Storage RLS rejects removal', async () => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    supabaseMock.from.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: { id: 'i1', status: 'draft', pdf_storage_path: null, pdf_sha256: null },
              error: null,
            }),
        }),
      }),
    });
    const remove = vi.fn().mockResolvedValue({ error: { message: 'RLS denied delete' } });
    supabaseMock.storage.from.mockReturnValue({ upload: vi.fn().mockResolvedValue({ error: null }), remove });
    supabaseMock.rpc.mockResolvedValue({ data: false, error: null });

    await expect(uploadIssuedInvoicePdf('i1', new Blob(['PDF'], { type: 'application/pdf' }))).rejects.toMatchObject({
      code: 'invoice_archive_cleanup_failed',
    });

    expect(remove).toHaveBeenCalledOnce();
  });

  it('reports an orphan cleanup failure when Storage RLS removes no object', async () => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    supabaseMock.from.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: { id: 'i1', status: 'draft', pdf_storage_path: null, pdf_sha256: null },
              error: null,
            }),
        }),
      }),
    });
    const remove = vi.fn().mockResolvedValue({ data: [], error: null });
    supabaseMock.storage.from.mockReturnValue({ upload: vi.fn().mockResolvedValue({ error: null }), remove });
    supabaseMock.rpc.mockResolvedValue({ data: false, error: null });

    await expect(uploadIssuedInvoicePdf('i1', new Blob(['PDF'], { type: 'application/pdf' }))).rejects.toMatchObject({
      code: 'invoice_archive_cleanup_failed',
    });

    expect(remove).toHaveBeenCalledOnce();
  });

  it('removes review document metadata before its now-unreferenced Storage object', async () => {
    const events: string[] = [];
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'expenses') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: expenseRow(), error: null }) }),
          }),
        };
      }
      if (table === 'expense_documents') {
        return {
          delete: () => ({
            eq: () => ({
              select: () => ({
                maybeSingle: () => {
                  events.push('metadata');
                  return Promise.resolve({ data: { storage_path: 'owner/e1/receipt.pdf' }, error: null });
                },
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });
    const remove = vi.fn().mockImplementation(() => {
      events.push('storage');
      return Promise.resolve({ error: null });
    });
    supabaseMock.storage.from.mockReturnValue({ remove });
    supabaseMock.rpc.mockImplementation(() => {
      events.push('draft');
      return Promise.resolve({ data: true, error: null });
    });

    await expect(deleteDraftExpense('e1')).resolves.toBeUndefined();

    expect(remove).toHaveBeenCalledWith(['owner/e1/receipt.pdf']);
    expect(supabaseMock.rpc).toHaveBeenCalledWith('delete_review_expense', { p_expense_id: 'e1' });
    expect(events).toEqual(['metadata', 'storage', 'draft']);
  });

  it('cleans up an uploaded object when its document metadata insert loses the duplicate race', async () => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: { id: 'owner' } }, error: null });
    let documentQueryCount = 0;
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'expenses') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'e1', status: 'needs_review' }, error: null }) }),
          }),
        };
      }
      if (table === 'expense_documents') {
        documentQueryCount += 1;
        if (documentQueryCount === 1) {
          return {
            select: () => ({
              eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
            }),
          };
        }
        if (documentQueryCount === 2) {
          return { select: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) };
        }
        return {
          insert: () => ({
            select: () => ({ single: () => Promise.resolve({ data: null, error: { code: '23505' } }) }),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });
    const upload = vi.fn().mockResolvedValue({ error: null });
    const remove = vi.fn().mockResolvedValue({ error: null });
    supabaseMock.storage.from.mockReturnValue({ upload, remove });

    await expect(
      uploadExpenseDocument(new File(['PDF'], 'receipt.pdf', { type: 'application/pdf' }), 'e1')
    ).rejects.toMatchObject({ code: 'duplicate_expense_document' });

    expect(upload).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
  });
});

function statusQuery(status: string) {
  return {
    select: () => ({
      eq: () => ({ maybeSingle: () => Promise.resolve({ data: { status }, error: null }) }),
    }),
  };
}

function expenseRow() {
  return {
    id: 'e1',
    vendor: 'Figma',
    vendor_invoice_number: null,
    category: 'software',
    description: null,
    expense_date: '2026-01-05',
    paid_date: null,
    net_amount: '10.00',
    vat_amount: '1.90',
    gross_amount: '11.90',
    currency: 'EUR',
    status: 'needs_review',
    source: 'upload',
    notes: null,
    created_at: '2026-01-05T00:00:00Z',
    updated_at: '2026-01-05T00:00:00Z',
    expense_documents: [documentRow({ storage_path: 'owner/e1/receipt.pdf' })],
  };
}

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
