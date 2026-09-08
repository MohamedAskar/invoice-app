import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getAnnualExportJob, type TaxExportJob, type TaxExportKind } from '@/lib/finance-storage';

interface AnnualExportCardProps {
  year: number;
  kind?: TaxExportKind;
  missingInvoiceCount?: number;
  missingExpenseCount?: number;
  recordCount?: number;
  fileCount?: number;
  totals?: { net: number; vat: number; gross: number };
  onRequest: (kind: TaxExportKind, year: number) => Promise<TaxExportJob>;
}
const errorMessage = 'Could not create the export. Check your documents and try again.';
const euros = new Intl.NumberFormat('en', { style: 'currency', currency: 'EUR' });

export function AnnualExportCard({ year, kind = 'issued_invoices', missingInvoiceCount = 0, missingExpenseCount = 0, recordCount = 0, fileCount = 0, totals = { net: 0, vat: 0, gross: 0 }, onRequest }: AnnualExportCardProps) {
  const [job, setJob] = useState<TaxExportJob>();
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string>();
  const invoice = kind === 'issued_invoices';
  const label = invoice ? 'Issued invoices' : 'Business expenses';
  const missing = invoice ? missingInvoiceCount : missingExpenseCount;
  const pending = job?.status === 'queued' || job?.status === 'running';

  useEffect(() => {
    if (!job || !pending) return;
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      void getAnnualExportJob(job.id).then((next) => {
        if (!cancelled) { setJob(next); if (next.status === 'failed') setError(errorMessage); }
      }).catch(() => { if (!cancelled) { setError(errorMessage); setJob(undefined); } });
    }, 1500);
    return () => { cancelled = true; window.clearTimeout(timeout); };
  }, [job, pending]);

  const request = async () => {
    setRequesting(true); setError(undefined); setJob(undefined);
    try {
      const result = await onRequest(kind, year);
      setJob(result);
      if (result.status === 'failed') setError(errorMessage);
    } catch { setError(errorMessage); }
    finally { setRequesting(false); }
  };

  return (
    <Card>
      <CardHeader><CardTitle>{label}</CardTitle><CardDescription>{invoice ? 'Original archived PDFs and an invoice register.' : 'All original documents for booked expenses and a separate voided audit register.'}</CardDescription></CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">{recordCount} records · {fileCount} original files · {year}</p>
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <div><dt className="text-muted-foreground">Net</dt><dd className="mt-1 font-medium">{euros.format(totals.net)}</dd></div>
          <div><dt className="text-muted-foreground">VAT</dt><dd className="mt-1 font-medium">{euros.format(totals.vat)}</dd></div>
          <div><dt className="text-muted-foreground">Gross</dt><dd className="mt-1 font-semibold">{euros.format(totals.gross)}</dd></div>
        </dl>
        {missing > 0 && <p role="status" className="text-sm text-destructive">{invoice ? `${missing} issued invoices need PDF backfill before export.` : `${missing} booked expenses need an original document before export.`}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {pending && <p role="status" className="text-sm text-muted-foreground">Preparing your package…</p>}
        {job?.status === 'expired' && <p role="status" className="text-sm text-muted-foreground">This package has expired. Create a new export.</p>}
        {job?.status === 'completed' && job.downloadUrl && <div className="space-y-2"><Button asChild><a href={job.downloadUrl} rel="noreferrer"><Download />Save {label.toLowerCase()} ZIP</a></Button><p className="text-xs text-muted-foreground">Download link valid for 15 minutes. Create a new export if it expires.</p></div>}
        <Button variant="outline" disabled={missing > 0 || requesting || pending} onClick={() => void request()}><Download />{requesting ? 'Requesting export…' : `Download ${label.toLowerCase()}`}</Button>
      </CardContent>
    </Card>
  );
}
