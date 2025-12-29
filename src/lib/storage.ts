import { BusinessSettings, Client, Invoice, defaultBusinessSettings } from '@/types/invoice';

const STORAGE_KEYS = {
  SETTINGS: 'invoice-app-settings',
  INVOICES: 'invoice-app-invoices',
  CLIENTS: 'invoice-app-clients',
} as const;

// Settings
export function getSettings(): BusinessSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (stored) {
      return { ...defaultBusinessSettings, ...JSON.parse(stored) };
    }
  } catch (error) {
    console.error('Error reading settings:', error);
  }
  return defaultBusinessSettings;
}

export function saveSettings(settings: BusinessSettings): void {
  try {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  } catch (error) {
    console.error('Error saving settings:', error);
  }
}

// Invoices
export function getInvoices(): Invoice[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.INVOICES);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.error('Error reading invoices:', error);
  }
  return [];
}

export function saveInvoices(invoices: Invoice[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify(invoices));
  } catch (error) {
    console.error('Error saving invoices:', error);
  }
}

export function getInvoiceById(id: string): Invoice | undefined {
  const invoices = getInvoices();
  return invoices.find((inv) => inv.id === id);
}

export function saveInvoice(invoice: Invoice): void {
  const invoices = getInvoices();
  const index = invoices.findIndex((inv) => inv.id === invoice.id);
  if (index >= 0) {
    invoices[index] = invoice;
  } else {
    invoices.push(invoice);
  }
  saveInvoices(invoices);
}

export function deleteInvoice(id: string): void {
  const invoices = getInvoices();
  const filtered = invoices.filter((inv) => inv.id !== id);
  saveInvoices(filtered);
}

// Clients
export function getClients(): Client[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.CLIENTS);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.error('Error reading clients:', error);
  }
  return [];
}

export function saveClients(clients: Client[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.CLIENTS, JSON.stringify(clients));
  } catch (error) {
    console.error('Error saving clients:', error);
  }
}

export function saveClient(client: Client): void {
  const clients = getClients();
  const index = clients.findIndex((c) => c.id === client.id);
  if (index >= 0) {
    clients[index] = client;
  } else {
    clients.push(client);
  }
  saveClients(clients);
}

export function getClientById(id: string): Client | undefined {
  const clients = getClients();
  return clients.find((c) => c.id === id);
}

// Data export/import
export function exportAllData(): string {
  const data = {
    settings: getSettings(),
    invoices: getInvoices(),
    clients: getClients(),
    exportedAt: new Date().toISOString(),
  };
  return JSON.stringify(data, null, 2);
}

export function importAllData(jsonString: string): boolean {
  try {
    const data = JSON.parse(jsonString);
    if (data.settings) {
      saveSettings(data.settings);
    }
    if (data.invoices) {
      saveInvoices(data.invoices);
    }
    if (data.clients) {
      saveClients(data.clients);
    }
    return true;
  } catch (error) {
    console.error('Error importing data:', error);
    return false;
  }
}

export function clearAllData(): void {
  localStorage.removeItem(STORAGE_KEYS.SETTINGS);
  localStorage.removeItem(STORAGE_KEYS.INVOICES);
  localStorage.removeItem(STORAGE_KEYS.CLIENTS);
}

// Get next invoice number
export function getNextInvoiceNumber(): string {
  const settings = getSettings();
  const invoices = getInvoices();
  
  const prefix = settings.preferences.invoicePrefix;
  const existingNumbers = invoices
    .map((inv) => {
      if (inv.invoiceNumber.startsWith(prefix)) {
        const numPart = inv.invoiceNumber.slice(prefix.length);
        return parseInt(numPart, 10);
      }
      return 0;
    })
    .filter((n) => !isNaN(n));
  
  const maxNumber = existingNumbers.length > 0 
    ? Math.max(...existingNumbers) 
    : settings.preferences.startingInvoiceNumber - 1;
  
  const nextNumber = maxNumber + 1;
  return `${prefix}${String(nextNumber).padStart(3, '0')}`;
}

