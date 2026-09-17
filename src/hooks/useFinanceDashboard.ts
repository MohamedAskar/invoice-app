import { useMemo } from 'react';
import { accountingDateForExpense } from '@/lib/finance-calculations';
import { Expense } from '@/types/finance';
import { Invoice } from '@/types/invoice';

export interface FinanceMonth {
  month: number;
  label: string;
  issuedRevenue: number;
  bookedExpenses: number;
  operatingProfit: number;
}

export interface FinanceDashboardData {
  issuedRevenue: number;
  paidRevenue: number;
  bookedExpenses: number;
  operatingProfit: number;
  needsReviewCount: number;
  months: FinanceMonth[];
}

const monthFormatter = new Intl.DateTimeFormat('en', { month: 'short' });

function belongsToYear(date: string | undefined, year: number): boolean {
  return Boolean(date && date.slice(0, 4) === String(year));
}

/**
 * Applies the dashboard's deliberately simple EUR Kleinunternehmer overview:
 * issued invoices are recognised by issue date, paid invoices by their payment
 * date (falling back to the invoice date when a paid invoice has no saved
 * payment date),
 * and only booked expenses reduce profit, by their gross amount and accounting
 * date (paid date when present, otherwise expense date). This is reporting
 * guidance only, rather than a filed return or tax calculation.
 */
export function calculateFinanceDashboard(
  invoices: Invoice[],
  expenses: Expense[],
  year: number,
): FinanceDashboardData {
  const months: FinanceMonth[] = Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    label: monthFormatter.format(new Date(year, index, 1)),
    issuedRevenue: 0,
    bookedExpenses: 0,
    operatingProfit: 0,
  }));

  let issuedRevenue = 0;
  let paidRevenue = 0;
  let bookedExpenses = 0;
  let needsReviewCount = 0;

  for (const invoice of invoices) {
    // A draft has not been issued, so it is neither revenue nor profit.
    if (invoice.status === 'draft') continue;

    if (belongsToYear(invoice.date, year)) {
      const month = Number(invoice.date.slice(5, 7)) - 1;
      issuedRevenue += invoice.total;
      if (months[month]) months[month].issuedRevenue += invoice.total;
    }

    const paymentDate = invoice.paidDate ?? invoice.date;
    if (invoice.status === 'paid' && belongsToYear(paymentDate, year)) {
      paidRevenue += invoice.total;
    }
  }

  for (const expense of expenses) {
    const accountingDate = accountingDateForExpense(expense);
    if (!belongsToYear(accountingDate, year)) continue;

    if (expense.status === 'needs_review') {
      needsReviewCount += 1;
      continue;
    }

    // Voided records remain visible but never affect reporting totals.
    if (expense.status !== 'booked') continue;

    const month = Number(accountingDate.slice(5, 7)) - 1;
    bookedExpenses += expense.grossAmount;
    if (months[month]) months[month].bookedExpenses += expense.grossAmount;
  }

  for (const month of months) {
    month.operatingProfit = month.issuedRevenue - month.bookedExpenses;
  }

  return {
    issuedRevenue,
    paidRevenue,
    bookedExpenses,
    operatingProfit: issuedRevenue - bookedExpenses,
    needsReviewCount,
    months,
  };
}

export function useFinanceDashboard(invoices: Invoice[], expenses: Expense[], year: number): FinanceDashboardData {
  return useMemo(
    () => calculateFinanceDashboard(invoices, expenses, year),
    [expenses, invoices, year],
  );
}
