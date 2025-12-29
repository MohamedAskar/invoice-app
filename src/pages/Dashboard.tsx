import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useInvoices } from '@/hooks/useInvoices';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatCurrency, formatCurrencyCompact, formatDate } from '@/lib/formatting';
import { InvoiceStatus } from '@/types/invoice';
import { 
  MoreHorizontal, 
  Eye, 
  Pencil, 
  CheckCircle,
  TrendingUp,
  Clock,
  Euro,
  FileText,
  Plus
} from 'lucide-react';
import { isThisMonth, parseISO } from 'date-fns';

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

export function Dashboard() {
  const { invoices, loadInvoices, markAsPaid, updateStatuses } = useInvoices();

  useEffect(() => {
    loadInvoices();
    updateStatuses();
  }, [loadInvoices, updateStatuses]);

  // Calculate stats
  const totalRevenue = invoices
    .filter((inv) => inv.status === 'paid')
    .reduce((sum, inv) => sum + inv.total, 0);

  const thisMonthRevenue = invoices
    .filter((inv) => inv.status === 'paid' && isThisMonth(parseISO(inv.date)))
    .reduce((sum, inv) => sum + inv.total, 0);

  const pendingInvoices = invoices.filter(
    (inv) => inv.status === 'pending' || inv.status === 'overdue'
  );
  const pendingCount = pendingInvoices.length;
  const pendingRevenue = pendingInvoices.reduce((sum, inv) => sum + inv.total, 0);

  // Recent invoices
  const recentInvoices = [...invoices]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  const stats = [
    {
      title: 'Total Revenue',
      value: formatCurrencyCompact(totalRevenue),
      icon: Euro,
    },
    {
      title: 'This Month',
      value: formatCurrencyCompact(thisMonthRevenue),
      icon: TrendingUp,
    },
    {
      title: 'Pending Invoices',
      value: pendingCount.toString(),
      icon: Clock,
    },
    {
      title: 'Pending Revenue',
      value: formatCurrencyCompact(pendingRevenue),
      icon: FileText,
    },
  ];

  return (
    <div className="space-y-8">
      {/* Stats */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.title} className="rounded-lg">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-[32px] font-black tracking-tight">{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Recent Invoices */}
      <Card className="rounded-lg">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg font-semibold">Recent Invoices</CardTitle>
          {invoices.length > 0 && (
            <Link to="/invoices">
              <Button variant="ghost" size="sm">
                View All
              </Button>
            </Link>
          )}
        </CardHeader>
        <CardContent>
          {recentInvoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
                <FileText className="h-8 w-8 text-muted-foreground" />
              </div>
              <CardTitle className="mb-2">No invoices yet</CardTitle>
              <CardDescription className="text-center mb-4">
                Create your first invoice to get started.
              </CardDescription>
              <Button asChild className="rounded-lg">
                <Link to="/invoices/new">
                  <Plus className="h-4 w-4" />
                  Create Invoice
                </Link>
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentInvoices.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-medium">
                      {invoice.invoiceNumber}
                    </TableCell>
                    <TableCell>{invoice.client.name}</TableCell>
                    <TableCell>{formatDate(invoice.date)}</TableCell>
                    <TableCell>{formatCurrency(invoice.total)}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariants[invoice.status]} className="rounded-md">
                        {statusLabels[invoice.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="rounded-lg">
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">Actions</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="rounded-lg">
                          <DropdownMenuItem asChild>
                            <Link to={`/invoices/${invoice.id}`}>
                              <Eye className="h-4 w-4" />
                              View
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link to={`/invoices/${invoice.id}/edit`}>
                              <Pencil className="h-4 w-4" />
                              Edit
                            </Link>
                          </DropdownMenuItem>
                          {invoice.status !== 'paid' && invoice.status !== 'draft' && (
                            <DropdownMenuItem onClick={() => markAsPaid(invoice.id)}>
                              <CheckCircle className="h-4 w-4" />
                              Mark as Paid
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
