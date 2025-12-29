import { LineItem } from '@/types/invoice';

export function calculateLineItemTotal(quantity: number, unitPrice: number): number {
  return Math.round(quantity * unitPrice * 100) / 100;
}

export function calculateSubtotal(lineItems: LineItem[]): number {
  return lineItems.reduce((sum, item) => sum + item.total, 0);
}

export function calculateVAT(subtotal: number, vatRate: number): number {
  if (vatRate === 0) return 0;
  return Math.round(subtotal * (vatRate / 100) * 100) / 100;
}

export function calculateTotal(subtotal: number, vatAmount: number): number {
  return Math.round((subtotal + vatAmount) * 100) / 100;
}

export function calculateDueDate(invoiceDate: string, paymentTerms: number): string {
  const date = new Date(invoiceDate);
  date.setDate(date.getDate() + paymentTerms);
  return date.toISOString().split('T')[0];
}

