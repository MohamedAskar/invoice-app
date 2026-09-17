import { Invoice, InvoiceStatus } from '@/types/invoice';

// New invoices cannot be issued until Task 4 archives their generated PDF via
// the constrained database RPC. Existing rows retain their stored status.
export function getInitialInvoiceStatus(existingInvoice?: Pick<Invoice, 'status'>): InvoiceStatus {
  return existingInvoice?.status ?? 'draft';
}

export function getInvoiceSaveStatus({
  displayStatus,
  persistedStatus,
  statusChanged,
}: {
  displayStatus: InvoiceStatus;
  persistedStatus?: InvoiceStatus;
  statusChanged: boolean;
}): InvoiceStatus {
  return statusChanged ? displayStatus : (persistedStatus ?? displayStatus);
}
