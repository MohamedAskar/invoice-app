import { ChangeEvent, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ExpenseOrphanCleanup } from '@/hooks/useExpenses';
import { Expense, ExpenseDocument } from '@/types/finance';
import { getDocumentDownloadUrl } from '@/lib/finance-storage';
import { AlertTriangle, FileImage, FileText, LoaderCircle, LockKeyhole, RefreshCw, Trash2, Upload } from 'lucide-react';

export interface ExpenseDocumentPanelProps {
  expense: Expense;
  busy?: boolean;
  onUpload?: (file: File) => Promise<void>;
  onRemove?: (document: ExpenseDocument) => Promise<void>;
  onReplace?: (document: ExpenseDocument, file: File) => Promise<void>;
  onPrimary?: (documentId: string) => Promise<void>;
  onSplit?: (documentId: string) => Promise<void>;
  orphanCleanup?: ExpenseOrphanCleanup;
  onRetryCleanup?: (cleanup: ExpenseOrphanCleanup) => Promise<void>;
}

function roleLabel(document: ExpenseDocument): string {
  return document.documentRole === 'invoice' ? 'Invoice' : document.documentRole === 'receipt' ? 'Receipt' : 'Supporting document';
}

export function ExpenseDocumentPanel({
  expense, busy = false, onUpload, onRemove, onReplace, onPrimary, onSplit, orphanCleanup, onRetryCleanup,
}: ExpenseDocumentPanelProps) {
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [previewMimeType, setPreviewMimeType] = useState<ExpenseDocument['detectedMimeType']>();
  const [previewing, setPreviewing] = useState<string>();
  const [error, setError] = useState<string>();
  const editable = expense.status === 'needs_review';
  const act = async (action: () => Promise<void>) => { setError(undefined); try { await action(); } catch { setError('Could not update this review document. Please retry.'); } };

  const openPreview = async (document: ExpenseDocument) => {
    setPreviewing(document.id);
    setError(undefined);
    try {
      setPreviewUrl(await getDocumentDownloadUrl(document));
      setPreviewMimeType(document.detectedMimeType);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : 'Could not open this private document.');
    } finally {
      setPreviewing(undefined);
    }
  };

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !onUpload) return;
    setError(undefined);
    try {
      await onUpload(file);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Could not upload this document.');
    }
  };

  const remove = async (document: ExpenseDocument) => {
    if (!onRemove) return;
    setError(undefined);
    try {
      await onRemove(document);
      if (previewUrl) setPreviewUrl(undefined);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Could not remove this document.');
    }
  };

  const replace = async (document: ExpenseDocument, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !onReplace) return;
    setError(undefined);
    try {
      await onReplace(document, file);
    } catch (replaceError) {
      setError(replaceError instanceof Error ? replaceError.message : 'Could not replace this document.');
    }
  };

  const retryCleanup = async () => {
    if (!orphanCleanup || !onRetryCleanup) return;
    setError(undefined);
    try {
      await onRetryCleanup(orphanCleanup);
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : 'Could not remove the orphaned private file.');
    }
  };

  return (
    <section className="rounded-lg border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Receipt evidence</h2>
          <p className="mt-1 text-sm text-muted-foreground">Private files are opened through a short-lived link.</p>
        </div>
        <Badge variant="secondary" className="rounded-md">{expense.source === 'gmail' ? 'From Gmail' : 'Uploaded manually'}</Badge>
      </div>

      {expense.source === 'gmail' && <div className="mt-4 space-y-2 text-sm">
        {expense.gmailReceivedAt && <p>Gmail received: <time dateTime={expense.gmailReceivedAt}>{new Date(expense.gmailReceivedAt).toLocaleString()}</time></p>}
        <p>Filter reason: {(expense.gmailFilterReasons ?? []).map(reason => reason.replace(/_/g, ' ')).join(', ') || 'Document selected for review'}</p>
        <p>{expense.gmailIgnoredCount ?? 0} ignored · {expense.gmailSkippedCount ?? 0} duplicates skipped</p>
        {expense.gmailMultiplePossibleInvoices && <p className="font-medium">Multiple possible invoices. Check the documents and split separate expenses if needed.</p>}
      </div>}

      {!editable && (
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          <LockKeyhole className="h-4 w-4" /> Documents are read-only because this expense is {expense.status}.
        </div>
      )}

      {orphanCleanup && (
        <Alert variant="destructive" className="mt-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>File cleanup needed</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>The receipt record for {orphanCleanup.document.filename} was removed, but its private file still needs cleanup.</p>
            {onRetryCleanup && (
              <Button type="button" variant="outline" size="sm" onClick={() => void retryCleanup()} disabled={busy}>
                <RefreshCw /> Retry file cleanup
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive" className="mt-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{error.includes('orphan') ? 'File cleanup needed' : 'Document action failed'}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="mt-4 space-y-3">
        {expense.documents.length === 0 ? (
          <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">No receipt attached yet.</div>
        ) : expense.documents.map((document) => (
          <div key={document.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              {document.detectedMimeType === 'application/pdf' ? <FileText className="h-5 w-5 shrink-0 text-muted-foreground" /> : <FileImage className="h-5 w-5 shrink-0 text-muted-foreground" />}
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{document.filename}</p>
                <p className="text-xs text-muted-foreground">{roleLabel(document)} · {(document.byteSize / 1024 / 1024).toFixed(1)} MB</p>
                <p className="text-xs text-muted-foreground">{document.isPrimary ? 'Tentative primary document' : 'Supporting evidence'}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {editable && onPrimary && !document.isPrimary && <Button type="button" variant="outline" size="sm" onClick={() => void act(() => onPrimary(document.id))} disabled={busy}>Set as primary</Button>}
              {editable && onSplit && expense.source === 'gmail' && expense.documents.length > 1 && <Button type="button" variant="outline" size="sm" onClick={() => void act(() => onSplit(document.id))} disabled={busy}>Split into separate expense</Button>}
              <Button type="button" variant="outline" size="sm" onClick={() => void openPreview(document)} disabled={busy || previewing === document.id}>
                {previewing === document.id ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
                {previewUrl ? 'Re-open' : 'Preview'}
              </Button>
              {editable && onRemove && (
                <Button type="button" variant="ghost" size={expense.source === 'gmail' ? 'sm' : 'icon'} aria-label={`Remove ${document.filename}`} onClick={() => void remove(document)} disabled={busy}>
                  <Trash2 className="text-destructive" />{expense.source === 'gmail' && 'Remove from candidate'}
                </Button>
              )}
              {editable && onReplace && (
                <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-input px-3 text-sm font-medium hover:bg-accent">
                  <Upload className="h-4 w-4" /> Replace
                  <input className="sr-only" type="file" accept="application/pdf,image/jpeg,image/png" onChange={(event) => void replace(document, event)} disabled={busy} />
                </label>
              )}
            </div>
          </div>
        ))}
      </div>

      {editable && onUpload && (
        <div className="mt-4">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-input px-3 py-2 text-sm font-medium hover:bg-accent">
            <Upload className="h-4 w-4" /> Add or replace document
            <input className="sr-only" type="file" accept="application/pdf,image/jpeg,image/png" onChange={(event) => void upload(event)} disabled={busy} />
          </label>
        </div>
      )}

      {previewUrl && (
        <div className="mt-5 overflow-hidden rounded-lg border bg-muted">
          <div className="flex items-center justify-between border-b bg-background px-3 py-2 text-sm">
            <span>Signed preview</span>
            <a href={previewUrl} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-4">Open in new tab</a>
          </div>
          {previewMimeType === 'application/pdf' ? (
            <iframe title="Private receipt preview" src={previewUrl} className="h-96 w-full bg-background" />
          ) : <img src={previewUrl} alt="Private receipt preview" className="max-h-96 w-full object-contain" />}
        </div>
      )}
    </section>
  );
}
