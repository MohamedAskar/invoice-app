import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FinanceSummary } from './FinanceSummary';

describe('FinanceSummary', () => {
  it('calculates operating profit from issued revenue minus booked expenses', () => {
    render(<FinanceSummary data={{ issuedRevenue: 1500, paidRevenue: 900, bookedExpenses: 275, operatingProfit: 1225, needsReviewCount: 2 }} />);
    expect(screen.getByText('€1,225.00')).toBeInTheDocument();
    expect(screen.getByText(/2 expenses need review/i)).toBeInTheDocument();
  });
});
