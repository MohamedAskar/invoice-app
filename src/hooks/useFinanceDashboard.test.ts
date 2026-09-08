import { describe, expect, it } from 'vitest';
import { calculateFinanceDashboard } from './useFinanceDashboard';
import { Expense } from '@/types/finance';
import { Invoice } from '@/types/invoice';

function invoice(overrides: Partial<Invoice>): Invoice {
  return {
    id: 'invoice', invoiceNumber: 'INV-1', date: '2026-01-10', servicePeriodStart: '', servicePeriodEnd: '',
    clientId: 'client', client: { id: 'client', name: 'Client', street: '', postalCode: '', city: '', totalInvoiced: 0 },
    lineItems: [], subtotal: 0, vatRate: 0, vatAmount: 0, total: 0, paymentTerms: 14, dueDate: '2026-01-24',
    status: 'pending', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...overrides,
  };
}

function expense(overrides: Partial<Expense>): Expense {
  return {
    id: 'expense', vendor: 'Vendor', category: 'software', expenseDate: '2026-01-10', netAmount: 0, vatAmount: 0,
    grossAmount: 0, currency: 'EUR', status: 'booked', source: 'upload', createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z', documents: [], ...overrides,
  };
}

describe('calculateFinanceDashboard', () => {
  it('uses the correct dates, excludes draft/review/voided records, and populates monthly buckets', () => {
    const data = calculateFinanceDashboard([
      invoice({ id: 'issued', date: '2026-01-10', total: 1000, status: 'paid', paidDate: '2026-02-03' }),
      invoice({ id: 'paid-this-year', date: '2025-12-10', total: 500, status: 'paid', paidDate: '2026-03-03' }),
      invoice({ id: 'pending', date: '2026-03-10', total: 200, status: 'pending' }),
      invoice({ id: 'draft', date: '2026-04-10', total: 999, status: 'draft', paidDate: '2026-04-10' }),
    ], [
      expense({ id: 'january', grossAmount: 119, expenseDate: '2026-01-08' }),
      expense({ id: 'paid-date', grossAmount: 238, expenseDate: '2026-01-20', paidDate: '2026-02-02' }),
      expense({ id: 'review', grossAmount: 300, expenseDate: '2026-03-12', status: 'needs_review' }),
      expense({ id: 'voided', grossAmount: 400, expenseDate: '2026-04-12', status: 'voided' }),
      expense({ id: 'previous-year', grossAmount: 500, expenseDate: '2025-12-12' }),
    ], 2026);

    expect(data).toMatchObject({ issuedRevenue: 1200, paidRevenue: 1500, bookedExpenses: 357, operatingProfit: 843, needsReviewCount: 1 });
    expect(data.months).toHaveLength(12);
    expect(data.months[0]).toMatchObject({ issuedRevenue: 1000, bookedExpenses: 119, operatingProfit: 881 });
    expect(data.months[1]).toMatchObject({ issuedRevenue: 0, bookedExpenses: 238, operatingProfit: -238 });
    expect(data.months[2]).toMatchObject({ issuedRevenue: 200, bookedExpenses: 0, operatingProfit: 200 });
    expect(data.months[3]).toMatchObject({ issuedRevenue: 0, bookedExpenses: 0, operatingProfit: 0 });
  });
});
