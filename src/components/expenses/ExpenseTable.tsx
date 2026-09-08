import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { accountingDateForExpense } from '@/lib/finance-calculations';
import { formatCurrency, formatDate } from '@/lib/formatting';
import { Expense, ExpenseStatus } from '@/types/finance';
import { ExpenseFilterState } from './ExpenseFilters';

const statusVariant: Record<ExpenseStatus, 'secondary' | 'success' | 'destructive'> = {
  needs_review: 'secondary', booked: 'success', voided: 'destructive',
};

const statusLabel: Record<ExpenseStatus, string> = {
  needs_review: 'Needs review', booked: 'Booked', voided: 'Voided',
};

function filterExpenses(expenses: Expense[], filters: ExpenseFilterState): Expense[] {
  const query = filters.query.trim().toLocaleLowerCase();
  return expenses
    .filter((expense) => {
      const accountingDate = accountingDateForExpense(expense);
      const searchable = [expense.vendor, expense.vendorInvoiceNumber, expense.description, expense.notes, expense.category, expense.source]
        .filter(Boolean).join(' ').toLocaleLowerCase();
      return (filters.year === 'all' || accountingDate.slice(0, 4) === filters.year)
        && (filters.category === 'all' || expense.category === filters.category)
        && (filters.status === 'all' || expense.status === filters.status)
        && (filters.source === 'all' || expense.source === filters.source)
        && (!query || searchable.includes(query));
    })
    .sort((left, right) => {
      const difference = accountingDateForExpense(left).localeCompare(accountingDateForExpense(right));
      return filters.sort === 'date-asc' ? difference : -difference;
    });
}

export function ExpenseTable({ expenses, filters }: { expenses: Expense[]; filters: ExpenseFilterState }) {
  const filteredExpenses = filterExpenses(expenses, filters);
  const filteredBookedTotal = filteredExpenses
    .filter((expense) => expense.status === 'booked')
    .reduce((total, expense) => total + expense.grossAmount, 0);

  if (filteredExpenses.length === 0) {
    return <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">No expenses match these filters.</p>;
  }

  return (
    <Card className="overflow-hidden rounded-lg">
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Vendor</TableHead><TableHead>Accounting date</TableHead><TableHead>Category</TableHead><TableHead>Source</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Net</TableHead><TableHead className="text-right">VAT</TableHead><TableHead className="text-right">Gross amount</TableHead><TableHead><span className="sr-only">Open</span></TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {filteredExpenses.map((expense) => (
                <TableRow key={expense.id}>
                  <TableCell className="font-medium"><Link to={`/expenses/${expense.id}/edit`} className="hover:underline">{expense.vendor}</Link>{expense.vendorInvoiceNumber && <p className="mt-0.5 text-xs text-muted-foreground">{expense.vendorInvoiceNumber}</p>}</TableCell>
                  <TableCell>{formatDate(accountingDateForExpense(expense))}</TableCell>
                  <TableCell className="capitalize">{expense.category.replace(/_/g, ' ')}</TableCell>
                  <TableCell className="capitalize">{expense.source}</TableCell>
                  <TableCell><Badge variant={statusVariant[expense.status]} className="rounded-md">{statusLabel[expense.status]}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(expense.netAmount)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(expense.vatAmount)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatCurrency(expense.grossAmount)}</TableCell>
                  <TableCell><Link aria-label={`Open ${expense.vendor}`} to={`/expenses/${expense.id}/edit`}><ArrowRight className="h-4 w-4 text-muted-foreground" /></Link></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/30 px-4 py-3 text-sm">
          <span className="text-muted-foreground">Filtered booked expenses only (gross EUR)</span>
          <span className="font-semibold tabular-nums">{formatCurrency(filteredBookedTotal)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
