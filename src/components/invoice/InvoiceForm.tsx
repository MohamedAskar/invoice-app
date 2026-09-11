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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
import { getInvoiceById, getNextInvoiceNumber } from '@/lib/storage';
import { prepareInvoiceArchive } from '@/lib/finance-storage';
import {
  calculateSubtotal,
  calculateVAT,
  calculateTotal,
  calculateDueDate,
} from '@/lib/calculations';
import { toISODate, parseDate } from '@/lib/formatting';
import { archiveIssuedInvoicePdf } from '@/lib/pdf-generator';
import { toast } from '@/hooks/use-toast';
import { Save, FileText, RefreshCw } from 'lucide-react';
import { getInitialInvoiceStatus } from '@/lib/invoice-status';
import { getInvoiceSaveStatus } from '@/lib/invoice-status';

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
    getInitialInvoiceStatus(existingInvoice?.persistedStatus ? { status: existingInvoice.persistedStatus } : existingInvoice)
  );
  const [statusChanged, setStatusChanged] = useState(false);
  const [archiveRetryInvoice, setArchiveRetryInvoice] = useState<Invoice | null>(
    existingInvoice?.archiveIntent === 'issue' && !existingInvoice.pdfStoragePath ? existingInvoice : null
  );
  const [isArchiving, setIsArchiving] = useState(false);
  const [backfillDialogOpen, setBackfillDialogOpen] = useState(false);
  const isArchivedInvoice = Boolean(existingInvoice?.pdfStoragePath);

  // Load clients on mount
  useEffect(() => {
    loadClients();
  }, [loadClients]);

  // Set default invoice number for new invoices
  useEffect(() => {
    if (mode === 'create' && !invoiceNumber) {
      getNextInvoiceNumber().then(setInvoiceNumber);
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
        status: getInvoiceSaveStatus({
          displayStatus: saveStatus,
          persistedStatus: existingInvoice?.persistedStatus,
          statusChanged,
        }),
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
      statusChanged,
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
  const saveInvoice = async (invoice: Invoice) => {
    if (mode === 'create') {
      await addInvoice(invoice);
    } else {
      await updateInvoice(invoice);
    }
  };

  const handleSaveDraft = async () => {
    if (!validate(true)) return;

    const invoice = buildInvoice('draft');
    try {
      await saveInvoice(invoice);
      toast({ title: 'Success', description: 'Draft saved' });
      navigate('/invoices');
    } catch (error) {
      console.error('Invoice save error:', error);
      toast({ title: 'Error', description: 'Failed to save invoice', variant: 'destructive' });
    }
  };

  const handleIssueInvoice = async () => {
    if (!validate(true)) return;

    if (isArchiving) return;
    setIsArchiving(true);
    const draftInvoice = buildInvoice('draft');
    let issuedInvoice: Invoice | null = null;
    try {
      await saveInvoice(draftInvoice);
      // One nested SELECT reads the stored invoice, lines and their revision.
      // Render that snapshot, even if another tab edited during the save.
      const snapshot = await getInvoiceById(draftInvoice.id);
      if (!snapshot) throw new Error('Unable to reload the saved invoice');
      await prepareInvoiceArchive(snapshot.id, snapshot.contentRevision, 'issue');
      issuedInvoice = { ...snapshot, status: 'pending', persistedStatus: 'pending', archiveIntent: 'issue' };
      setStatus('pending');
      setArchiveRetryInvoice(issuedInvoice);
      await archiveIssuedInvoicePdf(issuedInvoice, settings);
      setArchiveRetryInvoice(null);
      toast({ title: 'Success', description: 'Invoice issued and PDF archived' });
      navigate('/invoices');
    } catch (error) {
      console.error('Invoice issue error:', error);
      setArchiveRetryInvoice(issuedInvoice);
      toast({
        title: issuedInvoice ? 'PDF archive missing' : 'Error',
        description: issuedInvoice
          ? 'The invoice is pending. Retry archival to complete its missing PDF archive.'
          : 'Failed to save invoice before issuing it.',
        variant: 'destructive',
      });
    } finally {
      setIsArchiving(false);
    }
  };

  const handleRetryArchive = async () => {
    if (!archiveRetryInvoice || isArchiving) return;
    setIsArchiving(true);
    try {
      const snapshot = await getInvoiceById(archiveRetryInvoice.id);
      if (!snapshot) throw new Error('Unable to reload the pending invoice');
      if (!snapshot.pdfStoragePath) {
        await prepareInvoiceArchive(snapshot.id, snapshot.contentRevision, 'issue');
        await archiveIssuedInvoicePdf(snapshot, settings);
      }
      setArchiveRetryInvoice(null);
      toast({ title: 'Success', description: 'Invoice issued and PDF archived' });
      navigate('/invoices');
    } catch (error) {
      console.error('Invoice archive retry error:', error);
      toast({
        title: 'PDF archive missing',
        description: 'The invoice remains pending with a missing PDF archive. Retry when the connection is available.',
        variant: 'destructive',
      });
    } finally {
      setIsArchiving(false);
    }
  };

  const handleBackfillArchivedPdf = async () => {
    if (!existingInvoice || !validate(true) || isArchiving) return;
    setIsArchiving(true);

    const invoice = buildInvoice(status);
    try {
      // Persist the exact values used for the immutable document before it is
      // rendered. The archive operation refuses any existing archive path.
      await updateInvoice(invoice);
      const snapshot = await getInvoiceById(invoice.id);
      if (!snapshot) throw new Error('Unable to reload the saved invoice');
      await prepareInvoiceArchive(snapshot.id, snapshot.contentRevision, 'backfill');
      await archiveIssuedInvoicePdf(snapshot, settings, 'backfill');
      toast({ title: 'Success', description: 'Archived PDF backfilled' });
      setBackfillDialogOpen(false);
      navigate('/invoices');
    } catch (error) {
      console.error('Invoice archive backfill error:', error);
      toast({
        title: 'PDF archive missing',
        description: 'The invoice was not changed to an archived PDF. Retry backfill when ready.',
        variant: 'destructive',
      });
    } finally {
      setIsArchiving(false);
    }
  };

  const handleSaveChanges = async () => {
    if (!validate(true)) return;

    const invoice = buildInvoice(status);

    try {
      await saveInvoice(invoice);
      toast({ title: 'Success', description: 'Invoice changes saved' });
      navigate('/invoices');
    } catch (error) {
      console.error('Invoice save error:', error);
      toast({ title: 'Error', description: 'Failed to save invoice', variant: 'destructive' });
    }
  };

  const handleCreateClient = (client: Client) => {
    addClient(client);
  };

  // Form content
  const formContent = (
    <div className="space-y-6 pb-8">
      {archiveRetryInvoice && (
        <Alert variant="destructive" className="rounded-lg">
          <AlertTitle>PDF archive missing</AlertTitle>
          <AlertDescription>
            The invoice is pending, but its PDF archive is missing. Retry PDF archival to complete it.
          </AlertDescription>
        </Alert>
      )}
      {isArchivedInvoice && (
        <Alert>
          <AlertTitle>Issued invoice archived</AlertTitle>
          <AlertDescription>
            Its PDF and financial content are immutable so annual exports always match the archived original. Record any correction with a separate invoice or credit-note workflow.
          </AlertDescription>
        </Alert>
      )}
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
                onValueChange={(v) => {
                  setStatus(v as InvoiceStatus);
                  setStatusChanged(true);
                }}
                disabled={mode === 'create'}
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
        {!archiveRetryInvoice && (mode === 'create' || existingInvoice?.persistedStatus === 'draft' || existingInvoice?.status === 'draft') && (
          <>
            <Button variant="outline" onClick={handleSaveDraft} disabled={isArchiving}>
              <FileText className="h-4 w-4" />
              Save draft
            </Button>
            <Button onClick={handleIssueInvoice} disabled={isArchiving}>
              <Save className="h-4 w-4" />
              Issue invoice
            </Button>
          </>
        )}
        {existingInvoice && existingInvoice.status !== 'draft' && !isArchivedInvoice && (
          <>
            <Button variant="outline" onClick={handleSaveChanges} disabled={isArchiving}>
              <Save className="h-4 w-4" />
              Save changes
            </Button>
            {!existingInvoice.pdfStoragePath && !archiveRetryInvoice && (
              <Button variant="outline" disabled={isArchiving} onClick={() => setBackfillDialogOpen(true)}>
                <FileText className="h-4 w-4" />
                Backfill archived PDF
              </Button>
            )}
          </>
        )}
        {archiveRetryInvoice && (
          <Button variant="destructive" onClick={handleRetryArchive} disabled={isArchiving}>
            <RefreshCw className="h-4 w-4" />
            Retry PDF archive
          </Button>
        )}
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
    <>
      <ResizablePanels
        leftPanel={formContent}
        rightPanel={previewContent}
        defaultLeftWidth={40}
        minLeftWidth={30}
        maxLeftWidth={55}
        storageKey="invoice-form-panel-width"
        className="min-h-[calc(100vh-10rem)]"
      />
      <AlertDialog open={backfillDialogOpen} onOpenChange={setBackfillDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Backfill this invoice's archived PDF?</AlertDialogTitle>
            <AlertDialogDescription>
              This creates an immutable PDF from the invoice as it is currently saved. It cannot replace an existing archive.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleBackfillArchivedPdf}>
              Backfill archived PDF
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
