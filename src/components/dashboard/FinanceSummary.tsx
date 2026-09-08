import { AlertCircle, BadgeEuro, TrendingDown, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FinanceDashboardData } from '@/hooks/useFinanceDashboard';

interface FinanceSummaryProps {
  data: Pick<FinanceDashboardData, 'issuedRevenue' | 'paidRevenue' | 'bookedExpenses' | 'operatingProfit' | 'needsReviewCount'>;
}

// This card format deliberately uses the compact accounting notation from the
// acceptance criterion; other screens retain the established German formatter.
function formatDashboardCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'EUR',
    currencyDisplay: 'narrowSymbol',
  }).format(value);
}

const cards = [
  { key: 'issuedRevenue', title: 'Issued revenue', description: 'By invoice date', icon: TrendingUp },
  { key: 'paidRevenue', title: 'Paid revenue', description: 'By payment date', icon: BadgeEuro },
  { key: 'bookedExpenses', title: 'Booked expenses', description: 'Gross EUR for Kleinunternehmer', icon: TrendingDown },
] as const;

export function FinanceSummary({ data }: FinanceSummaryProps) {
  return (
    <section aria-label="Finance summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {cards.map(({ key, title, description, icon: Icon }) => (
        <Card key={key} className="rounded-lg">
          <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
            <div>
              <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
              <CardDescription className="mt-1 text-xs">{description}</CardDescription>
            </div>
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </CardHeader>
          <CardContent><p className="text-2xl font-black tracking-tight tabular-nums">{formatDashboardCurrency(data[key])}</p></CardContent>
        </Card>
      ))}

      <Card className="rounded-lg">
        <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
          <div>
            <CardTitle className="text-sm font-medium text-muted-foreground">Operating result (before tax)</CardTitle>
            <CardDescription className="mt-1 text-xs">Overview only, not a filed return — confirm with your tax advisor.</CardDescription>
          </div>
          <TrendingUp className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </CardHeader>
        <CardContent><p className="text-2xl font-black tracking-tight tabular-nums">{formatDashboardCurrency(data.operatingProfit)}</p></CardContent>
      </Card>

      <Card className="rounded-lg">
        <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
          <div>
            <CardTitle className="text-sm font-medium text-muted-foreground">Expenses requiring review</CardTitle>
            <CardDescription className="mt-1 text-xs">Excluded from profit</CardDescription>
          </div>
          <AlertCircle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-black tracking-tight tabular-nums">{data.needsReviewCount}</p>
          <p className="mt-1 text-xs text-muted-foreground">{data.needsReviewCount} expense{data.needsReviewCount === 1 ? '' : 's'} need review</p>
        </CardContent>
      </Card>
    </section>
  );
}
