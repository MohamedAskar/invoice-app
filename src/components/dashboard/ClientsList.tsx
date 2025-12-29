import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Invoice } from '@/types/invoice';
import { formatCurrency } from '@/lib/formatting';
import { Building2 } from 'lucide-react';

interface ClientsListProps {
  invoices: Invoice[];
}

interface ClientSummary {
  id: string;
  name: string;
  totalInvoiced: number;
  invoiceCount: number;
}

export function ClientsList({ invoices }: ClientsListProps) {
  // Calculate client summaries from invoices
  const clientMap = new Map<string, ClientSummary>();
  
  invoices
    .filter((inv) => inv.status !== 'draft')
    .forEach((invoice) => {
      const existing = clientMap.get(invoice.clientId);
      if (existing) {
        existing.totalInvoiced += invoice.total;
        existing.invoiceCount += 1;
      } else {
        clientMap.set(invoice.clientId, {
          id: invoice.clientId,
          name: invoice.client.name,
          totalInvoiced: invoice.total,
          invoiceCount: 1,
        });
      }
    });

  const topClients = Array.from(clientMap.values())
    .sort((a, b) => b.totalInvoiced - a.totalInvoiced)
    .slice(0, 5);

  return (
    <Card className="col-span-4 lg:col-span-1">
      <CardHeader>
        <CardTitle>Top Clients</CardTitle>
      </CardHeader>
      <CardContent>
        {topClients.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Building2 className="h-8 w-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">No clients yet</p>
          </div>
        ) : (
          <div className="space-y-4">
            {topClients.map((client) => (
              <div key={client.id} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted">
                    <span className="text-sm font-medium">
                      {client.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-medium leading-none">
                      {client.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {client.invoiceCount} invoice{client.invoiceCount !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
                <div className="text-sm font-medium">
                  {formatCurrency(client.totalInvoiced)}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

