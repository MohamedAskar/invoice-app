import { create } from 'zustand';
import { syncGmailReceipts, splitGmailExpenseDocument, rememberGmailVendor, type GmailSyncSummary } from '@/lib/finance-storage';
import {
  deleteDraftExpense as deleteDraftExpenseFromStorage,
  deleteExpenseDocument,
  getExpenseById,
  getExpenses,
  saveExpense,
  setExpenseDocumentPrimary,
  uploadExpenseDocument,
  voidExpense as voidExpenseInStorage,
} from '@/lib/finance-storage';
import { Expense, ExpenseDocument, ExpenseInput } from '@/types/finance';

export interface ExpenseOrphanCleanup {
  expenseId: string;
  document: ExpenseDocument;
}

interface ExpensesStore {
  gmailSummary?: GmailSyncSummary;
  syncGmail: () => Promise<GmailSyncSummary>;
  setPrimary: (documentId: string) => Promise<void>;
  splitDocument: (documentId: string) => Promise<void>;
  rememberVendor: (expenseId: string, action: 'always_include' | 'ignore') => Promise<void>;
  expenses: Expense[];
  loading: boolean;
  busy: boolean;
  error?: string;
  orphanCleanups: ExpenseOrphanCleanup[];
  loadExpenses: () => Promise<void>;
  createExpense: (input: ExpenseInput, receipt?: File) => Promise<Expense>;
  updateExpense: (id: string, input: ExpenseInput, receipt?: File) => Promise<Expense>;
  deleteDraftExpense: (id: string) => Promise<void>;
  bookExpense: (id: string, input: ExpenseInput) => Promise<Expense>;
  voidExpense: (id: string, reason: string) => Promise<Expense>;
  uploadDocument: (expenseId: string, file: File) => Promise<Expense>;
  removeDocument: (expenseId: string, document: ExpenseDocument) => Promise<void>;
  replaceDocument: (expenseId: string, document: ExpenseDocument, file: File) => Promise<Expense>;
  retryOrphanCleanup: (cleanup: ExpenseOrphanCleanup) => Promise<void>;
  getExpense: (id: string) => Expense | undefined;
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not update the expense. Please try again.';
}

function reviewInput(input: ExpenseInput): ExpenseInput {
  return { ...input, status: 'needs_review', currency: 'EUR' };
}

function isOrphanCleanupError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && (error as { code?: string }).code === 'expense_document_orphan_cleanup_failed';
}

function addOrphanCleanup(cleanups: ExpenseOrphanCleanup[], cleanup: ExpenseOrphanCleanup): ExpenseOrphanCleanup[] {
  const withoutMatchingCleanup = cleanups.filter((candidate) => candidate.document.id !== cleanup.document.id);
  return [...withoutMatchingCleanup, cleanup];
}

function removeOrphanCleanup(cleanups: ExpenseOrphanCleanup[], cleanup: ExpenseOrphanCleanup): ExpenseOrphanCleanup[] {
  return cleanups.filter((candidate) => candidate.document.id !== cleanup.document.id);
}

async function refreshExpense(expenseId: string, fallback: Expense): Promise<Expense> {
  return (await getExpenseById(expenseId)) ?? fallback;
}

