import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Invoice } from '@/types/invoice';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), updateInvoice: vi.fn(), toast: vi.fn() }));

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
vi.mock('@/lib/storage', () => ({ getNextInvoiceNumber: vi.fn() }));
vi.mock('@/lib/pdf-generator', () => ({ generatePDF: vi.fn() }));
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
  it('shows an error and does not navigate or show success when saving fails', async () => {
    mocks.updateInvoice.mockRejectedValueOnce(new Error('database rejected update'));
    render(<InvoiceForm existingInvoice={invoice} mode="edit" />);

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Error', description: 'Failed to save invoice', variant: 'destructive',
    })));
    expect(mocks.updateInvoice).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }));
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Success' }));
  });
});
