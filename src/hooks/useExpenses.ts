import { create } from 'zustand';
import { Expense } from '@/types/invoice';
import {
  getExpenses,
  saveExpense,
  deleteExpense as deleteExpenseFromStorage,
  getExpenseById,
} from '@/lib/storage';

interface ExpensesStore {
  expenses: Expense[];
  loadExpenses: () => void;
  addExpense: (expense: Expense) => void;
  updateExpense: (expense: Expense) => void;
  deleteExpense: (id: string) => void;
  getExpense: (id: string) => Expense | undefined;
}

export const useExpenses = create<ExpensesStore>((set, get) => ({
  expenses: [],
  loadExpenses: () => {
    const expenses = getExpenses();
    set({ expenses });
  },
  addExpense: (expense: Expense) => {
    saveExpense(expense);
    set((state) => ({ expenses: [...state.expenses, expense] }));
  },
  updateExpense: (expense: Expense) => {
    saveExpense(expense);
    set((state) => ({
      expenses: state.expenses.map((e) => (e.id === expense.id ? expense : e)),
    }));
  },
  deleteExpense: (id: string) => {
    deleteExpenseFromStorage(id);
    set((state) => ({
      expenses: state.expenses.filter((e) => e.id !== id),
    }));
  },
  getExpense: (id: string) => {
    const stored = getExpenseById(id);
    if (stored) return stored;
    return get().expenses.find((e) => e.id === id);
  },
}));
