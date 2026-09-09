import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Expense, ExpenseCategory, ExpenseInput, ExpenseStatus, expenseCategories } from '@/types/finance';
import { AlertTriangle, FileUp, LockKeyhole } from 'lucide-react';

const categoryLabels: Record<ExpenseCategory, string> = {
  software: 'Software',
  equipment: 'Equipment',
  office: 'Office',
  travel: 'Travel',
  professional_services: 'Professional services',
  marketing: 'Marketing',
  telecommunications: 'Telecommunications',
  insurance: 'Insurance',
  training: 'Training',
  other: 'Other',
};

const expenseSchema = z.object({
  vendor: z.string().trim().min(1, 'Enter the vendor.'),
  vendorInvoiceNumber: z.string(),
  category: z.enum(expenseCategories),
  description: z.string(),
  expenseDate: z.string().min(1, 'Enter the document date.'),
  paidDate: z.string(),
  netAmount: z.coerce.number().finite('Enter a valid net amount.').min(0, 'Net amount cannot be negative.'),
  vatAmount: z.coerce.number().finite('Enter a valid VAT amount.').min(0, 'VAT cannot be negative.'),
  grossAmount: z.coerce.number().finite('Enter a valid gross amount.').min(0, 'Gross cannot be negative.'),
  notes: z.string(),
});

type ExpenseFormValues = z.infer<typeof expenseSchema>;

