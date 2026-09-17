import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AnnualExportCard } from './AnnualExportCard';
import { getAnnualExportJob, type TaxExportJob } from '@/lib/finance-storage';

vi.mock('@/lib/finance-storage', () => ({ getAnnualExportJob: vi.fn() }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); });
const job: TaxExportJob = { id: 'job-1', kind: 'issued_invoices', year: 2026, status: 'queued', requestedAt: '2026-09-08T00:00:00Z' };

it('blocks an invoice export with missing archived PDFs', async () => {
  render(<AnnualExportCard year={2026} missingInvoiceCount={2} onRequest={vi.fn()} />);
  expect(screen.getByRole('button', { name: /download issued invoices/i })).toBeDisabled();
  expect(screen.getByText(/2 issued invoices need PDF backfill/i)).toBeInTheDocument();
});

it('blocks expenses without documents independently from invoices', () => {
  render(<><AnnualExportCard year={2026} onRequest={vi.fn()} /><AnnualExportCard kind="business_expenses" year={2026} missingExpenseCount={1} onRequest={vi.fn()} /></>);
  expect(screen.getByRole('button', { name: /download issued invoices/i })).toBeEnabled();
  expect(screen.getByRole('button', { name: /download business expenses/i })).toBeDisabled();
  expect(screen.getByText(/1 booked expenses need an original document/i)).toBeInTheDocument();
});

it('polls only active jobs and exposes the completed signed download', async () => {
  vi.useFakeTimers();
  const request = vi.fn().mockResolvedValue(job);
  vi.mocked(getAnnualExportJob).mockResolvedValueOnce({ ...job, status: 'running' }).mockResolvedValueOnce({ ...job, status: 'completed', downloadUrl: 'https://example.test/signed.zip' });
  render(<AnnualExportCard year={2026} onRequest={request} />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /download issued invoices/i })); });
  expect(request).toHaveBeenCalledWith('issued_invoices', 2026);
  await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  expect(screen.getByRole('link', { name: /save issued invoices zip/i })).toHaveAttribute('href', 'https://example.test/signed.zip');
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(getAnnualExportJob).toHaveBeenCalledTimes(2);
});

it('stops polling on failure and hides raw server errors', async () => {
  vi.useFakeTimers();
  vi.mocked(getAnnualExportJob).mockResolvedValue({ ...job, status: 'failed', errorMessage: 'secret database host and SQL' });
  render(<AnnualExportCard year={2026} onRequest={vi.fn().mockResolvedValue(job)} />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /download issued invoices/i })); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  expect(screen.getByRole('alert')).toHaveTextContent('Could not create the export.');
  expect(screen.queryByText(/secret database/)).not.toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(getAnnualExportJob).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});

it('cancels polling when unmounted', async () => {
  vi.useFakeTimers();
  const { unmount } = render(<AnnualExportCard year={2026} onRequest={vi.fn().mockResolvedValue(job)} />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /download issued invoices/i })); });
  unmount();
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(getAnnualExportJob).not.toHaveBeenCalled();
});
