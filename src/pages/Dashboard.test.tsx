import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadInvoices: vi.fn().mockRejectedValue(new Error('Invoices unavailable')),
  loadExpenses: vi.fn().mockRejectedValue(new Error('Expenses unavailable')),
  updateStatuses: vi.fn(),
}));

vi.mock('@/hooks/useInvoices', () => ({
  useInvoices: () => ({
    invoices: [],
    loadInvoices: mocks.loadInvoices,
    markAsPaid: vi.fn(),
    updateStatuses: mocks.updateStatuses,
  }),
}));

vi.mock('@/hooks/useExpenses', () => ({
  useExpenses: (selector: (state: Record<string, unknown>) => unknown) => selector({
    expenses: [], loading: false, error: 'Expenses unavailable', loadExpenses: mocks.loadExpenses,
  }),
}));

vi.mock('@/components/dashboard/FinanceSummary', () => ({ FinanceSummary: () => <div>Finance summary</div> }));
vi.mock('@/components/dashboard/IncomeExpenseChart', () => ({ IncomeExpenseChart: () => <div>Income chart</div> }));

import { Dashboard } from './Dashboard';

describe('Dashboard data loading', () => {
  it('shows both load failures and withholds finance totals until data loads successfully', async () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>);

    expect(await screen.findByText('Could not load dashboard data')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Invoices unavailable');
    expect(screen.getByRole('alert')).toHaveTextContent('Expenses unavailable');
    expect(screen.queryByText('Finance summary')).not.toBeInTheDocument();
    expect(screen.queryByText('Income chart')).not.toBeInTheDocument();
  });
});
