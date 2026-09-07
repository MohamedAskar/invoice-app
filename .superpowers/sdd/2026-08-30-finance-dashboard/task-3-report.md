# Task 3 report — manual expense capture and review

## Design plan (before implementation)

- **Palette:** retain the product's paper-white `#FFFFFF`, ink `#0A0A0B`, quiet
  graphite `#75757D`, soft field gray `#F5F5F6`, border `#E5E5E7`, and the
  existing destructive red for irreversible actions. Expense status is carried
  by concise badges, not a second decorative palette.
- **Type:** retain the application sans-serif and its existing compact
  `text-sm` labels / `text-lg` section titles. Amounts use tabular-looking
  right alignment and a EUR suffix so review is fast without introducing a
  dashboard-display font.
- **Layout:** a left-aligned working sheet: title and one clear “Add receipt”
  action, review work above booked history, then a two-column desktop editor
  with fields on the left and the actual receipt/document evidence on the
  right. It collapses to one column on narrow screens.
- **Principles:** make the document the proof, make lifecycle state explicit,
  and reserve visual emphasis for the book action. No metric tiles, gradients,
  fake reporting chrome, or ornamental status visuals.

## Design self-critique

This stays specific to a freelance tax workflow: the receipt and its booking
state lead the page, amounts are reviewable in EUR, and booked evidence is
visibly locked. The existing restrained product tokens and sidebar rhythm are
kept, avoiding a generic analytics dashboard or an unrelated visual rebrand.

## TDD evidence

1. Added `src/components/expenses/ExpenseForm.test.tsx` before the component
   existed, containing the specified “keeps a new uploaded receipt in review
   until the user books it” behavior.
2. Ran `npm run test -- src/components/expenses/ExpenseForm.test.tsx` before
   production UI existed. It failed as expected at Vite import analysis:
   `Failed to resolve import "./ExpenseForm"` (0 tests collected).
3. Implemented the smallest accessible form path for that behavior, then ran
   the same command again. It passed: 1 file / 1 test.
4. Expanded the form in green steps into the complete React Hook Form + Zod
   EUR capture flow, with document selection, clear review/booking feedback,
   calculated gross amount, and the review versus booked lifecycle action.

## Implementation

- Added the Zustand expense store. Every persistence call awaits its storage
  operation before updating local state; the store exposes loading/busy/error
  state plus `loadExpenses`, `createExpense`, `updateExpense`,
  `deleteDraftExpense`, `bookExpense`, and `voidExpense`.
- Added `/expenses`, `/expenses/new`, and `/expenses/:id/edit` under the
  existing authenticated `Layout`. The sidebar now places **Expenses** with a
  Receipt icon immediately after Invoices.
- The list prioritizes the review queue, separates booked records, and leads
  empty state users to add a receipt. Booked and voided records show a clear
  read-only treatment.
- Added a signed-URL receipt panel. It previews PDF/image documents, labels
  source and role, lets review drafts preview/re-open/add/replace/remove, and
  reports retained-object cleanup failures directly. Booked and voided evidence
  is read-only.
- Added a local-only follow-on migration
  `20260903184919_authorize_orphan_review_receipt_cleanup.sql`, authorized by
  the controller after the Task 2 policy conflict was identified. It replaces
  the former document-object DELETE policy with one that permits only the
  authenticated owner to remove an orphaned object for their own
  `needs_review` expense. It denies referenced objects, booked/voided expense
  objects, and other users' objects.
- Updated document and full-draft cleanup to remove the database reference
  first and only then call Storage. The original document and path are retained
  for a safe retry if the Storage cleanup fails; a failed cleanup leaves the
  receipt row gone but an explicit orphan warning visible.

## Supabase review and local security proof

- Read the current Supabase skill guidance, changelog, Storage access-control
  guidance, and RLS guidance before the policy change. The current changelog
  contained no Storage/RLS breaking change affecting this policy pattern.
- Created the migration with `npx supabase migration new
  authorize_orphan_review_receipt_cleanup`; no deployed migration was amended
  and no remote deployment command was run.
