import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency } from '@/lib/formatting';
import { FinanceMonth } from '@/hooks/useFinanceDashboard';

export function IncomeExpenseChart({ months }: { months: FinanceMonth[] }) {
  return (
    <Card className="rounded-lg">
      <CardHeader>
        <CardTitle className="text-lg font-semibold">Monthly income and expenses</CardTitle>
        <CardDescription>Issued revenue, booked gross expenses, and operating result.</CardDescription>
      </CardHeader>
      <CardContent className="h-[320px] pl-0 sm:h-[360px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={months} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
            <YAxis tickLine={false} axisLine={false} fontSize={12} tickFormatter={(value) => `€${value}`} width={58} />
            <Tooltip formatter={(value: number) => formatCurrency(value)} />
            <Legend wrapperStyle={{ fontSize: '12px' }} />
            <Bar dataKey="issuedRevenue" name="Issued revenue" fill="#2563EB" radius={[3, 3, 0, 0]} />
            <Bar dataKey="bookedExpenses" name="Booked expenses" fill="#D97706" radius={[3, 3, 0, 0]} />
            <Bar dataKey="operatingProfit" name="Operating result" fill="#0F766E" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
