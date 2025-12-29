import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DatePicker } from '@/components/ui/date-picker';
import { ResizablePanels } from '@/components/ui/resizable-panels';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LineItemEditor } from './LineItemEditor';
import { ClientSelector } from './ClientSelector';
import { InvoicePreview } from './InvoicePreview';
import { Invoice, Client, LineItem, InvoiceStatus } from '@/types/invoice';
import { useSettings } from '@/hooks/useSettings';
import { useClients } from '@/hooks/useClients';
import { useInvoices } from '@/hooks/useInvoices';
import { getNextInvoiceNumber } from '@/lib/storage';
import {
  calculateSubtotal,
  calculateVAT,
  calculateTotal,
  calculateDueDate,
} from '@/lib/calculations';
import { toISODate, parseDate } from '@/lib/formatting';
import { generatePDF } from '@/lib/pdf-generator';
import { toast } from '@/hooks/use-toast';
import { Save, Download, FileText } from 'lucide-react';

interface InvoiceFormProps {
  existingInvoice?: Invoice;
  mode: 'create' | 'edit';
}

export function InvoiceForm({ existingInvoice, mode }: InvoiceFormProps) {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const { clients, loadClients, addClient } = useClients();
  const { addInvoice, updateInvoice } = useInvoices();

  // Form state
  const [invoiceNumber, setInvoiceNumber] = useState(
    existingInvoice?.invoiceNumber || ''
  );
  const [invoiceDate, setInvoiceDate] = useState<Date | undefined>(
    existingInvoice?.date ? parseDate(existingInvoice.date) : new Date()
  );
  const [servicePeriodStart, setServicePeriodStart] = useState<Date | undefined>(
    existingInvoice?.servicePeriodStart
      ? parseDate(existingInvoice.servicePeriodStart)
      : new Date()
  );
  const [servicePeriodEnd, setServicePeriodEnd] = useState<Date | undefined>(
    existingInvoice?.servicePeriodEnd
      ? parseDate(existingInvoice.servicePeriodEnd)
      : new Date()
  );
  const [selectedClient, setSelectedClient] = useState<Client | null>(
    existingInvoice?.client || null
  );
  const [lineItems, setLineItems] = useState<LineItem[]>(
    existingInvoice?.lineItems || []
  );
  const [paymentTerms, setPaymentTerms] = useState(
    existingInvoice?.paymentTerms?.toString() ||
      settings.preferences.defaultPaymentTerms.toString()
  );
  const [notes, setNotes] = useState(existingInvoice?.notes || '');
  const [isKleinunternehmer, setIsKleinunternehmer] = useState(
    existingInvoice
      ? existingInvoice.vatRate === 0
      : settings.preferences.isKleinunternehmer
  );
  const [status, setStatus] = useState<InvoiceStatus>(
    existingInvoice?.status || 'pending'
  );

  // Load clients on mount
  useEffect(() => {
    loadClients();
  }, [loadClients]);

  // Set default invoice number for new invoices
  useEffect(() => {
    if (mode === 'create' && !invoiceNumber) {
      setInvoiceNumber(getNextInvoiceNumber());
    }
  }, [mode, invoiceNumber]);

  // Calculate totals
  const subtotal = calculateSubtotal(lineItems);
  const vatRate = isKleinunternehmer ? 0 : 19;
  const vatAmount = calculateVAT(subtotal, vatRate);
  const total = calculateTotal(subtotal, vatAmount);
  const dueDate = invoiceDate
    ? calculateDueDate(toISODate(invoiceDate), parseInt(paymentTerms))
    : '';

  // Check if business info is complete
  const isBusinessInfoComplete = () => {
    return (
      settings.name.trim() !== '' &&
      settings.street.trim() !== '' &&
      settings.postalCode.trim() !== '' &&
      settings.city.trim() !== ''
    );
  };

  // Build invoice object
  const buildInvoice = useCallback(
    (saveStatus: InvoiceStatus): Invoice => {
      return {
        id: existingInvoice?.id || crypto.randomUUID(),
        invoiceNumber,
        date: invoiceDate ? toISODate(invoiceDate) : '',
        servicePeriodStart: servicePeriodStart ? toISODate(servicePeriodStart) : '',
        servicePeriodEnd: servicePeriodEnd ? toISODate(servicePeriodEnd) : '',
        clientId: selectedClient?.id || '',
        client: selectedClient || {
          id: '',
          name: '',
          street: '',
          postalCode: '',
          city: '',
          totalInvoiced: 0,
        },
        lineItems,
        subtotal,
        vatRate,
        vatAmount,
        total,
        paymentTerms: parseInt(paymentTerms),
        dueDate,
        status: saveStatus,
        paidDate: existingInvoice?.paidDate,
        notes,
        createdAt: existingInvoice?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    },
    [
      existingInvoice,
      invoiceNumber,
      invoiceDate,
      servicePeriodStart,
      servicePeriodEnd,
      selectedClient,
      lineItems,
      subtotal,
      vatRate,
      vatAmount,
      total,
      paymentTerms,
      dueDate,
      notes,
    ]
  );

  // Preview invoice object
  const previewInvoice = buildInvoice(status);

  // Validate form
  const validate = (checkBusinessInfo: boolean = false): boolean => {
    if (checkBusinessInfo && !isBusinessInfoComplete()) {
      toast({ 
        title: 'Business info required', 
        description: 'Please complete your business information in Settings before saving or downloading invoices.', 
        variant: 'destructive' 
      });
      return false;
    }
    if (!invoiceNumber) {
      toast({ title: 'Error', description: 'Invoice number is required', variant: 'destructive' });
      return false;
    }
    if (!invoiceDate) {
      toast({ title: 'Error', description: 'Invoice date is required', variant: 'destructive' });
      return false;
    }
    if (!selectedClient) {
      toast({ title: 'Error', description: 'Please select a client', variant: 'destructive' });
      return false;
    }
    if (lineItems.length === 0) {
      toast({ title: 'Error', description: 'Please add at least one line item', variant: 'destructive' });
      return false;
    }
    return true;
  };

  // Save handlers
  const handleSave = (saveStatus: InvoiceStatus) => {
    if (!validate(true)) return;

    const invoice = buildInvoice(saveStatus);

    if (mode === 'create') {
      addInvoice(invoice);
      toast({ title: 'Success', description: 'Invoice created successfully' });
    } else {
      updateInvoice(invoice);
      toast({ title: 'Success', description: 'Invoice updated successfully' });
    }

    navigate('/invoices');
  };

  const handleSaveAndDownload = async () => {
    if (!validate(true)) return;

    const invoice = buildInvoice(status === 'draft' ? 'pending' : status);

    if (mode === 'create') {
      addInvoice(invoice);
    } else {
      updateInvoice(invoice);
    }

    try {
      await generatePDF(invoice, settings);
      toast({ title: 'Success', description: 'Invoice saved and PDF downloaded' });
      navigate('/invoices');
    } catch (error) {
      console.error('PDF generation error:', error);
      toast({ title: 'Error', description: 'Failed to generate PDF', variant: 'destructive' });
    }
  };

  const handleCreateClient = (client: Client) => {
    addClient(client);
  };

  // Form content
  const formContent = (
    <div className="space-y-6 pb-8">
      {/* Invoice Details */}
      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="text-lg">Invoice Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="invoiceNumber">Invoice Number</Label>
              <Input
                id="invoiceNumber"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                placeholder="e.g., 2025-001"
              />
            </div>
            <div>
              <Label>Invoice Date</Label>
              <DatePicker
                date={invoiceDate}
                onSelect={setInvoiceDate}
                placeholder="Select date"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Service Period Start</Label>
              <DatePicker
                date={servicePeriodStart}
                onSelect={setServicePeriodStart}
                placeholder="Start date"
              />
            </div>
            <div>
              <Label>Service Period End</Label>
              <DatePicker
                date={servicePeriodEnd}
                onSelect={setServicePeriodEnd}
                placeholder="End date"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="paymentTerms">Payment Terms (days)</Label>
              <Select value={paymentTerms} onValueChange={setPaymentTerms}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">7 days</SelectItem>
                  <SelectItem value="14">14 days</SelectItem>
                  <SelectItem value="30">30 days</SelectItem>
                  <SelectItem value="60">60 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="status">Status</Label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as InvoiceStatus)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <Switch
              id="kleinunternehmer"
              checked={isKleinunternehmer}
              onCheckedChange={setIsKleinunternehmer}
            />
            <Label htmlFor="kleinunternehmer" className="font-normal">
              Kleinunternehmer (No VAT)
            </Label>
          </div>
        </CardContent>
      </Card>

      {/* Client */}
      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="text-lg">Client</CardTitle>
        </CardHeader>
        <CardContent>
          <ClientSelector
            clients={clients}
            selectedClient={selectedClient}
            onSelectClient={setSelectedClient}
            onCreateClient={handleCreateClient}
          />
        </CardContent>
      </Card>

      {/* Line Items */}
      <Card className="rounded-lg">
        <CardContent className="pt-6">
          <LineItemEditor lineItems={lineItems} onChange={setLineItems} />
        </CardContent>
      </Card>

      {/* Notes */}
      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="text-lg">Additional Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any additional notes or terms..."
            rows={3}
            className="m-2"
            style={{ margin: '8px' }}
          />
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        <Button
          variant="outline"
          onClick={() => handleSave('draft')}
        >
          <FileText className="h-4 w-4" />
          Save as Draft
        </Button>
        <Button variant="outline" onClick={() => handleSave(status)}>
          <Save className="h-4 w-4" />
          Save
        </Button>
        <Button onClick={handleSaveAndDownload}>
          <Download className="h-4 w-4" />
          Save & Download PDF
        </Button>
      </div>
    </div>
  );

  // Preview content
  const previewContent = (
    <div className="pt-6">
      <InvoicePreview invoice={previewInvoice} settings={settings} />
    </div>
  );

  return (
    <ResizablePanels
      leftPanel={formContent}
      rightPanel={previewContent}
      defaultLeftWidth={40}
      minLeftWidth={30}
      maxLeftWidth={55}
      storageKey="invoice-form-panel-width"
      className="min-h-[calc(100vh-10rem)]"
    />
  );
}
