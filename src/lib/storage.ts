import {
  BusinessSettings,
  Client,
  Invoice,
  InvoiceStatus,
  LineItem,
  defaultBusinessSettings,
} from '@/types/invoice';
import { supabase } from './supabase';

// Postgres `numeric` can arrive as a string depending on the driver path, so
// every money field goes through this.
const num = (v: unknown): number => (v == null ? 0 : Number(v));

// ---------------------------------------------------------------- Settings

const SETTINGS_ROW_ID = 1;

interface SettingsRow {
  name: string;
  street: string;
  postal_code: string;
  city: string;
  tax_number: string | null;
  tax_number_pending: boolean;
  email: string | null;
  phone: string | null;
  bank_account_holder: string;
  bank_iban: string;
  bank_bic: string;
  bank_name: string;
  default_payment_terms: number;
  is_kleinunternehmer: boolean;
  invoice_prefix: string;
  starting_invoice_number: number;
  currency: string;
}

function toSettings(row: SettingsRow): BusinessSettings {
  return {
    name: row.name,
    street: row.street,
    postalCode: row.postal_code,
    city: row.city,
    taxNumber: row.tax_number ?? '',
    taxNumberPending: row.tax_number_pending,
    email: row.email ?? '',
    phone: row.phone ?? '',
    bankDetails: {
      accountHolder: row.bank_account_holder,
      iban: row.bank_iban,
      bic: row.bank_bic,
      bankName: row.bank_name,
    },
    preferences: {
      defaultPaymentTerms: row.default_payment_terms,
      isKleinunternehmer: row.is_kleinunternehmer,
      invoicePrefix: row.invoice_prefix,
      startingInvoiceNumber: row.starting_invoice_number,
      currency: row.currency,
    },
  };
}

export async function getSettings(): Promise<BusinessSettings> {
  const { data, error } = await supabase
    .from('business_settings')
    .select('*')
    .eq('id', SETTINGS_ROW_ID)
    .maybeSingle();

  if (error) {
    console.error('Error reading settings:', error);
    return defaultBusinessSettings;
  }
  return data ? toSettings(data as SettingsRow) : defaultBusinessSettings;
}

export async function saveSettings(settings: BusinessSettings): Promise<void> {
  const { error } = await supabase.from('business_settings').upsert({
    id: SETTINGS_ROW_ID,
    name: settings.name,
    street: settings.street,
    postal_code: settings.postalCode,
    city: settings.city,
    tax_number: settings.taxNumber || null,
    tax_number_pending: settings.taxNumberPending,
    email: settings.email || null,
    phone: settings.phone || null,
    bank_account_holder: settings.bankDetails.accountHolder,
    bank_iban: settings.bankDetails.iban,
    bank_bic: settings.bankDetails.bic,
    bank_name: settings.bankDetails.bankName,
    default_payment_terms: settings.preferences.defaultPaymentTerms,
    is_kleinunternehmer: settings.preferences.isKleinunternehmer,
    invoice_prefix: settings.preferences.invoicePrefix,
    starting_invoice_number: settings.preferences.startingInvoiceNumber,
    currency: settings.preferences.currency,
  });
  if (error) console.error('Error saving settings:', error);
}

// ----------------------------------------------------------------- Clients

interface ClientRow {
  id: string;
  name: string;
  street: string;
  postal_code: string;
  city: string;
  email: string | null;
  total_invoiced?: number | string | null;
}

function toClient(row: ClientRow): Client {
  return {
    id: row.id,
    name: row.name,
    street: row.street,
    postalCode: row.postal_code,
    city: row.city,
    email: row.email ?? '',
    totalInvoiced: num(row.total_invoiced),
  };
}

function fromClient(client: Client) {
  return {
    id: client.id,
    name: client.name,
    street: client.street,
    postal_code: client.postalCode,
    city: client.city,
    email: client.email || null,
  };
}

