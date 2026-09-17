import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Invoice } from '@/types/invoice';

const storageMock = vi.hoisted(() => ({
  deleteInvoice: vi.fn(),
  getInvoices: vi.fn(),
  saveInvoice: vi.fn(),
}));

vi.mock('@/lib/storage', () => storageMock);

import { useInvoices } from './useInvoices';

const legacyPending: Invoice = {
  id: 'invoice-1', invoiceNumber: 'INV-001', date: '2026-01-01',
  servicePeriodStart: '', servicePeriodEnd: '', clientId: 'client-1',
  client: { id: 'client-1', name: 'Client', street: '', postalCode: '', city: '', totalInvoiced: 0 },
  lineItems: [], subtotal: 0, vatRate: 0, vatAmount: 0, total: 0,
  paymentTerms: 14, dueDate: '2026-01-15', status: 'pending', notes: 'original',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};

describe('useInvoices persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useInvoices.setState({ invoices: [], loading: false });
  });

  it('keeps overdue display separate from the stored pending status during a legacy note edit', async () => {
    storageMock.getInvoices.mockResolvedValue([legacyPending]);
    storageMock.saveInvoice.mockResolvedValue(undefined);

    await useInvoices.getState().loadInvoices();
    const displayed = useInvoices.getState().invoices[0];
    expect(displayed).toMatchObject({ status: 'overdue', persistedStatus: 'pending' });

    await useInvoices.getState().updateInvoice({ ...displayed, status: 'pending', notes: 'corrected note' });

    expect(storageMock.saveInvoice).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending', notes: 'corrected note' }));
  });

  it('does not optimistically update local state when persistence fails', async () => {
    useInvoices.setState({ invoices: [legacyPending] });
    storageMock.saveInvoice.mockRejectedValue(new Error('database rejected update'));

    await expect(useInvoices.getState().updateInvoice({ ...legacyPending, notes: 'not saved' })).rejects.toThrow(
      'database rejected update'
    );

    expect(useInvoices.getState().invoices).toEqual([legacyPending]);
  });

  it('does not mark an invoice paid locally when persistence fails', async () => {
    useInvoices.setState({ invoices: [legacyPending] });
    storageMock.saveInvoice.mockRejectedValue(new Error('database rejected paid transition'));

    await expect(useInvoices.getState().markAsPaid(legacyPending.id)).rejects.toThrow(
      'database rejected paid transition'
    );

    expect(useInvoices.getState().invoices).toEqual([legacyPending]);
  });
});
