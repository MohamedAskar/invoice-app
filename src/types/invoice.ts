export interface BusinessSettings {
  name: string;
  street: string;
  postalCode: string;
  city: string;
  taxNumber?: string;
  taxNumberPending: boolean;
  email?: string;
  phone?: string;
  bankDetails: BankDetails;
  preferences: Preferences;
}

export interface BankDetails {
  accountHolder: string;
  iban: string;
  bic: string;
  bankName: string;
}

export interface Preferences {
  defaultPaymentTerms: number;
  isKleinunternehmer: boolean;
  invoicePrefix: string;
  startingInvoiceNumber: number;
  currency: string;
}

export interface Client {
  id: string;
  name: string;
  street: string;
  postalCode: string;
  city: string;
  email?: string;
  totalInvoiced: number;
}

export interface LineItem {
  id: string;
  description: string;
  subDescription?: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  total: number;
}

export type InvoiceStatus = 'draft' | 'pending' | 'paid' | 'overdue';

export interface Invoice {
  id: string;
  invoiceNumber: string;
  date: string;
  servicePeriodStart: string;
  servicePeriodEnd: string;
  clientId: string;
  client: Client;
  lineItems: LineItem[];
  subtotal: number;
  vatRate: number;
  vatAmount: number;
  total: number;
  paymentTerms: number;
  dueDate: string;
  status: InvoiceStatus;
  paidDate?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export const defaultBusinessSettings: BusinessSettings = {
  name: '',
  street: '',
  postalCode: '',
  city: '',
  taxNumber: '',
  taxNumberPending: false,
  email: '',
  phone: '',
  bankDetails: {
    accountHolder: '',
    iban: '',
    bic: '',
    bankName: '',
  },
  preferences: {
    defaultPaymentTerms: 14,
    isKleinunternehmer: true,
    invoicePrefix: `${new Date().getFullYear()}-`,
    startingInvoiceNumber: 1,
    currency: 'EUR',
  },
};

export const unitOptions = [
  { value: 'Tage', label: 'Days (Tage)' },
  { value: 'Stunden', label: 'Hours (Stunden)' },
  { value: 'Stück', label: 'Pieces (Stück)' },
  { value: 'Pauschal', label: 'Flat Rate (Pauschal)' },
];

export type ExpenseCategory =
  | 'subscription'
  | 'software'
  | 'hardware'
  | 'travel'
  | 'office'
  | 'marketing'
  | 'other';

export const expenseCategoryLabels: Record<ExpenseCategory, string> = {
  subscription: 'Subscription',
  software: 'Software',
  hardware: 'Hardware',
  travel: 'Travel',
  office: 'Office',
  marketing: 'Marketing',
  other: 'Other',
};

export const expenseCategoryOptions: { value: ExpenseCategory; label: string }[] =
  (Object.keys(expenseCategoryLabels) as ExpenseCategory[]).map((key) => ({
    value: key,
    label: expenseCategoryLabels[key],
  }));

export interface Expense {
  id: string;
  name: string;
  vendor: string;
  category: ExpenseCategory;
  amount: number;
  date: string;
  description?: string;
  receiptDataUrl?: string;
  receiptFileName?: string;
  isRecurring: boolean;
  recurringInterval?: 'monthly' | 'yearly';
  createdAt: string;
  updatedAt: string;
}
