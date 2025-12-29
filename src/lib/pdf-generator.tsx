import { pdf } from '@react-pdf/renderer';
import { Invoice, BusinessSettings } from '@/types/invoice';
import { InvoicePDF } from '@/components/invoice/InvoicePDF';
import { formatDate } from './formatting';

export async function generatePDF(
  invoice: Invoice,
  settings: BusinessSettings
): Promise<void> {
  try {
    // Generate the PDF blob
    const blob = await pdf(
      <InvoicePDF invoice={invoice} settings={settings} />
    ).toBlob();

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
