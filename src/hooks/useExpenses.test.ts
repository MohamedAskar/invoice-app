import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Expense, ExpenseDocument } from '@/types/finance';

const storage = vi.hoisted(() => ({
  syncGmailReceipts: vi.fn(), splitGmailExpenseDocument: vi.fn(), rememberGmailVendor: vi.fn(),
  deleteDraftExpense: vi.fn(),
  deleteExpenseDocument: vi.fn(),
  getExpenseById: vi.fn(),
  getExpenses: vi.fn(),
  saveExpense: vi.fn(),
  setExpenseDocumentPrimary: vi.fn(),
  uploadExpenseDocument: vi.fn(),
  voidExpense: vi.fn(),
}));

vi.mock('@/lib/finance-storage', () => storage);

import { useExpenses } from './useExpenses';

const originalDocument: ExpenseDocument = {
  id: 'document-1', expenseId: 'expense-1', documentRole: 'supporting', isPrimary: false,
  storagePath: 'owner/expense-1/original.pdf', filename: 'original.pdf', detectedMimeType: 'application/pdf',
  byteSize: 100, sha256: 'a'.repeat(64), createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};

function expense(documents: ExpenseDocument[] = [originalDocument]): Expense {
  return {
    id: 'expense-1', vendor: 'Figma', category: 'software', expenseDate: '2026-01-01', netAmount: 10,
    vatAmount: 1.9, grossAmount: 11.9, currency: 'EUR', status: 'needs_review', source: 'upload',
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', documents,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useExpenses.setState({ expenses: [expense()], loading: false, busy: false, error: undefined, orphanCleanups: [] });
});

describe('useExpenses document lifecycle', () => {
  it('keeps the replaced document role instead of silently changing supporting evidence to an invoice', async () => {
    const replacement = { ...originalDocument, id: 'document-2', storagePath: 'owner/expense-1/new.pdf' };
    storage.uploadExpenseDocument.mockResolvedValue(replacement);
    storage.deleteExpenseDocument.mockResolvedValue(undefined);
    storage.getExpenseById.mockResolvedValue(expense([replacement]));

    await useExpenses.getState().replaceDocument('expense-1', originalDocument, new File(['PDF'], 'new.pdf', { type: 'application/pdf' }));

    expect(storage.uploadExpenseDocument).toHaveBeenCalledWith(
      expect.any(File), 'expense-1', { documentRole: 'supporting' }
    );
  });

  it('restores the primary marker after replacing the primary document', async () => {
    const primary = { ...originalDocument, documentRole: 'invoice' as const, isPrimary: true };
    const replacement = { ...primary, id: 'document-2', isPrimary: false, storagePath: 'owner/expense-1/new.pdf' };
    useExpenses.setState({ expenses: [expense([primary])] });
    storage.uploadExpenseDocument.mockResolvedValue(replacement);
    storage.deleteExpenseDocument.mockResolvedValue(undefined);
    storage.setExpenseDocumentPrimary.mockResolvedValue({ ...replacement, isPrimary: true });
    storage.getExpenseById.mockResolvedValue(expense([{ ...replacement, isPrimary: true }]));

    await useExpenses.getState().replaceDocument('expense-1', primary, new File(['PDF'], 'new.pdf', { type: 'application/pdf' }));

    expect(storage.setExpenseDocumentPrimary).toHaveBeenCalledWith('document-2');
  });

  it('refreshes the visible detail after metadata removal leaves an orphan cleanup warning', async () => {
    storage.deleteExpenseDocument.mockRejectedValue(Object.assign(
      new Error('The document record was removed, but its private file needs cleanup.'),
      { code: 'expense_document_orphan_cleanup_failed' }
    ));
    storage.getExpenseById.mockResolvedValue(expense([]));

    await expect(useExpenses.getState().removeDocument('expense-1', originalDocument)).rejects.toThrow('private file needs cleanup');

    expect(useExpenses.getState().getExpense('expense-1')?.documents).toEqual([]);
    expect(useExpenses.getState().error).toContain('private file needs cleanup');
  });

  it('keeps the exact orphan cleanup context and retries it after the database reference is gone', async () => {
    const cleanupError = Object.assign(
      new Error('The document record was removed, but its private file needs cleanup.'),
      { code: 'expense_document_orphan_cleanup_failed' }
    );
    storage.deleteExpenseDocument.mockRejectedValueOnce(cleanupError).mockResolvedValueOnce(undefined);
    storage.getExpenseById.mockResolvedValue(expense([]));

    await expect(useExpenses.getState().removeDocument('expense-1', originalDocument)).rejects.toThrow('private file needs cleanup');

    const cleanup = useExpenses.getState().orphanCleanups[0];
    expect(cleanup).toMatchObject({
      expenseId: 'expense-1',
      document: { id: 'document-1', storagePath: 'owner/expense-1/original.pdf' },
    });

    await useExpenses.getState().retryOrphanCleanup(cleanup);

    expect(storage.deleteExpenseDocument).toHaveBeenLastCalledWith(originalDocument);
    expect(useExpenses.getState().orphanCleanups).toEqual([]);
  });

  it('retains the replaced document cleanup context when its old private file cannot be removed', async () => {
    const replacement = { ...originalDocument, id: 'document-2', storagePath: 'owner/expense-1/replacement.pdf' };
    const cleanupError = Object.assign(
      new Error('The document record was removed, but its private file needs cleanup.'),
      { code: 'expense_document_orphan_cleanup_failed' }
    );
    storage.uploadExpenseDocument.mockResolvedValue(replacement);
    storage.deleteExpenseDocument.mockRejectedValue(cleanupError);
    storage.getExpenseById.mockResolvedValue(expense([replacement]));

    await expect(
      useExpenses.getState().replaceDocument('expense-1', originalDocument, new File(['PDF'], 'replacement.pdf', { type: 'application/pdf' }))
    ).rejects.toThrow('private file needs cleanup');

    expect(useExpenses.getState().getExpense('expense-1')?.documents).toEqual([replacement]);
    expect(useExpenses.getState().orphanCleanups).toMatchObject([{
      expenseId: 'expense-1',
      document: { id: 'document-1', storagePath: 'owner/expense-1/original.pdf' },
    }]);
  });
});