- Extended `supabase/tests/finance_rls.integration.sql` to prove the
  database-reference-first owner cleanup succeeds while referenced, booked,
  voided, and other-owner objects are denied.

## Verification

- `npm run test -- src/components/expenses/ExpenseForm.test.tsx`: pass, 1 file
  / 1 test.
- `npm run test -- src/lib/finance-storage.test.ts
  src/components/expenses/ExpenseForm.test.tsx`: pass, 2 files / 11 tests.
- `npm run test`: pass, 8 files / 24 tests.
- `npm run build`: pass. Vite emitted only the pre-existing Browserslist
  freshness notice and bundle-size notice.
- `npx supabase db reset --local --no-seed`: pass, including the new
  migration.
- `docker exec -i supabase_db_finance-dashboard psql -U postgres -d postgres
  -v ON_ERROR_STOP=1 < supabase/tests/finance_rls.integration.sql`: pass and
  rolled back.
- `npx supabase db lint --local --level warning --fail-on warning`: pass.
- `npx supabase db advisors --local --type security --fail-on warn`: pass,
  no issues.
- `npm run lint`: unchanged baseline only: errors in `src/hooks/use-toast.ts`
  and `src/main.tsx`, and Fast Refresh warnings in `badge.tsx` and `button.tsx`.
  This task adds no diagnostics.
- `git diff --check`: pass.

## Remaining manual check

The authenticated-browser signed-preview expiry exercise requires a real
signed-in account and sample PDF. It was not performed in this local terminal
run. The panel intentionally requests a fresh signed URL each time **Preview**
or **Re-open** is used, so an expired URL can be replaced without exposing a
public file.

## Recovery/fix round — receipt-backed booking and document cleanup

Recovered the uncommitted Task 3 remediation without discarding its worktree
state. The review findings are now addressed as follows:

- Added migration `20260903233331_require_receipt_before_booking.sql`, which
  extends the existing expense lifecycle trigger to reject a
  `needs_review -> booked` transition unless the expense has at least one
  `expense_documents` row. This remains a database integrity check rather than
  a UI-only disabled-action guard.
- Extended the authenticated local RLS integration script to prove that an
  owner cannot book an undocumented review expense. The script also adds a
  valid receipt before the booked-orphan Storage-policy case so that case
  remains valid under the new lifecycle rule.
- `deleteExpenseDocument` now treats a Storage delete result of
  `{ data: [], error: null }` as an orphan-cleanup failure. It does not allow a
  parent expense deletion to proceed; the retained document path makes the
  operation retryable after metadata has already been removed.
- Replacements upload with the document's existing role. When replacing the
  primary document, the new document is explicitly promoted after the old
  metadata is removed; it is also promoted if old-object cleanup fails after
  that removal, preserving the primary-document invariant while surfacing the
  retryable cleanup error.
- The Zustand document remove/replace failure paths refresh the expense detail
  before rethrowing. This removes stale document metadata from the visible
  review panel when Storage cleanup fails after the database reference is gone.
- Added hook tests for role preservation, primary-document replacement, and
  refreshed detail on orphan cleanup, plus a storage test for the empty-delete
  result.

Recovery verification, run independently in this worktree:

- `npm run test -- src/hooks/useExpenses.test.ts src/lib/finance-storage.test.ts src/components/expenses/ExpenseForm.test.tsx`: pass, 3 files / 15 tests.
- `npm run test`: pass, 9 files / 28 tests.
- `npm run build`: pass. Only the existing Browserslist freshness and bundle-size notices were emitted.
- `npx supabase db reset --local --no-seed`: pass, including the new migration.
- `docker exec -i supabase_db_finance-dashboard psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/finance_rls.integration.sql`: pass and rolled back.
- `npx supabase db lint --local --level warning --fail-on warning`: pass, no schema warnings.
- `npx supabase db advisors --local --type security --fail-on warn`: pass, no security issues.
- `git diff --check`: pass.
