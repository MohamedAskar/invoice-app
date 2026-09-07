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
  // `overdue` may be derived for display. This retains the database lifecycle
  // status so an ordinary edit never writes a display-only status back.
  persistedStatus?: InvoiceStatus;
  // Present only after a PDF has been frozen in private issued-invoice storage.
  // It is never written through the ordinary invoice save path.
  pdfStoragePath?: string;
  pdfSha256?: string;
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
