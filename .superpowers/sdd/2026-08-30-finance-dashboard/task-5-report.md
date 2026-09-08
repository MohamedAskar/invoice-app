# Task 5 report — finance dashboard totals and filters

## Status

Completed locally. No schema changes or deployment were performed.

## Implementation

- Added a selected-year dashboard calculation hook with documented rules:
  issued revenue uses the invoice issue date; paid revenue uses `paidDate`; and
  booked expenses use `accountingDateForExpense` (paid date where present,
  otherwise the expense date).
- The EUR Kleinunternehmer overview uses the gross amount of only booked
  expenses. Draft invoices plus review and voided expenses never affect the
  operating result. The calculation returns all twelve monthly issued-revenue,
  booked-expense, and operating-result values.
- Replaced the prior dashboard statistics with five responsive cards, a
  current-year selector, and a monthly grouped chart. The operating-result card
  is explicitly before tax and carries the tax-advisor disclaimer.
- Replaced the split expense lists with accessible filters for accounting year,
  category, status, source, vendor/full-text search, and accounting-date sort.
  The table retains net, VAT, and gross values; its footer sums gross amounts
  for only the filtered booked rows.

## Test-first evidence

Created `src/components/dashboard/FinanceSummary.test.tsx` before the summary
component, then ran:

```text
npm run test -- src/components/dashboard/FinanceSummary.test.tsx
```

It failed as expected because `./FinanceSummary` did not exist:

```text
Error: Failed to resolve import "./FinanceSummary"
```

After implementation, the same focused test passes.

## Verification

- `npm run test -- src/components/dashboard/FinanceSummary.test.tsx` — passed,
  1 file / 1 test.
- `npm run build` — passed.
- `npm run lint` — retains only the established baseline errors in
  `src/hooks/use-toast.ts` and `src/main.tsx`, and the existing Fast Refresh
  warnings in `badge.tsx` and `button.tsx`. This task adds no lint diagnostics.
- `npm run test` — 10 files / 32 tests passed; the pre-existing
  `src/lib/finance-storage.test.ts` has 4 failures in its archive-cleanup and
  draft-deletion mock paths. This task does not modify finance storage.
- `git diff --check` — passed.

## Commit

`feat: add income and expense dashboard`
