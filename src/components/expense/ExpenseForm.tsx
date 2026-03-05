import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useExpenses } from '@/hooks/useExpenses';
import {
  Expense,
  ExpenseCategory,
  expenseCategoryOptions,
} from '@/types/invoice';
import { toISODate, parseDate } from '@/lib/formatting';
import { toast } from '@/hooks/use-toast';
import { Save, Paperclip, X } from 'lucide-react';

const MAX_RECEIPT_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

interface ExpenseFormProps {
  existingExpense?: Expense;
  mode: 'create' | 'edit';
}

export function ExpenseForm({ existingExpense, mode }: ExpenseFormProps) {
  const navigate = useNavigate();
  const { addExpense, updateExpense } = useExpenses();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(existingExpense?.name ?? '');
  const [vendor, setVendor] = useState(existingExpense?.vendor ?? '');
  const [category, setCategory] = useState<ExpenseCategory>(
    existingExpense?.category ?? 'other'
  );
  const [amount, setAmount] = useState(
    existingExpense ? existingExpense.amount.toString() : ''
  );
  const [date, setDate] = useState<Date | undefined>(
    existingExpense?.date ? parseDate(existingExpense.date) : new Date()
  );
  const [description, setDescription] = useState(existingExpense?.description ?? '');
  const [isRecurring, setIsRecurring] = useState(existingExpense?.isRecurring ?? false);
  const [recurringInterval, setRecurringInterval] = useState<'monthly' | 'yearly'>(
    existingExpense?.recurringInterval ?? 'monthly'
  );
  const [receiptDataUrl, setReceiptDataUrl] = useState<string | undefined>(
    existingExpense?.receiptDataUrl
  );
  const [receiptFileName, setReceiptFileName] = useState<string | undefined>(
    existingExpense?.receiptFileName
  );

  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = 'Name is required';
    if (!vendor.trim()) newErrors.vendor = 'Vendor is required';
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      newErrors.amount = 'A valid amount is required';
    }
    if (!date) newErrors.date = 'Date is required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Limit file size to 2MB to stay within localStorage limits
    if (file.size > MAX_RECEIPT_FILE_SIZE_BYTES) {
      toast({
        title: 'File too large',
        description: 'Receipt file must be smaller than 2 MB.',
        variant: 'destructive',
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setReceiptDataUrl(reader.result as string);
      setReceiptFileName(file.name);
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveReceipt = () => {
    setReceiptDataUrl(undefined);
    setReceiptFileName(undefined);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSave = () => {
    if (!validate()) return;

    const now = new Date().toISOString();
    const expense: Expense = {
      id: existingExpense?.id ?? crypto.randomUUID(),
      name: name.trim(),
      vendor: vendor.trim(),
      category,
      amount: parseFloat(parseFloat(amount).toFixed(2)),
      date: toISODate(date!),
      description: description.trim() || undefined,
      receiptDataUrl,
      receiptFileName,
      isRecurring,
      recurringInterval: isRecurring ? recurringInterval : undefined,
      createdAt: existingExpense?.createdAt ?? now,
      updatedAt: now,
    };

    if (mode === 'create') {
      addExpense(expense);
      toast({ title: 'Success', description: 'Expense added' });
    } else {
      updateExpense(expense);
      toast({ title: 'Success', description: 'Expense updated' });
    }

    navigate('/expenses');
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-8">
      {/* Basic Info */}
      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="text-lg">Expense Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., GitHub Copilot"
              />
              {errors.name && <p className="text-xs text-destructive mt-1">{errors.name}</p>}
            </div>
            <div>
              <Label htmlFor="vendor">Vendor *</Label>
              <Input
                id="vendor"
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                placeholder="e.g., GitHub"
              />
              {errors.vendor && <p className="text-xs text-destructive mt-1">{errors.vendor}</p>}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="category">Category</Label>
              <Select
                value={category}
                onValueChange={(v) => setCategory(v as ExpenseCategory)}
              >
                <SelectTrigger id="category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {expenseCategoryOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="amount">Amount (EUR) *</Label>
              <Input
                id="amount"
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
              {errors.amount && <p className="text-xs text-destructive mt-1">{errors.amount}</p>}
            </div>
          </div>

          <div>
            <Label>Date *</Label>
            <DatePicker date={date} onSelect={setDate} placeholder="Select date" />
            {errors.date && <p className="text-xs text-destructive mt-1">{errors.date}</p>}
          </div>

          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional notes about this expense..."
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      {/* Recurring */}
      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="text-lg">Recurring</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Recurring expense</p>
              <p className="text-xs text-muted-foreground">
                Mark this expense as a recurring subscription or service.
              </p>
            </div>
            <Switch checked={isRecurring} onCheckedChange={setIsRecurring} />
          </div>

          {isRecurring && (
            <div>
              <Label htmlFor="recurringInterval">Billing Interval</Label>
              <Select
                value={recurringInterval}
                onValueChange={(v) => setRecurringInterval(v as 'monthly' | 'yearly')}
              >
                <SelectTrigger id="recurringInterval">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="yearly">Yearly</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Receipt Upload */}
      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="text-lg">Receipt</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {receiptDataUrl ? (
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="flex items-center gap-2 text-sm">
                <Paperclip className="h-4 w-4 text-muted-foreground" />
                <span className="truncate max-w-[280px]">{receiptFileName}</span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" asChild>
                  <a href={receiptDataUrl} target="_blank" rel="noopener noreferrer">
                    View
                  </a>
                </Button>
                <Button variant="ghost" size="icon" onClick={handleRemoveReceipt}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                onChange={handleFileChange}
              />
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="h-4 w-4" />
                Attach Receipt
              </Button>
              <p className="text-xs text-muted-foreground mt-2">
                Accepted: images or PDF, max 2 MB.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={() => navigate('/expenses')}>
          Cancel
        </Button>
        <Button onClick={handleSave}>
          <Save className="h-4 w-4" />
          {mode === 'create' ? 'Add Expense' : 'Save Changes'}
        </Button>
      </div>
    </div>
  );
}
