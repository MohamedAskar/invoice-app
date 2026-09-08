import { useEffect, useState } from 'react';
import { AnnualExportCard } from '@/components/reports/AnnualExportCard';
import { getAnnualExportPreview, requestAnnualExport } from '@/lib/finance-storage';

export function Reports() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof getAnnualExportPreview>>>();

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(false); setPreview(undefined);
    void getAnnualExportPreview(year).then((data) => {
      if (!cancelled) setPreview(data);
    }).catch(() => {
      if (!cancelled) setError(true);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [year]);

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b pb-6">
        <div><h1 className="text-2xl font-semibold tracking-tight">Reports</h1><p className="mt-1 text-sm text-muted-foreground">Annual document packages for your tax advisor.</p></div>
        <label className="space-y-1 text-sm"><span className="block text-muted-foreground">Tax year</span><select aria-label="Tax year" className="h-10 rounded-md border bg-background px-3" value={year} onChange={(event) => setYear(Number(event.target.value))}>{Array.from({ length: currentYear - 1999 }, (_, index) => currentYear - index).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      </div>
      <p className="max-w-3xl text-sm text-muted-foreground">Invoices use their issue date. Booked expenses use payment date when present, otherwise document date. Voided expenses appear only in a separate audit CSV and are excluded from totals. This overview is not a filed return.</p>
      {loading ? <p role="status">Loading report data…</p> : error || !preview ? <p role="alert" className="text-sm text-destructive">Could not load report data. Reload the page to try again.</p> : (
        <div className="grid gap-6 lg:grid-cols-2">
          <AnnualExportCard key={`invoices-${year}`} year={year} {...preview.issued_invoices} missingInvoiceCount={preview.issued_invoices.missingCount} onRequest={requestAnnualExport} />
          <AnnualExportCard key={`expenses-${year}`} kind="business_expenses" year={year} {...preview.business_expenses} missingExpenseCount={preview.business_expenses.missingCount} onRequest={requestAnnualExport} />
        </div>
      )}
      <p className="text-xs text-muted-foreground">Each ZIP contains a semicolon CSV, README, and original documents. A package is available only when all required documents can be included. Export copies expire after 24 hours.</p>
    </div>
  );
}
