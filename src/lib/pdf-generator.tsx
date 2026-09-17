import { pdf } from '@react-pdf/renderer';
import { Invoice, BusinessSettings } from '@/types/invoice';
import { InvoicePDF } from '@/components/invoice/InvoicePDF';
import { formatDate } from './formatting';

/**
 * Render an invoice without causing any browser-side download.
 *
 * Keeping rendering separate from download orchestration lets callers retain
 * the exact issued document for storage while preserving the existing PDF
 * component and output options.
 */
export async function generateInvoicePdfBlob(
  invoice: Invoice,
  settings: BusinessSettings
): Promise<Blob> {
  return pdf(
    <InvoicePDF invoice={invoice} settings={settings} />
  ).toBlob();
}

/**
 * Freezes the exact rendered document for an issued invoice. Drafts are
 * deliberately ignored: merely saving or previewing a draft must never create
 * an immutable financial record. Existing archives are immutable and reused.
 */
export async function archiveIssuedInvoicePdf(
  invoice: Invoice,
  settings: BusinessSettings,
  intent: 'issue' | 'backfill' = 'issue'
): Promise<void> {
  if (invoice.status === 'draft' || invoice.pdfStoragePath) return;

  const blob = await generateInvoicePdfBlob(invoice, settings);
  const { uploadIssuedInvoicePdf } = await import('./finance-storage');
  await uploadIssuedInvoicePdf(invoice.id, blob, invoice.contentRevision, intent);
}

function invoicePdfFilename(invoice: Invoice): string {
  const dateStr = formatDate(invoice.date).replace(/\./g, '-');
  return `Rechnung-${invoice.invoiceNumber}-${dateStr}.pdf`;
}

function downloadUrl(url: string, filename: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/** Downloads the frozen issued document when one exists, otherwise a preview. */
export async function downloadInvoicePdf(
  invoice: Invoice,
  settings: BusinessSettings
): Promise<void> {
  if (invoice.pdfStoragePath) {
    const { getIssuedInvoicePdfDownloadUrl } = await import('./finance-storage');
    const signedUrl = await getIssuedInvoicePdfDownloadUrl(invoice.pdfStoragePath);
    downloadUrl(signedUrl, invoicePdfFilename(invoice));
    return;
  }
  await generatePDF(invoice, settings);
}

export async function generatePDF(
  invoice: Invoice,
  settings: BusinessSettings
): Promise<void> {
  try {
    // Generate the PDF blob
    const blob = await generateInvoicePdfBlob(invoice, settings);

    // Create download link
    const url = URL.createObjectURL(blob);
    downloadUrl(url, invoicePdfFilename(invoice));
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Error generating PDF:', error);
    throw new Error('Failed to generate PDF. Please try again.');
  }
}
