import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultBusinessSettings, type Invoice } from '@/types/invoice';

const uploadIssuedInvoicePdf = vi.hoisted(() => vi.fn());
const toBlob = vi.hoisted(() => vi.fn());

vi.mock('./finance-storage', () => ({ uploadIssuedInvoicePdf }));
vi.mock('@react-pdf/renderer', () => ({ pdf: () => ({ toBlob }) }));
vi.mock('@/components/invoice/InvoicePDF', () => ({ InvoicePDF: () => null }));

import { archiveIssuedInvoicePdf } from './pdf-generator';

const invoice: Invoice = {
  id: 'invoice-1',
  invoiceNumber: 'INV-001',
  date: '2026-09-07',
  servicePeriodStart: '2026-09-01',
  servicePeriodEnd: '2026-09-07',
  clientId: 'client-1',
  client: {
    id: 'client-1', name: 'Client', street: 'Street 1', postalCode: '10115', city: 'Berlin', totalInvoiced: 0,
  },
  lineItems: [{ id: 'item-1', description: 'Work', quantity: 1, unit: 'Stunden', unitPrice: 100, total: 100 }],
  subtotal: 100,
  vatRate: 0,
  vatAmount: 0,
  total: 100,
  paymentTerms: 14,
  dueDate: '2026-09-21',
  status: 'pending',
  contentRevision: 7,
  createdAt: '2026-09-07T00:00:00.000Z',
  updatedAt: '2026-09-07T00:00:00.000Z',
};

describe('archiveIssuedInvoicePdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores a PDF only after a draft is issued', async () => {
    const blob = new Blob(['PDF'], { type: 'application/pdf' });
    toBlob.mockResolvedValue(blob);

    await archiveIssuedInvoicePdf({ ...invoice, status: 'draft' }, defaultBusinessSettings);
    expect(uploadIssuedInvoicePdf).not.toHaveBeenCalled();

    await archiveIssuedInvoicePdf(invoice, defaultBusinessSettings);
    expect(uploadIssuedInvoicePdf).toHaveBeenCalledWith(invoice.id, blob, 7, 'issue');
  });

  it('carries deliberate backfill intent separately from ordinary issuance', async () => {
    const blob = new Blob(['PDF'], { type: 'application/pdf' });
    toBlob.mockResolvedValue(blob);
    await archiveIssuedInvoicePdf(invoice, defaultBusinessSettings, 'backfill');
    expect(uploadIssuedInvoicePdf).toHaveBeenCalledWith(invoice.id, blob, 7, 'backfill');
  });

  it('reuses an existing immutable archive without rendering or uploading another PDF', async () => {
    await archiveIssuedInvoicePdf(
      { ...invoice, pdfStoragePath: 'owner/invoice-1/already-archived.pdf' },
      defaultBusinessSettings
    );

    expect(toBlob).not.toHaveBeenCalled();
    expect(uploadIssuedInvoicePdf).not.toHaveBeenCalled();
  });
});
