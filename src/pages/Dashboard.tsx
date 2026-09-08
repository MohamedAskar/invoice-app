import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle, Eye, FileText, MoreHorizontal, Pencil, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FinanceSummary } from '@/components/dashboard/FinanceSummary';
import { IncomeExpenseChart } from '@/components/dashboard/IncomeExpenseChart';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useExpenses } from '@/hooks/useExpenses';
import { useFinanceDashboard } from '@/hooks/useFinanceDashboard';
import { useInvoices } from '@/hooks/useInvoices';
import { formatCurrency, formatDate } from '@/lib/formatting';
import { InvoiceStatus } from '@/types/invoice';

const statusVariants: Record<InvoiceStatus, 'default' | 'secondary' | 'success' | 'warning' | 'destructive'> = {
  draft: 'secondary', pending: 'warning', paid: 'success', overdue: 'destructive',
};

const statusLabels: Record<InvoiceStatus, string> = {
  draft: 'Draft', pending: 'Pending', paid: 'Paid', overdue: 'Overdue',
};

function availableYears(invoiceDates: string[], expenseDates: string[], currentYear: number): number[] {
  return [...new Set([...invoiceDates, ...expenseDates].filter(Boolean).map((date) => Number(date.slice(0, 4))).filter(Number.isInteger).concat(currentYear))]
    .sort((a, b) => b - a);
}

export function Dashboard() {
  const { invoices, loadInvoices, markAsPaid, updateStatuses } = useInvoices();
  const expenses = useExpenses((state) => state.expenses);
  const loadExpenses = useExpenses((state) => state.loadExpenses);
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);

  useEffect(() => {
    void Promise.all([loadInvoices().then(updateStatuses), loadExpenses()]).catch(() => undefined);
  }, [loadExpenses, loadInvoices, updateStatuses]);

  const data = useFinanceDashboard(invoices, expenses, year);
  const years = useMemo(() => availableYears(
    invoices.flatMap((invoice) => [invoice.date, invoice.paidDate ?? '']),
    expenses.map((expense) => expense.paidDate ?? expense.expenseDate),
    currentYear,
  ), [currentYear, expenses, invoices]);
  const recentInvoices = [...invoices].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 5);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b pb-6">
        <div><h1 className="text-2xl font-semibold tracking-tight">Finance overview</h1><p className="mt-1 text-sm text-muted-foreground">A EUR Kleinunternehmer overview using gross booked expenses.</p></div>
        <div className="w-full sm:w-40"><label htmlFor="dashboard-year" className="mb-1.5 block text-sm font-medium">Year</label><Select value={String(year)} onValueChange={(value) => setYear(Number(value))}><SelectTrigger id="dashboard-year" className="rounded-lg"><SelectValue /></SelectTrigger><SelectContent className="rounded-lg">{years.map((option) => <SelectItem key={option} value={String(option)}>{option}</SelectItem>)}</SelectContent></Select></div>
      </div>
      <FinanceSummary data={data} />
      <IncomeExpenseChart months={data.months} />
      <Card className="rounded-lg">
        <CardHeader className="flex flex-row items-center justify-between"><CardTitle className="text-lg font-semibold">Recent invoices</CardTitle>{invoices.length > 0 && <Button variant="ghost" size="sm" asChild><Link to="/invoices">View all</Link></Button>}</CardHeader>
        <CardContent>
          {recentInvoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16"><div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted"><FileText className="h-8 w-8 text-muted-foreground" /></div><CardTitle className="mb-2">No invoices yet</CardTitle><CardDescription className="mb-4 text-center">Create your first invoice to get started.</CardDescription><Button asChild className="rounded-lg"><Link to="/invoices/new"><Plus className="h-4 w-4" />Create invoice</Link></Button></div>
          ) : (
            <Table><TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Client</TableHead><TableHead>Date</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{recentInvoices.map((invoice) => <TableRow key={invoice.id}><TableCell className="font-medium">{invoice.invoiceNumber}</TableCell><TableCell>{invoice.client.name}</TableCell><TableCell>{formatDate(invoice.date)}</TableCell><TableCell>{formatCurrency(invoice.total)}</TableCell><TableCell><Badge variant={statusVariants[invoice.status]} className="rounded-md">{statusLabels[invoice.status]}</Badge></TableCell><TableCell className="text-right"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="rounded-lg"><MoreHorizontal className="h-4 w-4" /><span className="sr-only">Actions</span></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="rounded-lg"><DropdownMenuItem asChild><Link to={`/invoices/${invoice.id}`}><Eye className="h-4 w-4" />View</Link></DropdownMenuItem><DropdownMenuItem asChild><Link to={`/invoices/${invoice.id}/edit`}><Pencil className="h-4 w-4" />Edit</Link></DropdownMenuItem>{invoice.status !== 'paid' && invoice.status !== 'draft' && <DropdownMenuItem onClick={() => markAsPaid(invoice.id)}><CheckCircle className="h-4 w-4" />Mark as paid</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu></TableCell></TableRow>)}</TableBody></Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
