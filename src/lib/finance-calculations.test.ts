import { describe, expect, it } from 'vitest';
import { accountingDateForExpense, expenseTotal } from './finance-calculations';

describe('accountingDateForExpense', () => {
  it('prefers the payment date and otherwise uses the document date', () => {
    expect(accountingDateForExpense({ expenseDate: '2026-03-05', paidDate: '2026-03-12' }))
      .toBe('2026-03-12');
    expect(accountingDateForExpense({ expenseDate: '2026-03-05', paidDate: undefined }))
      .toBe('2026-03-05');
  });
});

describe('expenseTotal', () => {
  it('adds net and VAT with two-decimal precision', () => {
    expect(expenseTotal(19.99, 3.8)).toBe(23.79);
  });
});
