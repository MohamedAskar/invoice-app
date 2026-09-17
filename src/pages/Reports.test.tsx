import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { getAnnualExportPreview, requestAnnualExport } from '@/lib/finance-storage';
import { Reports } from './Reports';

vi.mock('@/lib/finance-storage', () => ({ getAnnualExportPreview: vi.fn(), requestAnnualExport: vi.fn(), getAnnualExportJob: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const preview = {
  issued_invoices: { recordCount: 2, fileCount: 1, missingCount: 1, totals: { net: 200, vat: 38, gross: 238 } },
  business_expenses: { recordCount: 1, fileCount: 2, missingCount: 0, totals: { net: 100, vat: 19, gross: 119 } },
};

it('shows independent cards and re-queries an explicit tax year', async () => {
  vi.mocked(getAnnualExportPreview).mockResolvedValue(preview);
  vi.mocked(requestAnnualExport).mockResolvedValue({ id: 'job', year: 2025, kind: 'business_expenses', status: 'completed', requestedAt: '', downloadUrl: 'https://example.test/zip' });
  render(<Reports />);
  expect(await screen.findByText('2 records · 1 original files · ' + new Date().getFullYear())).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /download issued invoices/i })).toBeDisabled();
  fireEvent.change(screen.getByRole('combobox', { name: 'Tax year' }), { target: { value: '2025' } });
  await waitFor(() => expect(getAnnualExportPreview).toHaveBeenLastCalledWith(2025));
  fireEvent.click(await screen.findByRole('button', { name: /download business expenses/i }));
  expect(requestAnnualExport).toHaveBeenCalledWith('business_expenses', 2025);
  expect(await screen.findByRole('link', { name: /save business expenses zip/i })).toBeInTheDocument();
});

it('withholds totals and downloads after a preview failure without exposing database text', async () => {
  vi.mocked(getAnnualExportPreview).mockRejectedValue(new Error('secret SQL connection details'));
  render(<Reports />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load report data.');
  expect(screen.queryByRole('button', { name: /download/i })).not.toBeInTheDocument();
  expect(screen.queryByText(/secret SQL/)).not.toBeInTheDocument();
});
