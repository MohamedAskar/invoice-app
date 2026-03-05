import { useParams, Navigate } from 'react-router-dom';
import { useExpenses } from '@/hooks/useExpenses';
import { ExpenseForm } from '@/components/expense/ExpenseForm';

export function EditExpense() {
  const { id } = useParams<{ id: string }>();
  const { getExpense } = useExpenses();

  if (!id) return <Navigate to="/expenses" replace />;

  const expense = getExpense(id);
  if (!expense) return <Navigate to="/expenses" replace />;

  return <ExpenseForm mode="edit" existingExpense={expense} />;
}
