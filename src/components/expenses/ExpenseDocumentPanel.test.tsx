import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Expense } from '@/types/finance';
import { ExpenseDocumentPanel } from './ExpenseDocumentPanel';

const { getDocumentDownloadUrl } = vi.hoisted(() => ({ getDocumentDownloadUrl: vi.fn() }));

vi.mock('@/lib/finance-storage', () => ({ getDocumentDownloadUrl }));

afterEach(() => cleanup());

const expense: Expense = {
  id: 'expense-1', vendor: 'Example vendor', category: 'software', expenseDate: '2026-09-01',
  netAmount: 10, vatAmount: 1.9, grossAmount: 11.9, currency: 'EUR', status: 'needs_review',
  source: 'gmail', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
  documents: [
    {
      id: 'supporting-image', expenseId: 'expense-1', documentRole: 'supporting', isPrimary: false,
      storagePath: 'expense-1/image', filename: 'order.png', detectedMimeType: 'image/png', byteSize: 400,
      sha256: 'image', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    },
    {
      id: 'primary-pdf', expenseId: 'expense-1', documentRole: 'invoice', isPrimary: true,
      storagePath: 'expense-1/invoice', filename: 'invoice.pdf', detectedMimeType: 'application/pdf', byteSize: 400,
      sha256: 'pdf', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    },
  ],
};

describe('ExpenseDocumentPanel', () => {
  it('automatically opens the primary PDF for a review draft', async () => {
    getDocumentDownloadUrl.mockResolvedValue('https://files.example.test/invoice.pdf');

    render(<ExpenseDocumentPanel expense={expense} />);

    await waitFor(() => expect(getDocumentDownloadUrl).toHaveBeenCalledWith(expense.documents[1]));
    expect(await screen.findByTitle('Private receipt preview')).toHaveAttribute('src', 'https://files.example.test/invoice.pdf');
    expect(screen.getByRole('button', { name: 'Refresh preview' })).toBeVisible();
  });

  it('does not automatically open evidence after an expense is booked', async () => {
    getDocumentDownloadUrl.mockClear();

    render(<ExpenseDocumentPanel expense={{ ...expense, status: 'booked' }} />);

    await waitFor(() => expect(getDocumentDownloadUrl).not.toHaveBeenCalled());
    expect(screen.queryByTitle('Private receipt preview')).not.toBeInTheDocument();
  });
});
