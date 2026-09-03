import { create } from 'zustand';
import {
  deleteDraftExpense as deleteDraftExpenseFromStorage,
  deleteExpenseDocument,
  getExpenseById,
  getExpenses,
  saveExpense,
  uploadExpenseDocument,
  voidExpense as voidExpenseInStorage,
} from '@/lib/finance-storage';
import { Expense, ExpenseDocument, ExpenseInput } from '@/types/finance';

interface ExpensesStore {
  expenses: Expense[];
  loading: boolean;
  busy: boolean;
  error?: string;
  loadExpenses: () => Promise<void>;
  createExpense: (input: ExpenseInput, receipt?: File) => Promise<Expense>;
  updateExpense: (id: string, input: ExpenseInput, receipt?: File) => Promise<Expense>;
  deleteDraftExpense: (id: string) => Promise<void>;
  bookExpense: (id: string, input: ExpenseInput) => Promise<Expense>;
  voidExpense: (id: string, reason: string) => Promise<Expense>;
  uploadDocument: (expenseId: string, file: File) => Promise<Expense>;
  removeDocument: (expenseId: string, document: ExpenseDocument) => Promise<void>;
  replaceDocument: (expenseId: string, document: ExpenseDocument, file: File) => Promise<Expense>;
  getExpense: (id: string) => Expense | undefined;
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not update the expense. Please try again.';
}

function reviewInput(input: ExpenseInput): ExpenseInput {
  return { ...input, status: 'needs_review', currency: 'EUR' };
}

async function refreshExpense(expenseId: string, fallback: Expense): Promise<Expense> {
  return (await getExpenseById(expenseId)) ?? fallback;
}

export const useExpenses = create<ExpensesStore>((set, get) => ({
  expenses: [],
  loading: false,
  busy: false,
  error: undefined,
  loadExpenses: async () => {
    set({ loading: true, error: undefined });
    try {
      const expenses = await getExpenses();
      set({ expenses, loading: false });
    } catch (error) {
      set({ loading: false, error: messageFor(error) });
      throw error;
    }
  },
  createExpense: async (input, receipt) => {
    set({ busy: true, error: undefined });
    try {
      let expense = await saveExpense(reviewInput(input));
      if (receipt) {
        await uploadExpenseDocument(receipt, expense.id);
        expense = await refreshExpense(expense.id, expense);
      }
      if (input.status === 'booked') {
        expense = await saveExpense({ ...input, status: 'booked', currency: 'EUR' }, expense.id);
      }
      set((state) => ({ expenses: [expense, ...state.expenses], busy: false }));
      return expense;
    } catch (error) {
      set({ busy: false, error: messageFor(error) });
      throw error;
    }
  },
  updateExpense: async (id, input, receipt) => {
    set({ busy: true, error: undefined });
    try {
      let expense = await saveExpense(reviewInput(input), id);
      if (receipt) {
        await uploadExpenseDocument(receipt, id);
        expense = await refreshExpense(id, expense);
      }
      if (input.status === 'booked') {
        expense = await saveExpense({ ...input, status: 'booked', currency: 'EUR' }, id);
      }
      set((state) => ({
        expenses: state.expenses.map((candidate) => candidate.id === id ? expense : candidate),
        busy: false,
      }));
      return expense;
    } catch (error) {
      set({ busy: false, error: messageFor(error) });
      throw error;
    }
  },
  deleteDraftExpense: async (id) => {
    set({ busy: true, error: undefined });
    try {
      await deleteDraftExpenseFromStorage(id, get().getExpense(id)?.documents);
      set((state) => ({ expenses: state.expenses.filter((expense) => expense.id !== id), busy: false }));
    } catch (error) {
      set({ busy: false, error: messageFor(error) });
      throw error;
    }
  },
  bookExpense: async (id, input) => {
    set({ busy: true, error: undefined });
    try {
      const expense = await saveExpense({ ...input, status: 'booked', currency: 'EUR' }, id);
      set((state) => ({
        expenses: state.expenses.map((candidate) => candidate.id === id ? expense : candidate),
        busy: false,
      }));
      return expense;
    } catch (error) {
      set({ busy: false, error: messageFor(error) });
      throw error;
    }
  },
  voidExpense: async (id, reason) => {
    set({ busy: true, error: undefined });
    try {
      const expense = await voidExpenseInStorage(id, reason);
      set((state) => ({
        expenses: state.expenses.map((candidate) => candidate.id === id ? expense : candidate),
        busy: false,
      }));
      return expense;
    } catch (error) {
      set({ busy: false, error: messageFor(error) });
      throw error;
    }
  },
  uploadDocument: async (expenseId, file) => {
    set({ busy: true, error: undefined });
    try {
      await uploadExpenseDocument(file, expenseId);
      const expense = await getExpenseById(expenseId);
      if (!expense) throw new Error('The expense was not found after uploading its document.');
      set((state) => ({
        expenses: state.expenses.map((candidate) => candidate.id === expenseId ? expense : candidate),
        busy: false,
      }));
      return expense;
    } catch (error) {
      set({ busy: false, error: messageFor(error) });
      throw error;
    }
  },
  removeDocument: async (expenseId, document) => {
    set({ busy: true, error: undefined });
    try {
      await deleteExpenseDocument(document);
      const refreshed = await getExpenseById(expenseId);
      set((state) => ({
        expenses: state.expenses.map((candidate) => candidate.id === expenseId && refreshed ? refreshed : candidate),
        busy: false,
      }));
    } catch (error) {
      set({ busy: false, error: messageFor(error) });
      throw error;
    }
  },
  replaceDocument: async (expenseId, document, file) => {
    set({ busy: true, error: undefined });
    try {
      // Keep the existing evidence until the replacement is stored, then use
      // the database-first cleanup operation for the old private object.
      await uploadExpenseDocument(file, expenseId);
      await deleteExpenseDocument(document);
      const expense = await getExpenseById(expenseId);
      if (!expense) throw new Error('The expense was not found after replacing its document.');
      set((state) => ({
        expenses: state.expenses.map((candidate) => candidate.id === expenseId ? expense : candidate),
        busy: false,
      }));
      return expense;
    } catch (error) {
      set({ busy: false, error: messageFor(error) });
      throw error;
    }
  },
  getExpense: (id) => get().expenses.find((expense) => expense.id === id),
}));
