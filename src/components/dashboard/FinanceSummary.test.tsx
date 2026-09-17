import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FinanceSummary } from './FinanceSummary';

describe('FinanceSummary', () => {
  it('presents invoiced income, expenses, and the simple profit story separately from cash received', () => {
    render(<FinanceSummary period={2026} data={{ issuedRevenue: 1500, paidRevenue: 900, bookedExpenses: 275, operatingProfit: 1225, needsReviewCount: 2 }} />);
    expect(screen.getByText('€1,225.00')).toBeInTheDocument();
    expect(screen.getByText('Money invoiced')).toBeInTheDocument();
    expect(screen.getByText('Money received')).toBeInTheDocument();
    expect(screen.getByText('Left after expenses')).toBeInTheDocument();
    expect(screen.getByText(/2 receipts need review/i)).toBeInTheDocument();
  });
});
