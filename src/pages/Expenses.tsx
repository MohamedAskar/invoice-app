import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useExpenses } from '@/hooks/useExpenses';
import { Expense, ExpenseCategory, expenseCategoryLabels } from '@/types/invoice';
import { formatCurrency, formatDate } from '@/lib/formatting';
import { toast } from '@/hooks/use-toast';
import {
  Plus,
  Pencil,
  Trash2,
  Search,
  Receipt,
  Upload,
  X,
  FileBarChart,
  Paperclip,
  Download,
} from 'lucide-react';

const categories = Object.entries(expenseCategoryLabels) as [ExpenseCategory, string][];

interface ExpenseFormData {
  description: string;
  category: ExpenseCategory;
  amount: string;
  date: string;
  recurring: boolean;
  recurrenceInterval: 'monthly' | 'quarterly' | 'yearly';
  attachmentName: string;
  attachmentData: string;
  notes: string;
}

const emptyFormData: ExpenseFormData = {
  description: '',
  category: 'subscriptions',
  amount: '',
  date: new Date().toISOString().split('T')[0],
  recurring: false,
  recurrenceInterval: 'monthly',
  attachmentName: '',
  attachmentData: '',
  notes: '',
};

export function Expenses() {
  const { expenses, loadExpenses, addExpense, updateExpense, deleteExpense } = useExpenses();
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [expenseToDelete, setExpenseToDelete] = useState<Expense | null>(null);
  const [formData, setFormData] = useState<ExpenseFormData>(emptyFormData);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
          expense.description.toLowerCase().includes(query) ||
          expenseCategoryLabels[expense.category].toLowerCase().includes(query) ||
          expense.notes?.toLowerCase().includes(query)
        );
      }
      return true;
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const totalExpenses = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);

  const handleOpenDialog = (expense?: Expense) => {
    if (expense) {
      setEditingExpense(expense);
      setFormData({
        description: expense.description,
        category: expense.category,
        amount: expense.amount.toString(),
        date: expense.date,
        recurring: expense.recurring,
        recurrenceInterval: expense.recurrenceInterval || 'monthly',
        attachmentName: expense.attachmentName || '',
        attachmentData: expense.attachmentData || '',
        notes: expense.notes || '',
      });
    } else {
      setEditingExpense(null);
      setFormData(emptyFormData);
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingExpense(null);
    setFormData(emptyFormData);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Limit to 5MB
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: 'Error',
        description: 'File size must be less than 5MB',
        variant: 'destructive',
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setFormData({
        ...formData,
        attachmentName: file.name,
        attachmentData: result,
      });
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveAttachment = () => {
    setFormData({
      ...formData,
      attachmentName: '',
      attachmentData: '',
    });
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDownloadAttachment = (expense: Expense) => {
    if (!expense.attachmentData || !expense.attachmentName) return;

    const link = document.createElement('a');
    link.href = expense.attachmentData;
    link.download = expense.attachmentName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSave = () => {
    if (!formData.description.trim()) {
      toast({ title: 'Error', description: 'Description is required', variant: 'destructive' });
      return;
    }

    const amount = parseFloat(formData.amount);
    if (isNaN(amount) || amount <= 0) {
      toast({ title: 'Error', description: 'Please enter a valid amount', variant: 'destructive' });
      return;
    }

    if (!formData.date) {
      toast({ title: 'Error', description: 'Date is required', variant: 'destructive' });
      return;
    }

    const now = new Date().toISOString();

    if (editingExpense) {
      updateExpense({
        ...editingExpense,
        description: formData.description,
        category: formData.category,
        amount,
        date: formData.date,
        recurring: formData.recurring,
        recurrenceInterval: formData.recurring ? formData.recurrenceInterval : undefined,
        attachmentName: formData.attachmentName || undefined,
        attachmentData: formData.attachmentData || undefined,
        notes: formData.notes || undefined,
        updatedAt: now,
      });
      toast({ title: 'Success', description: 'Expense updated successfully' });
    } else {
      addExpense({
        id: crypto.randomUUID(),
        description: formData.description,
        category: formData.category,
        amount,
        date: formData.date,
        recurring: formData.recurring,
        recurrenceInterval: formData.recurring ? formData.recurrenceInterval : undefined,
        attachmentName: formData.attachmentName || undefined,
        attachmentData: formData.attachmentData || undefined,
        notes: formData.notes || undefined,
        createdAt: now,
        updatedAt: now,
      });
      toast({ title: 'Success', description: 'Expense added successfully' });
    }

    handleCloseDialog();
  };

  const handleDeleteClick = (expense: Expense) => {
    setExpenseToDelete(expense);
    setIsDeleteDialogOpen(true);
  };

  const handleConfirmDelete = () => {
    if (expenseToDelete) {
      deleteExpense(expenseToDelete.id);
      toast({ title: 'Success', description: 'Expense deleted successfully' });
    }
    setIsDeleteDialogOpen(false);
    setExpenseToDelete(null);
  };

  return (
    <div className="space-y-6">
      {/* Header Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4 flex-1">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search expenses..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 rounded-lg"
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild className="rounded-lg">
            <Link to="/expenses/report">
              <FileBarChart className="h-4 w-4" />
              Generate Report
            </Link>
          </Button>
          <Button onClick={() => handleOpenDialog()} className="rounded-lg">
            <Plus className="h-4 w-4" />
            Add Expense
          </Button>
        </div>
      </div>

      {/* Expenses Table */}
      {filteredExpenses.length === 0 ? (
        <Card className="rounded-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <Receipt className="h-8 w-8 text-muted-foreground" />
            </div>
            <CardTitle className="mb-2">No expenses yet</CardTitle>
            <CardDescription className="text-center mb-4">
              {searchQuery || categoryFilter !== 'all'
                ? 'No expenses match your search criteria.'
                : 'Add your first expense to start tracking.'}
            </CardDescription>
            {!searchQuery && categoryFilter === 'all' && (
              <Button onClick={() => handleOpenDialog()} className="rounded-lg">
                <Plus className="h-4 w-4" />
                Add Expense
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle>All Expenses</CardTitle>
            <CardDescription>
              {filteredExpenses.length} expense{filteredExpenses.length !== 1 ? 's' : ''} · Total: {formatCurrency(totalExpenses)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Recurring</TableHead>
                  <TableHead>Attachment</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredExpenses.map((expense) => (
                  <TableRow key={expense.id}>
                    <TableCell className="font-medium">
                      {expense.description}
                      {expense.notes && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[200px]">
                          {expense.notes}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="rounded-md">
                        {expenseCategoryLabels[expense.category]}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatDate(expense.date)}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(expense.amount)}
                    </TableCell>
                    <TableCell>
                      {expense.recurring ? (
                        <Badge variant="default" className="rounded-md">
                          {expense.recurrenceInterval}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {expense.attachmentName ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDownloadAttachment(expense)}
                          className="h-8 gap-1 text-xs"
                        >
                          <Download className="h-3 w-3" />
                          {expense.attachmentName.length > 15
                            ? expense.attachmentName.substring(0, 15) + '...'
                            : expense.attachmentName}
                        </Button>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenDialog(expense)}
                          className="h-8 w-8"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteClick(expense)}
                          className="h-8 w-8 text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="rounded-lg sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              {editingExpense ? 'Edit Expense' : 'Add New Expense'}
            </DialogTitle>
            <DialogDescription>
              {editingExpense
                ? 'Update the expense details below.'
                : 'Enter the expense details below.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="description">Description *</Label>
              <Input
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="e.g. Adobe Creative Cloud"
                className="rounded-lg"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="category">Category</Label>
                <Select
                  value={formData.category}
                  onValueChange={(value: ExpenseCategory) =>
                    setFormData({ ...formData, category: value })
                  }
                >
                  <SelectTrigger className="rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="amount">Amount (€) *</Label>
                <Input
                  id="amount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  placeholder="0.00"
                  className="rounded-lg"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="date">Date *</Label>
              <Input
                id="date"
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                className="rounded-lg"
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <Label htmlFor="recurring" className="font-medium">Recurring Expense</Label>
                <p className="text-sm text-muted-foreground">
                  Mark if this is a recurring expense
                </p>
              </div>
              <Switch
                id="recurring"
                checked={formData.recurring}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, recurring: checked })
                }
              />
            </div>
            {formData.recurring && (
              <div>
                <Label htmlFor="recurrenceInterval">Recurrence Interval</Label>
                <Select
                  value={formData.recurrenceInterval}
                  onValueChange={(value: 'monthly' | 'quarterly' | 'yearly') =>
                    setFormData({ ...formData, recurrenceInterval: value })
                  }
                >
                  <SelectTrigger className="rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="quarterly">Quarterly</SelectItem>
                    <SelectItem value="yearly">Yearly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>Invoice / Receipt</Label>
              {formData.attachmentName ? (
                <div className="mt-1 flex items-center gap-2 rounded-lg border p-3">
                  <Paperclip className="h-4 w-4 text-muted-foreground" />
                  <span className="flex-1 text-sm truncate">{formData.attachmentName}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={handleRemoveAttachment}
                    className="h-8 w-8"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div
                  className="mt-1 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 hover:bg-secondary/50 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-6 w-6 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Click to upload invoice or receipt
                  </p>
                  <p className="text-xs text-muted-foreground">PDF, PNG, JPG up to 5MB</p>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg"
                onChange={handleFileUpload}
                className="hidden"
              />
            </div>
            <div>
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Additional notes about this expense"
                className="rounded-lg"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCloseDialog} className="rounded-lg">
              Cancel
            </Button>
            <Button onClick={handleSave} className="rounded-lg">
              {editingExpense ? 'Save Changes' : 'Add Expense'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent className="rounded-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Expense?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{expenseToDelete?.description}&quot;? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-lg">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
