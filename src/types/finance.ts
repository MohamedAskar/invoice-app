export const expenseCategories = [
  'software',
  'equipment',
  'office',
  'travel',
  'professional_services',
  'marketing',
  'telecommunications',
  'insurance',
  'training',
  'other',
] as const;

export type ExpenseCategory = (typeof expenseCategories)[number];

export const expenseStatuses = ['needs_review', 'booked', 'voided'] as const;
export type ExpenseStatus = (typeof expenseStatuses)[number];

export const expenseSources = ['upload', 'gmail'] as const;
export type ExpenseSource = (typeof expenseSources)[number];

export const expenseDocumentRoles = ['invoice', 'receipt', 'supporting'] as const;
export type ExpenseDocumentRole = (typeof expenseDocumentRoles)[number];

export interface ExpenseDocument {
  id: string;
  expenseId: string;
  documentRole: ExpenseDocumentRole;
  isPrimary: boolean;
  storagePath: string;
  filename: string;
  declaredMimeType?: string;
  detectedMimeType: 'application/pdf' | 'image/jpeg' | 'image/png';
  byteSize: number;
  sha256: string;
  createdAt: string;
  updatedAt: string;
}

export interface Expense {
  id: string;
  vendor: string;
  vendorInvoiceNumber?: string;
  category: ExpenseCategory;
  description?: string;
  expenseDate: string;
  paidDate?: string;
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
  currency: 'EUR';
  status: ExpenseStatus;
  source: ExpenseSource;
  notes?: string;
  voidedAt?: string;
  voidReason?: string;
  createdAt: string;
  updatedAt: string;
  documents: ExpenseDocument[];
  gmailReceivedAt?: string;
  gmailSenderDomain?: string;
  gmailFilterReasons?: string[];
  gmailMultiplePossibleInvoices?: boolean;
  gmailIgnoredCount?: number;
  gmailSkippedCount?: number;
  gmailReviewConfirmed?: boolean;
}

export interface ExpenseInput {
  vendor: string;
  vendorInvoiceNumber?: string;
  category: ExpenseCategory;
  description?: string;
  expenseDate: string;
  paidDate?: string;
  netAmount: number;
  vatAmount: number;
  grossAmount?: number;
  gmailReviewConfirmed?: boolean;
  currency: 'EUR';
  status: ExpenseStatus;
  notes?: string;
}
