import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Invoice } from '@/types/invoice';

const supabaseMock = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock('./supabase', () => ({ supabase: supabaseMock }));

import { saveInvoice } from './storage';

const newDraftInvoice: Invoice = {
  id: '11111111-1111-1111-1111-111111111111',
  invoiceNumber: 'INV-001',
  date: '2026-08-31',
  servicePeriodStart: '',
  servicePeriodEnd: '',
  clientId: '22222222-2222-2222-2222-222222222222',
  client: {
    id: '22222222-2222-2222-2222-222222222222',
    name: 'Client', street: '', postalCode: '', city: '', totalInvoiced: 0,
  },
  lineItems: [],
  subtotal: 0, vatRate: 0, vatAmount: 0, total: 0,
  paymentTerms: 14, dueDate: '2026-09-14', status: 'draft', notes: '',
  createdAt: '2026-08-31T00:00:00.000Z', updatedAt: '2026-08-31T00:00:00.000Z',
};

describe('saveInvoice', () => {
  beforeEach(() => vi.clearAllMocks());

  it('upserts a new invoice as a draft without archive metadata', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'invoices') return { upsert };
      if (table === 'invoice_line_items') return { delete: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }) };
      throw new Error(`Unexpected table ${table}`);
    });

    await saveInvoice(newDraftInvoice);

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ id: newDraftInvoice.id, status: 'draft' }));
    expect(upsert.mock.calls[0][0]).not.toHaveProperty('pdf_storage_path');
    expect(upsert.mock.calls[0][0]).not.toHaveProperty('pdf_sha256');
  });

  it('keeps a legacy pending status unchanged when saving its other fields', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'invoices') return { upsert };
      if (table === 'invoice_line_items') return { delete: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }) };
      throw new Error(`Unexpected table ${table}`);
    });

    await saveInvoice({ ...newDraftInvoice, status: 'pending', notes: 'Corrected legacy note' });

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending', notes: 'Corrected legacy note' }));
  });
});
