import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { InvoiceForm } from '@/components/invoice/InvoiceForm';
import { useInvoices } from '@/hooks/useInvoices';
import { Invoice } from '@/types/invoice';
import { Button } from '@/components/ui/button';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import { AlertTriangle, ArrowLeft } from 'lucide-react';

export function EditInvoice() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getInvoice, loadInvoices } = useInvoices();
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
        <Alert variant="destructive">
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
    <div className="space-y-4">
      {invoice.status === 'paid' && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Warning</AlertTitle>
          <AlertDescription>
            This invoice has been marked as paid. Editing it may affect your records.
          </AlertDescription>
        </Alert>
      )}
      
      <div className="flex items-center gap-4 mb-4">
        <Link to={`/invoices/${invoice.id}`}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" />
            Back to Invoice
          </Button>
        </Link>
      </div>

      <InvoiceForm existingInvoice={invoice} mode="edit" />
    </div>
  );
}

