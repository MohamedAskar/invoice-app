import { AlertCircle, ArrowRight, BadgeEuro, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FinanceDashboardData, FinancePeriod } from '@/hooks/useFinanceDashboard';

interface FinanceSummaryProps {
  data: Pick<FinanceDashboardData, 'issuedRevenue' | 'paidRevenue' | 'bookedExpenses' | 'operatingProfit' | 'needsReviewCount'>;
  period: FinancePeriod;
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

export function FinanceSummary({ data, period }: FinanceSummaryProps) {
  const hasExpensesToReview = data.needsReviewCount > 0;
  const allTime = period === 'all';
  const invoicedDetail = allTime ? 'Invoices from all years' : `Invoices dated in ${period}`;
  const paidDetail = allTime ? 'Invoices marked paid in all years' : `Invoices marked paid in ${period}`;

  return (
    <section aria-label="Finance summary" className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_19rem] xl:items-start">
      <Card className="rounded-lg border-primary/20 bg-primary/[0.03]">
        <CardHeader className="flex flex-row items-start justify-between gap-3 pb-5">
          <div>
            <CardTitle className="text-base font-semibold">{allTime ? 'All your work' : `${period} at a glance`}</CardTitle>
            <CardDescription className="mt-1">What you invoiced, what you spent, and what remains.</CardDescription>
          </div>
          <TrendingUp className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-[1fr_auto_1fr_auto_1.15fr] sm:items-end">
          <SummaryAmount label="Money invoiced" detail={invoicedDetail} value={data.issuedRevenue} />
          <ArrowRight className="hidden h-4 w-4 text-muted-foreground sm:block" aria-hidden="true" />
          <SummaryAmount label="Business expenses" detail="Booked receipts only" value={data.bookedExpenses} />
          <ArrowRight className="hidden h-4 w-4 text-muted-foreground sm:block" aria-hidden="true" />
          <div className="border-t pt-4 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
            <p className="text-sm font-medium">Left after expenses</p>
            <p className="mt-1 text-3xl font-black tracking-tight tabular-nums">{formatDashboardCurrency(data.operatingProfit)}</p>
            <p className="mt-1 text-xs text-muted-foreground">Simple overview, before tax.</p>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card className="rounded-lg">
          <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
            <div>
              <CardTitle className="text-sm font-medium">Money received</CardTitle>
              <CardDescription className="mt-1 text-xs">{paidDetail}</CardDescription>
            </div>
            <BadgeEuro className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-black tracking-tight tabular-nums">{formatDashboardCurrency(data.paidRevenue)}</p>
            <p className="mt-1 text-xs text-muted-foreground">Uses the payment date, or the invoice date when none was saved.</p>
          </CardContent>
        </Card>

        {hasExpensesToReview && <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
          <div><p className="font-medium">{`${data.needsReviewCount} receipt${data.needsReviewCount === 1 ? '' : 's'} need review`}</p><p className="mt-1 text-xs text-amber-900/80">Review and book them before they appear in business expenses.</p></div>
        </div>}
      </div>
    </section>
  );
}

function SummaryAmount({ label, detail, value }: { label: string; detail: string; value: number }) {
  return <div>
    <p className="text-sm font-medium">{label}</p>
    <p className="mt-1 text-2xl font-black tracking-tight tabular-nums">{formatDashboardCurrency(value)}</p>
    <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
  </div>;
}
