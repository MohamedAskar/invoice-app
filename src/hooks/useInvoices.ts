import { create } from 'zustand';
import { Invoice, InvoiceStatus } from '@/types/invoice';
import { 
  getInvoices, 
  saveInvoice, 
  deleteInvoice as deleteInvoiceFromStorage,
  getInvoiceById 
} from '@/lib/storage';
import { isAfter, parseISO } from 'date-fns';

interface InvoicesStore {
  invoices: Invoice[];
  loadInvoices: () => void;
  addInvoice: (invoice: Invoice) => void;
  updateInvoice: (invoice: Invoice) => void;
  deleteInvoice: (id: string) => void;
  getInvoice: (id: string) => Invoice | undefined;
  markAsPaid: (id: string) => void;
  updateStatuses: () => void;
}

function updateInvoiceStatus(invoice: Invoice): Invoice {
  if (invoice.status === 'paid' || invoice.status === 'draft') {
    return invoice;
  }
  
  const now = new Date();
  const dueDate = parseISO(invoice.dueDate);
  
  if (isAfter(now, dueDate)) {
    return { ...invoice, status: 'overdue' as InvoiceStatus };
  }
  
  return invoice;
}

export const useInvoices = create<InvoicesStore>((set, get) => ({
  invoices: [],
  loadInvoices: () => {
    const invoices = getInvoices().map(updateInvoiceStatus);
    set({ invoices });
  },
  addInvoice: (invoice: Invoice) => {
    saveInvoice(invoice);
    set((state) => ({ invoices: [...state.invoices, invoice] }));
  },
  updateInvoice: (invoice: Invoice) => {
    const updated = updateInvoiceStatus(invoice);
    saveInvoice(updated);
    set((state) => ({
      invoices: state.invoices.map((inv) => 
        inv.id === updated.id ? updated : inv
      ),
    }));
  },
  deleteInvoice: (id: string) => {
    deleteInvoiceFromStorage(id);
    set((state) => ({
      invoices: state.invoices.filter((inv) => inv.id !== id),
    }));
  },
  getInvoice: (id: string) => {
    const stored = getInvoiceById(id);
    if (stored) {
      return updateInvoiceStatus(stored);
    }
    return get().invoices.find((inv) => inv.id === id);
  },
  markAsPaid: (id: string) => {
    const invoice = get().getInvoice(id);
    if (invoice) {
      const updated: Invoice = {
        ...invoice,
        status: 'paid',
        paidDate: new Date().toISOString().split('T')[0],
        updatedAt: new Date().toISOString(),
      };
      saveInvoice(updated);
      set((state) => ({
        invoices: state.invoices.map((inv) => 
          inv.id === id ? updated : inv
        ),
      }));
    }
  },
  updateStatuses: () => {
    const invoices = get().invoices.map(updateInvoiceStatus);
    set({ invoices });
    invoices.forEach(saveInvoice);
  },
}));

