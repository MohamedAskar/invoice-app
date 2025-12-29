import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Invoice } from '@/types/invoice';
import { formatCurrency } from '@/lib/formatting';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { format, parseISO, subMonths, startOfMonth, endOfMonth, isWithinInterval } from 'date-fns';

interface RevenueChartProps {
  invoices: Invoice[];
}

export function RevenueChart({ invoices }: RevenueChartProps) {
  // Generate last 6 months of data
  const months = Array.from({ length: 6 }, (_, i) => {
    const date = subMonths(new Date(), 5 - i);
    return {
      date,
      month: format(date, 'MMM'),
      start: startOfMonth(date),
      end: endOfMonth(date),
    };
  });

  const chartData = months.map(({ month, start, end }) => {
    const monthInvoices = invoices.filter((inv) => {
      if (inv.status === 'draft') return false;
      const invDate = parseISO(inv.date);
      return isWithinInterval(invDate, { start, end });
    });

    const revenue = monthInvoices
      .filter((inv) => inv.status === 'paid')
      .reduce((sum, inv) => sum + inv.total, 0);

    const pending = monthInvoices
      .filter((inv) => inv.status === 'pending' || inv.status === 'overdue')
      .reduce((sum, inv) => sum + inv.total, 0);

    return {
      month,
      revenue,
      pending,
    };
  });

  const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; dataKey: string }>; label?: string }) => {
    if (active && payload && payload.length) {
      return (
        <div className="rounded-lg border bg-background p-3 shadow-sm">
          <p className="font-medium">{label}</p>
          {payload.map((entry) => (
            <p key={entry.dataKey} className="text-sm text-muted-foreground">
              {entry.dataKey === 'revenue' ? 'Paid: ' : 'Pending: '}
              {formatCurrency(entry.value)}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <Card className="col-span-4">
      <CardHeader>
        <CardTitle>Revenue Overview</CardTitle>
      </CardHeader>
      <CardContent className="pl-2">
        <ResponsiveContainer width="100%" height={350}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="month"
              stroke="#888888"
              fontSize={12}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              stroke="#888888"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => `€${value}`}
            />
            <Tooltip content={<CustomTooltip />} />
            <Bar
              dataKey="revenue"
              fill="hsl(142.1 76.2% 36.3%)"
              radius={[4, 4, 0, 0]}
              name="Paid"
            />
            <Bar
              dataKey="pending"
              fill="hsl(47.9 95.8% 53.1%)"
              radius={[4, 4, 0, 0]}
              name="Pending"
            />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

