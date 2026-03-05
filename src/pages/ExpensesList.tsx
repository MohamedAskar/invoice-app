import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DatePicker } from '@/components/ui/date-picker';
import { useExpenses } from '@/hooks/useExpenses';
import { useSettings } from '@/hooks/useSettings';
import { Expense, ExpenseCategory, expenseCategoryLabels, expenseCategoryOptions } from '@/types/invoice';
import { formatCurrency, formatDate, toISODate } from '@/lib/formatting';
import { generateExpenseReportPDF } from '@/lib/expense-report-pdf';
import { toast } from '@/hooks/use-toast';
import {
  Search,
  MoreHorizontal,
  Pencil,
  Trash2,
  Receipt,
  Plus,
  FileDown,
  RefreshCw,
  Paperclip,
} from 'lucide-react';

const categoryVariants: Record<
  ExpenseCategory,
  'default' | 'secondary' | 'success' | 'warning' | 'destructive'
> = {
  subscription: 'warning',
  software: 'default',
  hardware: 'secondary',
  travel: 'success',
  office: 'secondary',
  marketing: 'default',
  other: 'secondary',
};

type SortField = 'date' | 'amount' | 'name' | 'vendor';
type SortOrder = 'asc' | 'desc';

export function ExpensesList() {
  const { expenses, loadExpenses, deleteExpense } = useExpenses();
  const { settings } = useSettings();
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [expenseToDelete, setExpenseToDelete] = useState<Expense | null>(null);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [reportDateFrom, setReportDateFrom] = useState<Date | undefined>(
    new Date(new Date().getFullYear(), 0, 1)
  );
  const [reportDateTo, setReportDateTo] = useState<Date | undefined>(new Date());
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);

  useEffect(() => {
    loadExpenses();
  }, [loadExpenses]);

  const filteredExpenses = expenses
    .filter((expense) => {
      if (categoryFilter !== 'all' && expense.category !== categoryFilter) {
        return false;
      }
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          expense.name.toLowerCase().includes(query) ||
          expense.vendor.toLowerCase().includes(query)
        );
      }
      return true;
    })
    .sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'date':
          comparison = new Date(a.date).getTime() - new Date(b.date).getTime();
          break;
        case 'amount':
          comparison = a.amount - b.amount;
          break;
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'vendor':
          comparison = a.vendor.localeCompare(b.vendor);
          break;
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

  const totalAmount = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);

  const handleDeleteClick = (expense: Expense) => {
    setExpenseToDelete(expense);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = () => {
    if (expenseToDelete) {
      deleteExpense(expenseToDelete.id);
      toast({ title: 'Success', description: 'Expense deleted' });
    }
    setDeleteDialogOpen(false);
    setExpenseToDelete(null);
  };

  const handleGenerateReport = async () => {
    if (!reportDateFrom || !reportDateTo) return;
    const from = toISODate(reportDateFrom);
    const to = toISODate(reportDateTo);
    const reportExpenses = expenses.filter((e) => e.date >= from && e.date <= to);
    if (reportExpenses.length === 0) {
      toast({
        title: 'No expenses',
        description: 'No expenses found in the selected date range.',
        variant: 'destructive',
      });
      return;
    }
    setIsGeneratingReport(true);
    try {
      await generateExpenseReportPDF(reportExpenses, settings, from, to);
      toast({ title: 'Success', description: 'Expense report downloaded' });
      setReportDialogOpen(false);
    } catch (error) {
      console.error(error);
      toast({ title: 'Error', description: 'Failed to generate report', variant: 'destructive' });
    } finally {
      setIsGeneratingReport(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search expenses..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {expenseCategoryOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={`${sortField}-${sortOrder}`}
          onValueChange={(value) => {
            const [field, order] = value.split('-') as [SortField, SortOrder];
            setSortField(field);
            setSortOrder(order);
          }}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="date-desc">Date (Newest)</SelectItem>
            <SelectItem value="date-asc">Date (Oldest)</SelectItem>
            <SelectItem value="amount-desc">Amount (High)</SelectItem>
            <SelectItem value="amount-asc">Amount (Low)</SelectItem>
            <SelectItem value="name-asc">Name (A-Z)</SelectItem>
            <SelectItem value="vendor-asc">Vendor (A-Z)</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={() => setReportDialogOpen(true)}>
          <FileDown className="h-4 w-4" />
          Generate Report
        </Button>
        <Button asChild className="rounded-lg">
          <Link to="/expenses/new">
            <Plus className="h-4 w-4" />
            Add Expense
          </Link>
        </Button>
      </div>

      {/* List */}
      {filteredExpenses.length === 0 ? (
        <Card className="rounded-lg">
          <CardContent>
            <div className="flex flex-col items-center justify-center py-16">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
                <Receipt className="h-8 w-8 text-muted-foreground" />
              </div>
              <CardTitle className="mb-2">No expenses yet</CardTitle>
              <CardDescription className="text-center mb-4">
                Start tracking your business expenses.
              </CardDescription>
              <Button asChild className="rounded-lg">
                <Link to="/expenses/new">
                  <Plus className="h-4 w-4" />
                  Add Expense
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="rounded-lg">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg font-semibold">
                {filteredExpenses.length} Expense{filteredExpenses.length !== 1 ? 's' : ''}
              </CardTitle>
              <span className="text-sm font-medium text-muted-foreground">
                Total: <span className="text-foreground font-semibold">{formatCurrency(totalAmount)}</span>
              </span>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredExpenses.map((expense) => (
                  <TableRow key={expense.id}>
                    <TableCell>{formatDate(expense.date)}</TableCell>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {expense.name}
                        {expense.isRecurring && (
                          <RefreshCw className="h-3 w-3 text-muted-foreground" aria-label="Recurring" />
                        )}
                        {expense.receiptDataUrl && (
                          <Paperclip className="h-3 w-3 text-muted-foreground" aria-label="Has receipt" />
                        )}
                      </div>
                      {expense.description && (
                        <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                          {expense.description}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>{expense.vendor}</TableCell>
                    <TableCell>
                      <Badge variant={categoryVariants[expense.category]} className="rounded-md">
                        {expenseCategoryLabels[expense.category]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(expense.amount)}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">Actions</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link to={`/expenses/${expense.id}/edit`}>
                              <Pencil className="h-4 w-4" />
                              Edit
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => handleDeleteClick(expense)}
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Expense?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete &ldquo;
              {expenseToDelete?.name}&rdquo;.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Generate Report Dialog */}
      <Dialog open={reportDialogOpen} onOpenChange={setReportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate Expenses Report</DialogTitle>
            <DialogDescription>
              Select a date range to include in the report. All expenses within the range will be
              included.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">From</label>
                <DatePicker date={reportDateFrom} onSelect={setReportDateFrom} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">To</label>
                <DatePicker date={reportDateTo} onSelect={setReportDateTo} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReportDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleGenerateReport} disabled={isGeneratingReport}>
              <FileDown className="h-4 w-4" />
              {isGeneratingReport ? 'Generating...' : 'Download PDF'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
