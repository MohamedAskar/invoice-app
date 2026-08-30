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

export async function generatePDF(
  invoice: Invoice,
  settings: BusinessSettings
): Promise<void> {
  try {
    // Generate the PDF blob
    const blob = await generateInvoicePdfBlob(invoice, settings);

    // Create download link
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    
    // Generate filename
    const dateStr = formatDate(invoice.date).replace(/\./g, '-');
    const filename = `Rechnung-${invoice.invoiceNumber}-${dateStr}.pdf`;
    link.download = filename;

    // Trigger download
    document.body.appendChild(link);
    link.click();

    // Cleanup
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Error generating PDF:', error);
    throw new Error('Failed to generate PDF. Please try again.');
  }
}
