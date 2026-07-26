import { create } from 'zustand';
import { Invoice, InvoiceStatus } from '@/types/invoice';
import {
  getInvoices,
  saveInvoice,
  deleteInvoice as deleteInvoiceFromStorage,
} from '@/lib/storage';
import { isAfter, parseISO } from 'date-fns';

interface InvoicesStore {
  invoices: Invoice[];
  loading: boolean;
  loadInvoices: () => Promise<void>;
  addInvoice: (invoice: Invoice) => Promise<void>;
  updateInvoice: (invoice: Invoice) => Promise<void>;
  deleteInvoice: (id: string) => Promise<void>;
  getInvoice: (id: string) => Invoice | undefined;
  markAsPaid: (id: string) => Promise<void>;
  updateStatuses: () => void;
}

// 'overdue' is a function of the due date and the current time, so it is derived
// on read rather than stored. The database keeps the status the user chose.
function updateInvoiceStatus(invoice: Invoice): Invoice {
  if (invoice.status === 'paid' || invoice.status === 'draft') {
    return invoice;
  }

  if (isAfter(new Date(), parseISO(invoice.dueDate))) {
    return { ...invoice, status: 'overdue' as InvoiceStatus };
  }

  return invoice;
}

export const useInvoices = create<InvoicesStore>((set, get) => ({
  invoices: [],
  loading: false,
  loadInvoices: async () => {
    set({ loading: true });
    const invoices = (await getInvoices()).map(updateInvoiceStatus);
    set({ invoices, loading: false });
  },
  addInvoice: async (invoice: Invoice) => {
    await saveInvoice(invoice);
    set((state) => ({ invoices: [...state.invoices, invoice] }));
  },
  updateInvoice: async (invoice: Invoice) => {
    await saveInvoice(invoice);
    const updated = updateInvoiceStatus(invoice);
    set((state) => ({
      invoices: state.invoices.map((inv) => (inv.id === updated.id ? updated : inv)),
    }));
  },
  deleteInvoice: async (id: string) => {
    await deleteInvoiceFromStorage(id);
    set((state) => ({
      invoices: state.invoices.filter((inv) => inv.id !== id),
    }));
  },
  getInvoice: (id: string) => get().invoices.find((inv) => inv.id === id),
  markAsPaid: async (id: string) => {
    const invoice = get().getInvoice(id);
    if (!invoice) return;

    const updated: Invoice = {
      ...invoice,
      status: 'paid',
      paidDate: new Date().toISOString().split('T')[0],
      updatedAt: new Date().toISOString(),
    };
    await saveInvoice(updated);
    set((state) => ({
      invoices: state.invoices.map((inv) => (inv.id === id ? updated : inv)),
    }));
  },
  updateStatuses: () => {
    set((state) => ({ invoices: state.invoices.map(updateInvoiceStatus) }));
  },
}));
