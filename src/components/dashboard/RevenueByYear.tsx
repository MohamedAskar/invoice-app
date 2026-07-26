import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Invoice } from '@/types/invoice';
import { formatCurrency } from '@/lib/formatting';
import { parseISO } from 'date-fns';

// Blue/amber rather than the more obvious green/amber: green and amber sit ~6 ΔE
// apart under protanopia, which is not enough to tell two adjacent fills apart.
// This pair clears every check against both the light and dark surface.
const PAID_COLOR = '#2563EB';
const OUTSTANDING_COLOR = '#D97706';

interface YearSummary {
  year: number;
  paid: number;
  outstanding: number;
  total: number;
  count: number;
}

function summarizeByYear(invoices: Invoice[]): YearSummary[] {
  const byYear = new Map<number, YearSummary>();

  for (const invoice of invoices) {
    // Drafts aren't income yet — same rule the client totals use.
    if (invoice.status === 'draft') continue;

    const year = parseISO(invoice.date).getFullYear();
    const entry =
      byYear.get(year) ?? { year, paid: 0, outstanding: 0, total: 0, count: 0 };

    if (invoice.status === 'paid') {
      entry.paid += invoice.total;
    } else {
      entry.outstanding += invoice.total;
    }
    entry.total += invoice.total;
    entry.count += 1;

    byYear.set(year, entry);
  }

  return [...byYear.values()].sort((a, b) => b.year - a.year);
}

interface RevenueByYearProps {
  invoices: Invoice[];
}

export function RevenueByYear({ invoices }: RevenueByYearProps) {
  const years = summarizeByYear(invoices);

  if (years.length === 0) {
    return null;
  }

  // Bars are scaled against the biggest year so years stay comparable to each
  // other, not each stretched to full width.
  const maxTotal = Math.max(...years.map((y) => y.total));

  return (
    <Card className="rounded-lg">
      <CardHeader>
        <CardTitle className="text-lg font-semibold">Revenue by Year</CardTitle>
        <CardDescription>
          Invoiced per calendar year, excluding drafts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Two series, so identity is never carried by colour alone. */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: PAID_COLOR }}
            />
            Paid
          </span>
          <span className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: OUTSTANDING_COLOR }}
            />
            Outstanding
          </span>
        </div>

        <div className="space-y-5">
          {years.map((year) => {
            const widthPct = (year.total / maxTotal) * 100;
            const paidShare = year.total > 0 ? (year.paid / year.total) * 100 : 0;

            return (
              <div key={year.year} className="space-y-2">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-sm font-medium tabular-nums">{year.year}</span>
                  <span className="text-sm font-semibold tabular-nums">
                    {formatCurrency(year.total)}
                  </span>
                </div>

                <div
                  className="h-2.5 w-full overflow-hidden rounded-sm bg-muted"
                  role="img"
                  aria-label={`${year.year}: ${formatCurrency(year.total)} invoiced across ${year.count} invoice${year.count === 1 ? '' : 's'} — ${formatCurrency(year.paid)} paid, ${formatCurrency(year.outstanding)} outstanding`}
                >
                  <div className="flex h-full gap-[2px]" style={{ width: `${widthPct}%` }}>
                    {year.paid > 0 && (
                      <div
                        className="h-full rounded-sm"
                        style={{ width: `${paidShare}%`, backgroundColor: PAID_COLOR }}
                      />
                    )}
                    {year.outstanding > 0 && (
                      <div
                        className="h-full flex-1 rounded-sm"
                        style={{ backgroundColor: OUTSTANDING_COLOR }}
                      />
                    )}
                  </div>
                </div>

                {/* The numbers are readable without reference to the bar at all. */}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
                  <span>{formatCurrency(year.paid)} paid</span>
                  <span>{formatCurrency(year.outstanding)} outstanding</span>
                  <span>
                    {year.count} invoice{year.count === 1 ? '' : 's'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
