import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ExpenseDocumentPanel } from '@/components/expenses/ExpenseDocumentPanel';
import { ExpenseForm } from '@/components/expenses/ExpenseForm';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useExpenses } from '@/hooks/useExpenses';
import { toast } from '@/hooks/use-toast';
import { ExpenseDocument, ExpenseInput } from '@/types/finance';
import { AlertTriangle, ArrowLeft, Trash2 } from 'lucide-react';

export function EditExpense() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [voidReason, setVoidReason] = useState('');
  const expenses = useExpenses((state) => state.expenses);
  const loading = useExpenses((state) => state.loading);
  const busy = useExpenses((state) => state.busy);
  const error = useExpenses((state) => state.error);
  const loadExpenses = useExpenses((state) => state.loadExpenses);
  const updateExpense = useExpenses((state) => state.updateExpense);
  const deleteDraftExpense = useExpenses((state) => state.deleteDraftExpense);
  const voidExpense = useExpenses((state) => state.voidExpense);
  const uploadDocument = useExpenses((state) => state.uploadDocument);
  const removeDocument = useExpenses((state) => state.removeDocument);
  const replaceDocument = useExpenses((state) => state.replaceDocument);
  const expense = expenses.find((candidate) => candidate.id === id);

  useEffect(() => { void loadExpenses().catch(() => undefined); }, [loadExpenses]);

  const save = async (input: ExpenseInput, receipt?: File) => {
    if (!id) return;
    try {
      await updateExpense(id, input, receipt);
      toast({ title: input.status === 'booked' ? 'Expense booked' : 'Saved for review' });
      navigate('/expenses');
    } catch (saveError) {
      toast({ title: 'Could not save expense', description: saveError instanceof Error ? saveError.message : 'Please try again.', variant: 'destructive' });
    }
  };

  const deleteExpense = async () => {
    if (!id || !window.confirm('Delete this review expense and its attached files?')) return;
    try {
      await deleteDraftExpense(id);
      toast({ title: 'Review expense deleted' });
      navigate('/expenses');
    } catch (deleteError) {
      toast({ title: 'Could not delete expense', description: deleteError instanceof Error ? deleteError.message : 'Please retry.', variant: 'destructive' });
    }
  };

  const voidRecord = async () => {
    if (!id) return;
    try {
      await voidExpense(id, voidReason);
      toast({ title: 'Expense voided' });
      navigate('/expenses');
    } catch (voidError) {
      toast({ title: 'Could not void expense', description: voidError instanceof Error ? voidError.message : 'Enter a reason and retry.', variant: 'destructive' });
    }
  };

  if (loading && !expense) return <p className="py-12 text-sm text-muted-foreground">Loading expense…</p>;
  if (!expense) return (
    <div className="space-y-4"><Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Expense not found</AlertTitle><AlertDescription>{error ?? 'It may have been deleted or is not available to this account.'}</AlertDescription></Alert><Button asChild variant="outline"><Link to="/expenses"><ArrowLeft /> Back to expenses</Link></Button></div>
  );

  const remove = async (document: ExpenseDocument) => { await removeDocument(expense.id, document); };
  const replace = async (document: ExpenseDocument, file: File) => { await replaceDocument(expense.id, document, file); };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Button asChild variant="ghost" size="sm"><Link to="/expenses"><ArrowLeft /> Back to expenses</Link></Button>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(20rem,.75fr)]">
        <ExpenseForm expense={expense} initialStatus={expense.status} onSave={save} busy={busy} />
        <ExpenseDocumentPanel expense={expense} busy={busy} onUpload={(file) => uploadDocument(expense.id, file).then(() => undefined)} onRemove={remove} onReplace={replace} />
      </div>
      {expense.status !== 'voided' && (
        <section className="rounded-lg border border-destructive/30 p-5">
          <h2 className="font-semibold">Void this expense</h2>
          <p className="mt-1 text-sm text-muted-foreground">Keep the record and explain why it should be excluded from tax records.</p>
          <div className="mt-4 flex flex-wrap gap-3"><div className="min-w-56 flex-1"><Label htmlFor="voidReason">Reason</Label><Input id="voidReason" value={voidReason} onChange={(event) => setVoidReason(event.target.value)} /></div><Button className="self-end" variant="destructive" onClick={() => void voidRecord()} disabled={busy}>Void expense</Button></div>
        </section>
      )}
      {expense.status === 'needs_review' && <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => void deleteExpense()} disabled={busy}><Trash2 /> Delete review draft</Button>}
    </div>
  );
}