export interface ExpenseFormProps {
  expense?: Expense;
  initialStatus?: ExpenseStatus;
  onSave: (input: ExpenseInput, receipt?: File) => Promise<void> | void;
  busy?: boolean;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function toDefaults(expense?: Expense): ExpenseFormValues {
  return {
    vendor: expense?.vendor ?? '',
    vendorInvoiceNumber: expense?.vendorInvoiceNumber ?? '',
    category: expense?.category ?? 'other',
    description: expense?.description ?? '',
    expenseDate: expense?.expenseDate ?? today(),
    paidDate: expense?.paidDate ?? '',
    netAmount: expense?.netAmount ?? 0,
    vatAmount: expense?.vatAmount ?? 0,
    grossAmount: expense?.grossAmount ?? 0,
    notes: expense?.notes ?? '',
  };
}

export function ExpenseForm({ expense, initialStatus = 'needs_review', onSave, busy = false }: ExpenseFormProps) {
  const [receipt, setReceipt] = useState<File>();
  const [submitError, setSubmitError] = useState<string>();
  const [confirmed, setConfirmed] = useState(false);
  const gmail = expense?.source === 'gmail';
  const immutable = expense?.status === 'booked' || expense?.status === 'voided';
  const existingDocumentCount = expense?.documents.length ?? 0;
  const form = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseSchema),
    defaultValues: toDefaults(expense),
    mode: 'onChange',
  });
  const values = { ...toDefaults(expense), ...useWatch({ control: form.control }) } as ExpenseFormValues;
  const netAmount = values.netAmount || 0;
  const vatAmount = values.vatAmount || 0;
  const grossAmount = Number(netAmount) + Number(vatAmount);
  const missingFields = [
    !values.vendor.trim() ? 'vendor' : null,
    !values.category ? 'category' : null,
    !values.expenseDate ? 'document date' : null,
    Number(values.netAmount) < 0 || Number.isNaN(Number(values.netAmount)) ? 'net amount' : null,
    Number(values.vatAmount) < 0 || Number.isNaN(Number(values.vatAmount)) ? 'VAT amount' : null,
    !receipt && !existingDocumentCount ? 'receipt' : null,
    gmail && !values.vendorInvoiceNumber.trim() ? 'invoice or receipt number' : null,
    gmail && !values.paidDate ? 'paid date' : null,
    gmail && !confirmed ? 'confirmation of document fields' : null,
    gmail && Number(values.grossAmount) <= 0 ? 'gross amount' : null,
    Math.abs(Math.round(Number(values.netAmount) * 100) + Math.round(Number(values.vatAmount) * 100) - Math.round(Number(values.grossAmount) * 100)) > 1 ? 'matching net + VAT = gross (within €0.01)' : null,
  ].filter(Boolean) as string[];

  const submit = async (status: Extract<ExpenseStatus, 'needs_review' | 'booked'>) => {
    setSubmitError(undefined);
    const valid = await form.trigger();
    if (!valid) return;
    if (status === 'booked' && missingFields.length) {
      setSubmitError(`Book expense after adding: ${missingFields.join(', ')}.`);
      return;
    }
    if (status === 'needs_review' && missingFields.length) {
      setSubmitError(`Saved for review. Add ${missingFields.join(', ')} before booking this expense.`);
    }

    const values = form.getValues();
    const input: ExpenseInput = {
        ...values,
        vendor: values.vendor.trim(),
        vendorInvoiceNumber: values.vendorInvoiceNumber.trim() || undefined,
        description: values.description.trim() || undefined,
        paidDate: values.paidDate || undefined,
        netAmount: Number(values.netAmount),
        vatAmount: Number(values.vatAmount),
        grossAmount: Number(values.grossAmount),
        ...(gmail ? { gmailReviewConfirmed: confirmed } : {}),
        notes: values.notes.trim() || undefined,
        currency: 'EUR',
        status,
      };
    if (receipt) {
      await onSave(input, receipt);
    } else {
      await onSave(input);
    }
  };

  if (immutable) {
    return (
      <Alert>
        <LockKeyhole className="h-4 w-4" />
        <AlertTitle>This expense is read-only</AlertTitle>
        <AlertDescription>
          {expense.status === 'booked' ? 'Booked expenses are locked for tax records.' : 'Voided expenses cannot be changed.'}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form className="space-y-6" onSubmit={(event) => event.preventDefault()} noValidate>
      <section className="rounded-lg border bg-card p-5 sm:p-6">
        <div className="mb-5">
          <h1 className="text-xl font-semibold tracking-tight">{expense ? 'Review expense' : 'Add an expense'}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{initialStatus === 'needs_review' ? 'Store each cost in EUR with its supporting receipt.' : 'Check each amount before booking this expense.'}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="vendor">Vendor</Label>
            <Input id="vendor" {...form.register('vendor')} aria-invalid={Boolean(form.formState.errors.vendor)} />
            {form.formState.errors.vendor && <p className="mt-1 text-sm text-destructive">{form.formState.errors.vendor.message}</p>}
          </div>
          <div>
            <Label htmlFor="category">Category</Label>
            <select id="category" className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" {...form.register('category')}>
              {expenseCategories.map((category) => <option key={category} value={category}>{categoryLabels[category]}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="vendorInvoiceNumber">Invoice or receipt number</Label>
            <Input id="vendorInvoiceNumber" {...form.register('vendorInvoiceNumber')} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="description">Description</Label>
            <Input id="description" placeholder="What was this for?" {...form.register('description')} />
          </div>
          <div>
            <Label htmlFor="expenseDate">Document date</Label>
            <Input id="expenseDate" type="date" {...form.register('expenseDate')} aria-invalid={Boolean(form.formState.errors.expenseDate)} />
          </div>
          <div>
            <Label htmlFor="paidDate">Paid date</Label>
            <Input id="paidDate" type="date" {...form.register('paidDate')} />
          </div>
          <div>
            <Label htmlFor="netAmount">Net amount (EUR)</Label>
            <Input id="netAmount" type="number" min="0" step="0.01" inputMode="decimal" {...form.register('netAmount')} />
          </div>
          <div>
            <Label htmlFor="vatAmount">VAT amount (EUR)</Label>
            <Input id="vatAmount" type="number" min="0" step="0.01" inputMode="decimal" {...form.register('vatAmount')} />
          </div>
          <div className="sm:col-span-2 rounded-lg bg-muted px-4 py-3">
            <Label htmlFor="grossAmount">Gross amount (EUR)</Label>
            <Input id="grossAmount" type="number" min="0" step="0.01" inputMode="decimal" {...form.register('grossAmount')} />
            <p className="mt-2 text-sm text-muted-foreground">Net + VAT: <output className="font-semibold tabular-nums">€{grossAmount.toFixed(2)}</output>. Enter the document's gross total; it must match within €0.01.</p>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" rows={3} {...form.register('notes')} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="receipt">Receipt or invoice</Label>
            <Input id="receipt" type="file" accept="application/pdf,image/jpeg,image/png" onChange={(event) => setReceipt(event.target.files?.[0])} />
            <p className="mt-1 text-sm text-muted-foreground">
              {receipt ? receipt.name : existingDocumentCount ? `${existingDocumentCount} document${existingDocumentCount === 1 ? '' : 's'} attached` : 'PDF, JPEG, or PNG; up to 15 MB.'}
            </p>
          </div>
        </div>
      </section>

      {gmail && <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I confirmed the vendor, invoice number, document date, paid date, category, net, VAT and gross against these documents.</label>}
      {missingFields.length > 0 && <p className="text-sm text-muted-foreground">Before booking, add: {missingFields.join(', ')}.</p>}

      {(submitError || (form.formState.isSubmitted && missingFields.length > 0)) && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Review what is missing</AlertTitle>
          <AlertDescription>{submitError ?? `Add ${missingFields.join(', ')} before booking this expense.`}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap justify-end gap-3 border-t pt-5">
        <Button type="button" variant="outline" onClick={() => void submit('needs_review')} disabled={busy}>
          <FileUp /> Save for review
        </Button>
        <Button type="button" onClick={() => void submit('booked')} disabled={busy || missingFields.length > 0}>
          {busy ? 'Saving…' : 'Book expense'}
        </Button>
      </div>
    </form>
  );
}
