import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { InvoicePreview } from '@/components/invoice/InvoicePreview';
import { useInvoices } from '@/hooks/useInvoices';
import { useSettings } from '@/hooks/useSettings';
import { Invoice, InvoiceStatus } from '@/types/invoice';
import { generatePDF } from '@/lib/pdf-generator';
import { toast } from '@/hooks/use-toast';
import { 
  ArrowLeft, 
  Pencil, 
  Download, 
  CheckCircle, 
  Trash2,
  AlertTriangle 
} from 'lucide-react';

const statusVariants: Record<InvoiceStatus, 'default' | 'secondary' | 'success' | 'warning' | 'destructive'> = {
  draft: 'secondary',
  pending: 'warning',
  paid: 'success',
  overdue: 'destructive',
};

const statusLabels: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  pending: 'Pending',
  paid: 'Paid',
  overdue: 'Overdue',
};

export function ViewInvoice() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getInvoice, loadInvoices, markAsPaid, deleteInvoice } = useInvoices();
  const { settings } = useSettings();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadInvoices();
    if (id) {
      const found = getInvoice(id);
      if (found) {
        setInvoice(found);
      }
    }
    setLoading(false);
  }, [id, getInvoice, loadInvoices]);

  const handleDownloadPDF = async () => {
    if (!invoice) return;
    try {
      await generatePDF(invoice, settings);
      toast({ title: 'Success', description: 'PDF downloaded successfully' });
    } catch (error) {
      console.error('PDF generation error:', error);
      toast({ title: 'Error', description: 'Failed to generate PDF', variant: 'destructive' });
    }
  };

  const handleMarkAsPaid = () => {
    if (!invoice) return;
    markAsPaid(invoice.id);
    setInvoice({ ...invoice, status: 'paid', paidDate: new Date().toISOString().split('T')[0] });
    toast({ title: 'Success', description: 'Invoice marked as paid' });
  };

  const handleDelete = () => {
    if (!invoice) return;
    deleteInvoice(invoice.id);
    toast({ title: 'Success', description: 'Invoice deleted' });
    navigate('/invoices');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive" className="rounded-lg">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Invoice not found</AlertTitle>
          <AlertDescription>
            The invoice you're looking for doesn't exist or has been deleted.
          </AlertDescription>
        </Alert>
        <Button variant="outline" onClick={() => navigate('/invoices')}>
          <ArrowLeft className="h-4 w-4" />
          Back to Invoices
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div>
            <h2 className="text-2xl font-semibold">{invoice.invoiceNumber}</h2>
            <p className="text-sm text-muted-foreground">
              {invoice.client.name}
            </p>
          </div>
          <Badge variant={statusVariants[invoice.status]} className="rounded-md">
            {statusLabels[invoice.status]}
          </Badge>
        </div>

        <div className="flex flex-wrap gap-2">
          {invoice.status !== 'paid' && invoice.status !== 'draft' && (
            <Button variant="outline" onClick={handleMarkAsPaid}>
              <CheckCircle className="h-4 w-4" />
              Mark as Paid
            </Button>
          )}
          <Button variant="outline" onClick={handleDownloadPDF}>
            <Download className="h-4 w-4" />
            Download PDF
          </Button>
          <Link to={`/invoices/${invoice.id}/edit`}>
            <Button variant="outline">
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
          </Link>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Invoice?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. This will permanently delete
                  invoice {invoice.invoiceNumber}.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete}>
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Preview */}
      <div className="max-w-4xl">
        <InvoicePreview invoice={invoice} settings={settings} />
      </div>
    </div>
  );
}
