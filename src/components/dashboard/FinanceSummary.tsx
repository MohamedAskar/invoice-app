import { AlertCircle, ArrowDownRight, ArrowRight, BadgeEuro, ReceiptText, TrendingUp } from 'lucide-react';
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

export function FinanceSummary({ data }: FinanceSummaryProps) {
  const hasExpensesToReview = data.needsReviewCount > 0;

  return (
    <section aria-label="Finance summary" className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_19rem]">
      <Card className="rounded-lg border-primary/20 bg-primary/[0.03]">
        <CardHeader className="flex flex-row items-start justify-between gap-3 pb-5">
          <div>
            <CardTitle className="text-base font-semibold">Your year at a glance</CardTitle>
            <CardDescription className="mt-1">What you invoiced, what you spent, and what remains.</CardDescription>
          </div>
          <TrendingUp className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-[1fr_auto_1fr_auto_1.15fr] sm:items-end">
          <SummaryAmount label="Money invoiced" detail="Invoices dated this year" value={data.issuedRevenue} />
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

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
        <Card className="rounded-lg">
          <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
            <div>
              <CardTitle className="text-sm font-medium">Money received</CardTitle>
              <CardDescription className="mt-1 text-xs">Payments received this year</CardDescription>
            </div>
            <BadgeEuro className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-black tracking-tight tabular-nums">{formatDashboardCurrency(data.paidRevenue)}</p>
            <p className="mt-1 text-xs text-muted-foreground">This can differ from invoices sent when clients pay in another year.</p>
          </CardContent>
        </Card>

        <Card className="rounded-lg">
          <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
            <div>
              <CardTitle className="text-sm font-medium">Receipt review</CardTitle>
              <CardDescription className="mt-1 text-xs">Only booked receipts count as expenses.</CardDescription>
            </div>
            {hasExpensesToReview ? <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" /> : <ReceiptText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
          </CardHeader>
          <CardContent>
            {hasExpensesToReview ? <>
              <p className="text-2xl font-black tracking-tight tabular-nums">{data.needsReviewCount}</p>
              <p className="mt-1 text-xs text-muted-foreground">{`${data.needsReviewCount} receipt${data.needsReviewCount === 1 ? '' : 's'} waiting for review`}</p>
            </> : <>
              <p className="flex items-center gap-1.5 text-base font-semibold"><ArrowDownRight className="h-4 w-4 text-emerald-600" aria-hidden="true" />Nothing to review</p>
              <p className="mt-1 text-xs text-muted-foreground">Add a receipt when you have a new expense.</p>
            </>}
          </CardContent>
        </Card>
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
