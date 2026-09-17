import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ from: vi.fn(), functions: { invoke: vi.fn() }, auth: { getUser: vi.fn() } }));
vi.mock('./supabase', () => ({ supabase: mocks }));
import { getAnnualExportJob, getAnnualExportPreview, requestAnnualExport } from './finance-storage';

beforeEach(() => vi.resetAllMocks());

it('sends only export kind and year, validates bounds and sanitizes failures', async () => {
  mocks.functions.invoke.mockResolvedValue({ data: { id: 'job', status: 'failed', errorMessage: 'private SQL error' }, error: null });
  const result = await requestAnnualExport('business_expenses', 2026);
  expect(mocks.functions.invoke).toHaveBeenCalledWith('create-tax-export', { body: { kind: 'business_expenses', year: 2026 } });
  expect(result.errorMessage).toBe('Could not create the export. Check your documents and try again.');
  await expect(requestAnnualExport('issued_invoices', 1999)).rejects.toThrow(/year/);
  await expect(requestAnnualExport('issued_invoices', new Date().getFullYear() + 1)).rejects.toThrow(/year/);
  expect(mocks.functions.invoke).toHaveBeenCalledTimes(1);
});

it('status retrieval rejects unsafe download URL protocols', async () => {
  mocks.functions.invoke.mockResolvedValue({ data: { id: 'job', status: 'completed', downloadUrl: 'javascript:alert(1)' }, error: null });
  await expect(getAnnualExportJob('job')).rejects.toThrow(/unavailable/);
  expect(mocks.functions.invoke).toHaveBeenCalledWith('create-tax-export', { body: { mode: 'status', jobId: 'job' } });
});

it('paginates preview records, counts all linked originals and scopes accounting dates and ownership', async () => {
  mocks.auth.getUser.mockResolvedValue({ data: { user: { id: 'owner' } }, error: null });
  const invoice = { subtotal: '100', vat_amount: '19', total: '119', pdf_storage_path: 'owner/archive.pdf' };
  const queries: { table: string; eq: ReturnType<typeof vi.fn>; or: ReturnType<typeof vi.fn>; range: ReturnType<typeof vi.fn> }[] = [];
  mocks.from.mockImplementation((table: string) => {
    const query = {
      table, select: vi.fn().mockReturnThis(), neq: vi.fn().mockReturnThis(), gte: vi.fn().mockReturnThis(), lt: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(), or: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
      range: vi.fn().mockImplementation((offset: number) => Promise.resolve({ data: table === 'invoices' ? offset === 0 ? Array.from({ length: 200 }, () => invoice) : [{ ...invoice, pdf_storage_path: null }] : [{ net_amount: '100', vat_amount: '19', gross_amount: '119', expense_documents: [{ count: 3 }] }], error: null })),
    };
    queries.push(query);
    return query;
  });
  const preview = await getAnnualExportPreview(2026);
  expect(preview.issued_invoices).toEqual({ recordCount: 201, fileCount: 200, missingCount: 1, totals: { net: 20100, vat: 3819, gross: 23919 } });
  expect(preview.business_expenses.fileCount).toBe(3);
  const expenseQuery = queries.find((query) => query.table === 'expenses')!;
  expect(expenseQuery.eq).toHaveBeenCalledWith('user_id', 'owner');
  expect(expenseQuery.eq).toHaveBeenCalledWith('status', 'booked');
  expect(expenseQuery.or).toHaveBeenCalledWith('and(paid_date.gte.2026-01-01,paid_date.lt.2027-01-01),and(paid_date.is.null,expense_date.gte.2026-01-01,expense_date.lt.2027-01-01)');
  expect(queries.filter((query) => query.table === 'invoices')).toHaveLength(2);
});
