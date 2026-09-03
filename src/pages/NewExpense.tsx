import { useNavigate } from 'react-router-dom';
import { ExpenseForm } from '@/components/expenses/ExpenseForm';
import { useExpenses } from '@/hooks/useExpenses';
import { toast } from '@/hooks/use-toast';
import { ExpenseInput } from '@/types/finance';

export function NewExpense() {
  const navigate = useNavigate();
  const createExpense = useExpenses((state) => state.createExpense);
  const busy = useExpenses((state) => state.busy);

  const save = async (input: ExpenseInput, receipt?: File) => {
    try {
      await createExpense(input, receipt);
      toast({ title: input.status === 'booked' ? 'Expense booked' : 'Saved for review', description: 'Your receipt is private to your account.' });
      navigate('/expenses');
    } catch (error) {
      toast({ title: 'Could not save expense', description: error instanceof Error ? error.message : 'Please try again.', variant: 'destructive' });
    }
  };

  return <div className="mx-auto max-w-3xl"><ExpenseForm initialStatus="needs_review" onSave={save} busy={busy} /></div>;
}