export async function getClients(): Promise<Client[]> {
  // totalInvoiced is computed by the view, so it can never drift from the invoices.
  const { data, error } = await supabase
    .from('clients_with_totals')
    .select('*')
    .order('name');

  if (error) {
    console.error('Error reading clients:', error);
    return [];
  }
  return (data as ClientRow[]).map(toClient);
}

export async function saveClient(client: Client): Promise<void> {
  const { error } = await supabase.from('clients').upsert(fromClient(client));
  if (error) console.error('Error saving client:', error);
}

export async function saveClients(clients: Client[]): Promise<void> {
  if (clients.length === 0) return;
  const { error } = await supabase.from('clients').upsert(clients.map(fromClient));
  if (error) console.error('Error saving clients:', error);
}

export async function deleteClient(id: string): Promise<void> {
  const { error } = await supabase.from('clients').delete().eq('id', id);
  if (error) console.error('Error deleting client:', error);
}

export async function getClientById(id: string): Promise<Client | undefined> {
  const { data, error } = await supabase
    .from('clients_with_totals')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('Error reading client:', error);
    return undefined;
  }
  return data ? toClient(data as ClientRow) : undefined;
}

// ---------------------------------------------------------------- Invoices

interface LineItemRow {
  id: string;
  position: number;
  description: string;
  sub_description: string | null;
  quantity: number | string;
  unit: string;
  unit_price: number | string;
  total: number | string;
}

interface InvoiceRow {
  id: string;
  invoice_number: string;
  date: string;
  service_period_start: string | null;
  service_period_end: string | null;
  client_id: string;
  client_name: string;
  client_street: string;
  client_postal_code: string;
  client_city: string;
  client_email: string | null;
  subtotal: number | string;
  vat_rate: number | string;
  vat_amount: number | string;
  total: number | string;
  payment_terms: number;
  due_date: string;
  status: InvoiceStatus;
  paid_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  invoice_line_items?: LineItemRow[];
}

const INVOICE_SELECT = '*, invoice_line_items(*)';

function toLineItem(row: LineItemRow): LineItem {
  return {
    id: row.id,
    description: row.description,
    subDescription: row.sub_description ?? '',
    quantity: num(row.quantity),
    unit: row.unit,
    unitPrice: num(row.unit_price),
    total: num(row.total),
  };
}