export const useExpenses = create<ExpensesStore>((set, get) => ({
  gmailSummary: undefined,
  syncGmail: async () => {
    set({ busy: true, error: undefined });
    try { const gmailSummary = await syncGmailReceipts(); await get().loadExpenses(); set({ gmailSummary }); return gmailSummary; }
    catch (error) { set({ error: messageFor(error) }); throw error; }
    finally { set({ busy: false }); }
  },
  setPrimary: async (id) => { set({ busy: true }); try { await setExpenseDocumentPrimary(id); await get().loadExpenses(); } finally { set({ busy: false }); } },
  splitDocument: async (id) => { set({ busy: true }); try { await splitGmailExpenseDocument(id); await get().loadExpenses(); } finally { set({ busy: false }); } },
  rememberVendor: rememberGmailVendor,
  expenses: [],
  loading: false,
  busy: false,
  error: undefined,
  orphanCleanups: [],
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
        orphanCleanups: removeOrphanCleanup(state.orphanCleanups, { expenseId, document }),
      }));
    } catch (error) {
      // A Storage failure happens after database metadata is removed. Refresh
      // before surfacing the retryable orphan warning so no stale document
      // remains visible in the review panel.
      let refreshed: Expense | undefined;
      try {
        refreshed = await getExpenseById(expenseId);
      } catch {
        // Preserve the cleanup error as the actionable message.
      }
      set((state) => ({
        expenses: state.expenses.map((candidate) => candidate.id === expenseId && refreshed ? refreshed : candidate),
        busy: false,
        error: messageFor(error),
        orphanCleanups: isOrphanCleanupError(error)
          ? addOrphanCleanup(state.orphanCleanups, { expenseId, document })
          : state.orphanCleanups,
      }));
      throw error;
    }
  },
  replaceDocument: async (expenseId, document, file) => {
    set({ busy: true, error: undefined });
    try {
      // Keep the existing evidence until the replacement is stored, then use
      // the database-first cleanup operation for the old private object.
      const replacement = await uploadExpenseDocument(file, expenseId, { documentRole: document.documentRole });
      try {
        await deleteExpenseDocument(document);
      } catch (error) {
        if (document.isPrimary && (error as { code?: string }).code === 'expense_document_orphan_cleanup_failed') {
          await setExpenseDocumentPrimary(replacement.id);
        }
        throw error;
      }
      if (document.isPrimary) await setExpenseDocumentPrimary(replacement.id);
      const expense = await getExpenseById(expenseId);
      if (!expense) throw new Error('The expense was not found after replacing its document.');
      set((state) => ({
        expenses: state.expenses.map((candidate) => candidate.id === expenseId ? expense : candidate),
        busy: false,
        orphanCleanups: removeOrphanCleanup(state.orphanCleanups, { expenseId, document }),
      }));
      return expense;
    } catch (error) {
      let refreshed: Expense | undefined;
      try {
        refreshed = await getExpenseById(expenseId);
      } catch {
        // Preserve the operation error rather than masking it with a refresh error.
      }
      set((state) => ({
        expenses: state.expenses.map((candidate) => candidate.id === expenseId && refreshed ? refreshed : candidate),
        busy: false,
        error: messageFor(error),
        orphanCleanups: isOrphanCleanupError(error)
          ? addOrphanCleanup(state.orphanCleanups, { expenseId, document })
          : state.orphanCleanups,
      }));
      throw error;
    }
  },
  retryOrphanCleanup: async (cleanup) => {
    set({ busy: true, error: undefined });
    try {
      // The original document is intentionally held outside the refreshed
      // expense state: its database row is gone, but its exact storage path is
      // still required by the safe retry path in deleteExpenseDocument.
      await deleteExpenseDocument(cleanup.document);
      const refreshed = await getExpenseById(cleanup.expenseId);
      set((state) => ({
        expenses: state.expenses.map((candidate) => candidate.id === cleanup.expenseId && refreshed ? refreshed : candidate),
        busy: false,
        orphanCleanups: removeOrphanCleanup(state.orphanCleanups, cleanup),
      }));
    } catch (error) {
      let refreshed: Expense | undefined;
      try {
        refreshed = await getExpenseById(cleanup.expenseId);
      } catch {
        // Keep the original cleanup error and descriptor actionable.
      }
      set((state) => ({
        expenses: state.expenses.map((candidate) => candidate.id === cleanup.expenseId && refreshed ? refreshed : candidate),
        busy: false,
        error: messageFor(error),
        orphanCleanups: isOrphanCleanupError(error)
          ? addOrphanCleanup(state.orphanCleanups, cleanup)
          : state.orphanCleanups,
      }));
      throw error;
    }
  },
  getExpense: (id) => get().expenses.find((expense) => expense.id === id),
}));
