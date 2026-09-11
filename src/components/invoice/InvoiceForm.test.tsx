import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Invoice } from '@/types/invoice';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), updateInvoice: vi.fn(), toast: vi.fn(),
  getInvoiceById: vi.fn(), prepareInvoiceArchive: vi.fn(), archiveIssuedInvoicePdf: vi.fn() }));

vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: {
      name: 'Owner', street: 'Street', postalCode: '12345', city: 'Berlin',
      preferences: { defaultPaymentTerms: 14, isKleinunternehmer: true },
    },
  }),
}));
vi.mock('@/hooks/useClients', () => ({
  useClients: () => ({ clients: [], loadClients: vi.fn(), addClient: vi.fn() }),
}));
vi.mock('@/hooks/useInvoices', () => ({
  useInvoices: () => ({ addInvoice: vi.fn(), updateInvoice: mocks.updateInvoice }),
}));
vi.mock('@/lib/storage', () => ({ getNextInvoiceNumber: vi.fn(), getInvoiceById: mocks.getInvoiceById }));
vi.mock('@/lib/finance-storage', () => ({ prepareInvoiceArchive: mocks.prepareInvoiceArchive }));
vi.mock('@/lib/pdf-generator', () => ({ archiveIssuedInvoicePdf: mocks.archiveIssuedInvoicePdf }));
vi.mock('@/hooks/use-toast', () => ({ toast: mocks.toast }));
vi.mock('./LineItemEditor', () => ({ LineItemEditor: () => <div /> }));
vi.mock('./ClientSelector', () => ({ ClientSelector: () => <div /> }));
vi.mock('./InvoicePreview', () => ({ InvoicePreview: () => <div /> }));
vi.mock('@/components/ui/resizable-panels', () => ({
  ResizablePanels: ({ leftPanel }: { leftPanel: ReactNode }) => <>{leftPanel}</>,
}));

import { InvoiceForm } from './InvoiceForm';

const invoice: Invoice = {
  id: 'invoice-1', invoiceNumber: 'INV-001', date: '2026-01-01',
  servicePeriodStart: '', servicePeriodEnd: '', clientId: 'client-1',
  client: { id: 'client-1', name: 'Client', street: '', postalCode: '', city: '', totalInvoiced: 0 },
  lineItems: [{ id: 'line-1', description: 'Work', quantity: 1, unit: 'Pauschal', unitPrice: 10, total: 10 }],
  subtotal: 10, vatRate: 0, vatAmount: 0, total: 10, paymentTerms: 14,
  dueDate: '2026-01-15', status: 'overdue', persistedStatus: 'pending', notes: 'original',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};

describe('InvoiceForm persistence failures', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);
  it('restores the missing archive warning and retry after reloading a pending issuance', () => {
    render(<InvoiceForm existingInvoice={{ ...invoice, archiveIntent: 'issue', contentRevision: 4 }} mode="edit" />);
    expect(screen.getByText('PDF archive missing')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry PDF archive' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Backfill archived PDF' })).not.toBeInTheDocument();
  });
  it('persists pending before rendering fails and retries a fresh stored snapshot', async () => {
    const stored = { ...invoice, status: 'draft' as const, persistedStatus: 'draft' as const, contentRevision: 7 };
    mocks.updateInvoice.mockResolvedValue(undefined);
    mocks.getInvoiceById.mockResolvedValueOnce(stored);
    mocks.prepareInvoiceArchive.mockResolvedValue(undefined);
    mocks.archiveIssuedInvoicePdf.mockRejectedValueOnce(new Error('Storage unavailable'));
    render(<InvoiceForm existingInvoice={stored} mode="edit" />);
    fireEvent.click(screen.getByRole('button', { name: 'Issue invoice' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'PDF archive missing' })));
    expect(mocks.prepareInvoiceArchive).toHaveBeenCalledWith(invoice.id, 7, 'issue');
    expect(mocks.archiveIssuedInvoicePdf).toHaveBeenCalledWith(expect.objectContaining({
      status: 'pending', archiveIntent: 'issue', contentRevision: 7,
    }), expect.anything());
    expect(screen.getByText('PDF archive missing')).toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();
    const refreshed = { ...invoice, status: 'pending' as const, archiveIntent: 'issue' as const, notes: 'Newer saved notes', contentRevision: 9 };
    mocks.getInvoiceById.mockResolvedValueOnce(refreshed);
    mocks.archiveIssuedInvoicePdf.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Retry PDF archive' }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/invoices'));
    expect(mocks.archiveIssuedInvoicePdf).toHaveBeenLastCalledWith(refreshed, expect.anything());
  });
  it('shows an error and does not navigate or show success when saving fails', async () => {
    mocks.updateInvoice.mockRejectedValueOnce(new Error('database rejected update'));
    render(<InvoiceForm existingInvoice={invoice} mode="edit" />);

    fireEvent.click(screen.getByRole('button', { name: /^save changes$/i }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Error', description: 'Failed to save invoice', variant: 'destructive',
    })));
    expect(mocks.updateInvoice).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }));
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Success' }));
  });
  it('does not offer normal edits for an invoice whose issued PDF is archived', () => {
    render(<InvoiceForm existingInvoice={{ ...invoice, pdfStoragePath: 'owner/invoice-1/archive.pdf', pdfSha256: 'a'.repeat(64) }} mode="edit" />);
    expect(screen.getByText('Issued invoice archived')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^save changes$/i })).not.toBeInTheDocument();
  });
});
