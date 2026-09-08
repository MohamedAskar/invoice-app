import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { Expense } from '@/types/finance';
import { ExpenseTable } from './ExpenseTable';

function expense(overrides: Partial<Expense>): Expense {
  return {
    id: 'expense', vendor: 'Vendor', category: 'software', expenseDate: '2026-01-10', netAmount: 100, vatAmount: 19,
    grossAmount: 119, currency: 'EUR', status: 'booked', source: 'gmail', createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z', documents: [], ...overrides,
  };
}

describe('ExpenseTable', () => {
  it('filters by accounting year, category, source and full text while totaling only matching booked rows', () => {
    render(<MemoryRouter><ExpenseTable expenses={[
      expense({ id: 'booked', vendor: 'Filing service', description: 'Annual return', expenseDate: '2025-12-20', paidDate: '2026-01-03' }),
      expense({ id: 'review', vendor: 'Filing review', notes: 'Annual receipts', status: 'needs_review', grossAmount: 238, expenseDate: '2026-02-04' }),
      expense({ id: 'other-source', vendor: 'Filing upload', description: 'Annual return', source: 'upload' }),
      expense({ id: 'other-category', vendor: 'Filing equipment', description: 'Annual return', category: 'equipment' }),
    ]} filters={{ year: '2026', category: 'software', status: 'all', source: 'gmail', query: 'annual', sort: 'date-asc' }} /></MemoryRouter>);

    expect(screen.getByText('Filing service')).toBeInTheDocument();
    expect(screen.getByText('Filing review')).toBeInTheDocument();
    expect(screen.queryByText('Filing upload')).not.toBeInTheDocument();
    expect(screen.queryByText('Filing equipment')).not.toBeInTheDocument();
    expect(screen.getByText('Filtered booked expenses only (gross EUR)').parentElement).toHaveTextContent('119,00');
  });
});
