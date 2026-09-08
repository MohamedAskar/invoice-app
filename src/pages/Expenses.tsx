import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Plus, ReceiptText } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardTitle } from '@/components/ui/card';
import { ExpenseFilters, ExpenseFilterState } from '@/components/expenses/ExpenseFilters';
import { ExpenseTable } from '@/components/expenses/ExpenseTable';
import { useExpenses } from '@/hooks/useExpenses';
import { accountingDateForExpense } from '@/lib/finance-calculations';

const initialFilters: ExpenseFilterState = { year: 'all', category: 'all', status: 'all', source: 'all', query: '', sort: 'date-desc' };

export function Expenses() {
  const expenses = useExpenses((state) => state.expenses);
  const loading = useExpenses((state) => state.loading);
  const error = useExpenses((state) => state.error);
  const loadExpenses = useExpenses((state) => state.loadExpenses);
  const [filters, setFilters] = useState(initialFilters);
  useEffect(() => { void loadExpenses().catch(() => undefined); }, [loadExpenses]);
  const years = useMemo(() => [...new Set(expenses.map((expense) => accountingDateForExpense(expense).slice(0, 4)))].filter(Boolean).map(Number).sort((a, b) => b - a), [expenses]);

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b pb-6"><div><h1 className="text-2xl font-semibold tracking-tight">Expenses</h1><p className="mt-1 text-sm text-muted-foreground">Review receipts before they become part of your tax records.</p></div><Button asChild><Link to="/expenses/new"><Plus />Add receipt</Link></Button></div>
      {error && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Could not load expenses</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
      {loading ? <p className="py-12 text-sm text-muted-foreground">Loading expenses…</p> : expenses.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center py-16 text-center"><div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-muted"><ReceiptText className="h-6 w-6 text-muted-foreground" /></div><CardTitle>No receipts to review</CardTitle><p className="mt-2 max-w-sm text-sm text-muted-foreground">Add a receipt now, then check the amounts before booking it.</p><Button asChild className="mt-5"><Link to="/expenses/new"><Plus />Add receipt</Link></Button></CardContent></Card>
      ) : <section className="space-y-4"><ExpenseFilters filters={filters} years={years} onChange={setFilters} /><ExpenseTable expenses={expenses} filters={filters} /></section>}
    </div>
  );
}
