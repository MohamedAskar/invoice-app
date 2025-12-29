import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';

export function formatCurrency(amount: number, currency: string = 'EUR'): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: currency,
  }).format(amount);
}

export function formatCurrencyCompact(amount: number, currency: string = 'EUR'): string {
  if (amount <= 999) {
    return formatCurrency(amount, currency);
  }
  
  const amountInK = amount / 1000;
  const formatted = amountInK % 1 === 0 
    ? amountInK.toFixed(0) 
    : amountInK.toFixed(2);
  
  // Get currency symbol
  const currencySymbol = new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: currency,
  }).formatToParts(0).find(part => part.type === 'currency')?.value || '€';
  
  return `${formatted}K ${currencySymbol}`;
}

export function formatCurrencyPlain(amount: number): string {
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatDate(dateString: string, formatStr: string = 'dd.MM.yyyy'): string {
  try {
    const date = parseISO(dateString);
    return format(date, formatStr, { locale: de });
  } catch {
    return dateString;
  }
}

export function formatDateRange(startDate: string, endDate: string): string {
  return `${formatDate(startDate)} - ${formatDate(endDate)}`;
}

export function formatIBAN(iban: string): string {
  // Remove all spaces and format with space every 4 characters
  const cleaned = iban.replace(/\s/g, '');
  return cleaned.match(/.{1,4}/g)?.join(' ') || iban;
}

export function toISODate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function parseDate(dateString: string): Date {
  return parseISO(dateString);
}