function toInvoice(row: InvoiceRow): Invoice {
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    date: row.date,
    servicePeriodStart: row.service_period_start ?? '',
    servicePeriodEnd: row.service_period_end ?? '',
    clientId: row.client_id,
    // The client as printed on the document, not as it looks today.
    client: {
      id: row.client_id,
      name: row.client_name,
      street: row.client_street,
      postalCode: row.client_postal_code,
      city: row.client_city,
      email: row.client_email ?? '',
      totalInvoiced: 0,
    },
    lineItems: (row.invoice_line_items ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map(toLineItem),
    subtotal: num(row.subtotal),
    vatRate: num(row.vat_rate),
    vatAmount: num(row.vat_amount),
    total: num(row.total),
    paymentTerms: row.payment_terms,
    dueDate: row.due_date,
    status: row.status,
    paidDate: row.paid_date ?? undefined,
    notes: row.notes ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getInvoices(): Promise<Invoice[]> {
  const { data, error } = await supabase
    .from('invoices')
    .select(INVOICE_SELECT)
    .order('date', { ascending: false });

  if (error) {
    console.error('Error reading invoices:', error);
    return [];
  }
  return (data as InvoiceRow[]).map(toInvoice);
}

export async function getInvoiceById(id: string): Promise<Invoice | undefined> {
  const { data, error } = await supabase
    .from('invoices')
    .select(INVOICE_SELECT)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('Error reading invoice:', error);
    return undefined;
  }
  return data ? toInvoice(data as InvoiceRow) : undefined;
}

export async function saveInvoice(invoice: Invoice): Promise<void> {
  const { error: invoiceError } = await supabase.from('invoices').upsert({
    id: invoice.id,
    invoice_number: invoice.invoiceNumber,
    date: invoice.date,
    service_period_start: invoice.servicePeriodStart || null,
    service_period_end: invoice.servicePeriodEnd || null,
    client_id: invoice.clientId,
    client_name: invoice.client.name,
    client_street: invoice.client.street,
    client_postal_code: invoice.client.postalCode,
    client_city: invoice.client.city,
    client_email: invoice.client.email || null,
    subtotal: invoice.subtotal,
    vat_rate: invoice.vatRate,
    vat_amount: invoice.vatAmount,
    total: invoice.total,
    payment_terms: invoice.paymentTerms,
    due_date: invoice.dueDate,
    status: invoice.status,
    paid_date: invoice.paidDate || null,
    notes: invoice.notes || null,
  });

  if (invoiceError) {
    console.error('Error saving invoice:', invoiceError);
    return;
  }

  // Line items have no stable identity across edits (rows get added, removed and
  // reordered freely in the form), so replace the set wholesale.
  const { error: deleteError } = await supabase
    .from('invoice_line_items')
    .delete()
    .eq('invoice_id', invoice.id);

  if (deleteError) {
    console.error('Error clearing line items:', deleteError);
    return;
  }

  if (invoice.lineItems.length === 0) return;

  const { error: itemsError } = await supabase.from('invoice_line_items').insert(
    invoice.lineItems.map((item, index) => ({
      id: item.id,
      invoice_id: invoice.id,
      position: index,
      description: item.description,
      sub_description: item.subDescription || null,
      quantity: item.quantity,
      unit: item.unit,
      unit_price: item.unitPrice,
      total: item.total,
    }))
  );
  if (itemsError) console.error('Error saving line items:', itemsError);
}

export async function saveInvoices(invoices: Invoice[]): Promise<void> {
  for (const invoice of invoices) {
    await saveInvoice(invoice);
  }
}

export async function deleteInvoice(id: string): Promise<void> {
  // invoice_line_items cascades on delete.
  const { error } = await supabase.from('invoices').delete().eq('id', id);
  if (error) console.error('Error deleting invoice:', error);
}

// ------------------------------------------------------- Export / import

export async function exportAllData(): Promise<string> {
  const [settings, invoices, clients] = await Promise.all([
    getSettings(),
    getInvoices(),
    getClients(),
  ]);
  return JSON.stringify(
    { settings, invoices, clients, exportedAt: new Date().toISOString() },
    null,
    2
  );
}

export async function importAllData(jsonString: string): Promise<boolean> {
  try {
    const data = JSON.parse(jsonString);
    if (data.settings) await saveSettings(data.settings);
    // Clients first — invoices reference them.
    if (data.clients) await saveClients(data.clients);
    if (data.invoices) await saveInvoices(data.invoices);
    return true;
  } catch (error) {
    console.error('Error importing data:', error);
    return false;
  }
}

export async function clearAllData(): Promise<void> {
  // Order matters: invoices reference clients.
  await supabase.from('invoice_line_items').delete().neq('invoice_id', null);
  await supabase.from('invoices').delete().neq('id', null);
  await supabase.from('clients').delete().neq('id', null);
  await supabase.from('business_settings').delete().eq('id', SETTINGS_ROW_ID);
}

// ------------------------------------------------------------ Numbering

export async function getNextInvoiceNumber(): Promise<string> {
  const [settings, invoices] = await Promise.all([getSettings(), getInvoices()]);
  const prefix = settings.preferences.invoicePrefix;

  const existingNumbers = invoices
    .map((inv) => {
      if (inv.invoiceNumber.startsWith(prefix)) {
        return parseInt(inv.invoiceNumber.slice(prefix.length), 10);
      }
      return 0;
    })
    .filter((n) => !isNaN(n));

  const maxNumber =
    existingNumbers.length > 0
      ? Math.max(...existingNumbers)
      : settings.preferences.startingInvoiceNumber - 1;

  return `${prefix}${String(maxNumber + 1).padStart(3, '0')}`;
}
