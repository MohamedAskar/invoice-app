import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useExpenses } from '@/hooks/useExpenses';
import { useSettings } from '@/hooks/useSettings';
import { Expense, expenseCategoryLabels, ExpenseCategory } from '@/types/invoice';
import { formatCurrency, formatDate } from '@/lib/formatting';
import { generateExpenseReport } from '@/lib/expense-report-generator';
import { toast } from '@/hooks/use-toast';
import { ArrowLeft, Download, FileBarChart } from 'lucide-react';

export function ExpenseReport() {
  const { expenses, loadExpenses } = useExpenses();
  const { settings } = useSettings();
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => {
    return new Date().toISOString().split('T')[0];
  });

  useEffect(() => {
    loadExpenses();
  }, [loadExpenses]);

  const filteredExpenses = expenses
    .filter((expense) => {
      return expense.date >= startDate && expense.date <= endDate;
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const totalAmount = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);

  // Group by category
  const categoryTotals = filteredExpenses.reduce<Record<string, number>>((acc, expense) => {
    acc[expense.category] = (acc[expense.category] || 0) + expense.amount;
    return acc;
  }, {});

  const handleGeneratePDF = async () => {
    if (filteredExpenses.length === 0) {
      toast({
        title: 'No expenses',
        description: 'There are no expenses in the selected date range.',
        variant: 'destructive',
      });
      return;
    }

    try {
      await generateExpenseReport(filteredExpenses, settings, startDate, endDate);
      toast({ title: 'Success', description: 'Expense report downloaded' });
    } catch (error) {
      console.error('PDF generation error:', error);
      toast({
        title: 'Error',
        description: 'Failed to generate report',
        variant: 'destructive',
      });
    }
  };

  const collectAttachments = () => {
    return filteredExpenses.filter(
      (e): e is Expense & { attachmentName: string; attachmentData: string } =>
        !!e.attachmentName && !!e.attachmentData
    );
  };

  const handleDownloadAttachments = () => {
    const attachments = collectAttachments();
    if (attachments.length === 0) {
      toast({
        title: 'No attachments',
        description: 'There are no attachments in the selected date range.',
        variant: 'destructive',
      });
      return;
    }

    // Download each attachment
    attachments.forEach((expense) => {
      const link = document.createElement('a');
      link.href = expense.attachmentData;
      link.download = expense.attachmentName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });

    toast({
      title: 'Success',
      description: `${attachments.length} attachment${attachments.length !== 1 ? 's' : ''} downloaded`,
    });
  };

  const attachmentCount = collectAttachments().length;

  return (
    <div className="space-y-6">
      {/* Back button */}
      <div>
        <Button variant="ghost" size="sm" asChild className="rounded-lg">
          <Link to="/expenses">
            <ArrowLeft className="h-4 w-4" />
            Back to Expenses
          </Link>
        </Button>
      </div>

      {/* Date Range Selection */}
      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileBarChart className="h-5 w-5" />
            Expense Report
          </CardTitle>
          <CardDescription>
            Select a date range to generate your expense report.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <Label htmlFor="startDate">Start Date</Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="rounded-lg w-[180px]"
              />
            </div>
            <div>
              <Label htmlFor="endDate">End Date</Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="rounded-lg w-[180px]"
              />
            </div>
            <Button onClick={handleGeneratePDF} className="rounded-lg">
              <Download className="h-4 w-4" />
              Download Report PDF
            </Button>
            {attachmentCount > 0 && (
              <Button variant="outline" onClick={handleDownloadAttachments} className="rounded-lg">
                <Download className="h-4 w-4" />
                Download Attachments ({attachmentCount})
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      {filteredExpenses.length > 0 && (
        <div className="grid gap-6 md:grid-cols-3">
          <Card className="rounded-lg">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Expenses
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-[32px] font-black tracking-tight">
                {formatCurrency(totalAmount)}
              </div>
            </CardContent>
          </Card>
          <Card className="rounded-lg">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Number of Expenses
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-[32px] font-black tracking-tight">
                {filteredExpenses.length}
              </div>
            </CardContent>
          </Card>
          <Card className="rounded-lg">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Attachments
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-[32px] font-black tracking-tight">
                {attachmentCount}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Category Breakdown */}
      {Object.keys(categoryTotals).length > 0 && (
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle>Category Breakdown</CardTitle>
            <CardDescription>
              Expenses grouped by category for {formatDate(startDate)} – {formatDate(endDate)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">% of Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(categoryTotals)
                  .sort(([, a], [, b]) => b - a)
                  .map(([category, amount]) => (
                    <TableRow key={category}>
                      <TableCell>
                        <Badge variant="secondary" className="rounded-md">
                          {expenseCategoryLabels[category as ExpenseCategory]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(amount)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {totalAmount > 0 ? ((amount / totalAmount) * 100).toFixed(1) : 0}%
                      </TableCell>
                    </TableRow>
                  ))}
                <TableRow className="font-bold">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right">{formatCurrency(totalAmount)}</TableCell>
                  <TableCell className="text-right">100%</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Detailed List */}
      {filteredExpenses.length > 0 ? (
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle>Expense Details</CardTitle>
            <CardDescription>
              All expenses from {formatDate(startDate)} to {formatDate(endDate)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Attachment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredExpenses.map((expense) => (
                  <TableRow key={expense.id}>
                    <TableCell>{formatDate(expense.date)}</TableCell>
                    <TableCell className="font-medium">{expense.description}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="rounded-md">
                        {expenseCategoryLabels[expense.category]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(expense.amount)}
                    </TableCell>
                    <TableCell>
                      {expense.attachmentName ? (
                        <span className="text-sm text-primary">{expense.attachmentName}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <Card className="rounded-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <FileBarChart className="h-8 w-8 text-muted-foreground" />
            </div>
            <CardTitle className="mb-2">No expenses found</CardTitle>
            <CardDescription className="text-center">
              No expenses found in the selected date range.
            </CardDescription>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
