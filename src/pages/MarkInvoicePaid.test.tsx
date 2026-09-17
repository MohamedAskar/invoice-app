import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Invoice } from '@/types/invoice';

const mocks = vi.hoisted(() => ({
  deleteInvoice: vi.fn(),
  getInvoice: vi.fn(),
  invoices: [] as Invoice[],
  loadInvoices: vi.fn(),
  markAsPaid: vi.fn(),
  toast: vi.fn(),
  updateStatuses: vi.fn(),
}));

vi.mock('@/hooks/useInvoices', () => ({
  useInvoices: () => ({
    deleteInvoice: mocks.deleteInvoice,
    getInvoice: mocks.getInvoice,
    invoices: mocks.invoices,
    loadInvoices: mocks.loadInvoices,
    markAsPaid: mocks.markAsPaid,
    updateStatuses: mocks.updateStatuses,
  }),
}));
vi.mock('@/hooks/useSettings', () => ({ useSettings: () => ({ settings: {} }) }));
vi.mock('@/hooks/use-toast', () => ({ toast: mocks.toast }));
vi.mock('@/components/invoice/InvoicePreview', () => ({
  InvoicePreview: ({ invoice }: { invoice: Invoice }) => <div>Preview status: {invoice.status}</div>,
}));
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
}));
vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogAction: ({ children, ...props }: ComponentProps<'button'>) => <button {...props}>{children}</button>,
  AlertDialogCancel: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  AlertDialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import { InvoicesList } from './InvoicesList';
import { ViewInvoice } from './ViewInvoice';

const pendingInvoice: Invoice = {
  id: 'invoice-1', invoiceNumber: 'INV-001', date: '2099-01-01',
  servicePeriodStart: '', servicePeriodEnd: '', clientId: 'client-1',
  client: { id: 'client-1', name: 'Client', street: '', postalCode: '', city: '', totalInvoiced: 0 },
  lineItems: [], subtotal: 10, vatRate: 0, vatAmount: 0, total: 10,
  paymentTerms: 14, dueDate: '2099-01-15', status: 'pending',
  createdAt: '2099-01-01T00:00:00Z', updatedAt: '2099-01-01T00:00:00Z',
};

describe('mark invoice as paid persistence failures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoices = [pendingInvoice];
    mocks.getInvoice.mockReturnValue(pendingInvoice);
    mocks.loadInvoices.mockResolvedValue(undefined);
    mocks.markAsPaid.mockRejectedValue(new Error('database rejected update'));
  });

  afterEach(cleanup);

  it('keeps the invoice unchanged and reports an error from the invoice view', async () => {
    render(
      <MemoryRouter initialEntries={['/invoices/invoice-1']}>
        <Routes>
          <Route path="/invoices/:id" element={<ViewInvoice />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole('button', { name: /mark as paid/i }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Error', description: 'Failed to mark invoice as paid', variant: 'destructive',
    })));
    expect(screen.getByText('Preview status: pending')).toBeInTheDocument();
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Success' }));
  });

  it('reports an error without announcing success from the invoice list', async () => {
    render(<MemoryRouter><InvoicesList /></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: /mark as paid/i }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Error', description: 'Failed to mark invoice as paid', variant: 'destructive',
    })));
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Success' }));
  });
});
