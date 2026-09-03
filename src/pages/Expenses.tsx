import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardTitle } from '@/components/ui/card';
import { useExpenses } from '@/hooks/useExpenses';
import { formatCurrency, formatDate } from '@/lib/formatting';
import { Expense, ExpenseStatus } from '@/types/finance';
import { AlertTriangle, ArrowRight, Plus, ReceiptText } from 'lucide-react';

const statusVariant: Record<ExpenseStatus, 'secondary' | 'success' | 'destructive'> = {
  needs_review: 'secondary',
  booked: 'success',
  voided: 'destructive',
};

const statusLabel: Record<ExpenseStatus, string> = {
  needs_review: 'Needs review',
  booked: 'Booked',
  voided: 'Voided',
};

function ExpenseRows({ expenses }: { expenses: Expense[] }) {
  return (
    <div className="divide-y rounded-lg border">
      {expenses.map((expense) => (
        <Link key={expense.id} to={`/expenses/${expense.id}/edit`} className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-4 transition-colors hover:bg-muted/50">
          <div className="min-w-44 flex-1">
            <p className="font-medium">{expense.vendor}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{expense.category.replace('_', ' ')} · {formatDate(expense.expenseDate)}</p>
          </div>
          <div className="text-right">
            <p className="font-medium tabular-nums">{formatCurrency(expense.grossAmount)}</p>
            <p className="text-xs text-muted-foreground">{expense.documents.length} document{expense.documents.length === 1 ? '' : 's'}</p>
          </div>
          <Badge variant={statusVariant[expense.status]} className="rounded-md">{statusLabel[expense.status]}</Badge>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
        </Link>
      ))}
    </div>
  );
}

export function Expenses() {
  const expenses = useExpenses((state) => state.expenses);
  const loading = useExpenses((state) => state.loading);
  const error = useExpenses((state) => state.error);
  const loadExpenses = useExpenses((state) => state.loadExpenses);

  useEffect(() => { void loadExpenses().catch(() => undefined); }, [loadExpenses]);

  const reviewExpenses = expenses.filter((expense) => expense.status === 'needs_review');
  const bookedExpenses = expenses.filter((expense) => expense.status === 'booked');

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b pb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Expenses</h1>
          <p className="mt-1 text-sm text-muted-foreground">Review receipts before they become part of your tax records.</p>
        </div>
        <Button asChild><Link to="/expenses/new"><Plus /> Add receipt</Link></Button>
      </div>

      {error && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Could not load expenses</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
      {loading ? <p className="py-12 text-sm text-muted-foreground">Loading expenses…</p> : expenses.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-muted"><ReceiptText className="h-6 w-6 text-muted-foreground" /></div>
            <CardTitle>No receipts to review</CardTitle>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">Add a receipt now, then check the amounts before booking it.</p>
            <Button asChild className="mt-5"><Link to="/expenses/new"><Plus /> Add receipt</Link></Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <section>
            <div className="mb-3 flex items-baseline justify-between"><h2 className="text-lg font-semibold">Needs review</h2><span className="text-sm text-muted-foreground">{reviewExpenses.length}</span></div>
            {reviewExpenses.length ? <ExpenseRows expenses={reviewExpenses} /> : <p className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">All caught up — no receipts are waiting for review.</p>}
          </section>
          <section>
            <div className="mb-3 flex items-baseline justify-between"><h2 className="text-lg font-semibold">Booked</h2><span className="text-sm text-muted-foreground">{bookedExpenses.length}</span></div>
            {bookedExpenses.length ? <ExpenseRows expenses={bookedExpenses} /> : <p className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">Booked expenses will stay here as a read-only record.</p>}
          </section>
        </>
      )}
    </div>
  );
}
