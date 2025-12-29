import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Invoice } from '@/types/invoice';
import { formatCurrency, formatCurrencyCompact } from '@/lib/formatting';
import { 
  DollarSign, 
  Clock, 
  CheckCircle, 
  Users 
} from 'lucide-react';
import { isThisMonth, parseISO } from 'date-fns';

interface InvoiceStatsProps {
  invoices: Invoice[];
}

export function InvoiceStats({ invoices }: InvoiceStatsProps) {
  // Calculate stats
  const thisMonthInvoices = invoices.filter(
    (inv) => inv.status !== 'draft' && isThisMonth(parseISO(inv.date))
  );
  
  const totalRevenueThisMonth = thisMonthInvoices
    .filter((inv) => inv.status === 'paid')
    .reduce((sum, inv) => sum + inv.total, 0);
  
  const pendingInvoices = invoices.filter(
    (inv) => inv.status === 'pending' || inv.status === 'overdue'
  );
  const pendingAmount = pendingInvoices.reduce((sum, inv) => sum + inv.total, 0);
  
  const paidThisMonth = thisMonthInvoices.filter((inv) => inv.status === 'paid');
  const paidThisMonthAmount = paidThisMonth.reduce((sum, inv) => sum + inv.total, 0);
  
  const uniqueClients = new Set(invoices.map((inv) => inv.clientId)).size;

  const stats = [
    {
      title: 'Revenue This Month',
      value: formatCurrencyCompact(totalRevenueThisMonth),
      description: 'Total paid invoices',
      icon: DollarSign,
      iconBg: 'bg-emerald-100',
      iconColor: 'text-emerald-600',
    },
    {
      title: 'Pending Invoices',
      value: pendingInvoices.length.toString(),
      description: formatCurrency(pendingAmount) + ' outstanding',
      icon: Clock,
      iconBg: 'bg-amber-100',
      iconColor: 'text-amber-600',
    },
    {
      title: 'Paid This Month',
      value: paidThisMonth.length.toString(),
      description: formatCurrency(paidThisMonthAmount),
      icon: CheckCircle,
      iconBg: 'bg-blue-100',
      iconColor: 'text-blue-600',
    },
    {
      title: 'Total Clients',
      value: uniqueClients.toString(),
      description: 'Unique clients',
      icon: Users,
      iconBg: 'bg-purple-100',
      iconColor: 'text-purple-600',
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <Card key={stat.title}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {stat.title}
            </CardTitle>
            <div className={`rounded-lg p-2 ${stat.iconBg}`}>
              <stat.icon className={`h-4 w-4 ${stat.iconColor}`} />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-black">{stat.value}</div>
            <p className="text-xs text-muted-foreground">{stat.description}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

