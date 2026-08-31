# Task 2 report — finance models and RLS-scoped data access

## Status

Completed. The browser-side finance layer only uses the authenticated Supabase
client and relies on the Task 1 RLS policies; it contains no service-role or
other privileged credentials.

## Changes

- Added stable expense, document, category, status, source, and input types.
- Added typed errors for immutable records, duplicate document checks, invalid
  documents, validation failures, and safe generic persistence failures.
- Added RLS-scoped expense queries, draft-only deletion, and an atomic database
  void transition. The existing database lifecycle/audit triggers make the row
  update and append-only audit record one transaction, while source documents
  are deliberately not touched.
- Added browser-side PDF/JPEG/PNG and 15 MiB validation before uploads,
  SHA-256 checksums, user-id-derived safe object names, duplicate protection,
  and storage-object cleanup when metadata insertion fails.
- Added expiring signed expense-document URLs, immutable issued-invoice PDF
  archival, and annual missing-PDF discovery. Invoice archives refuse non-PDF
  blobs and only update the selected invoice if it does not already have an
  archive path.
- Added focused mapping, ordering, and pre-request validation tests. The test
  harness mocks the Supabase module only for pure mapping/validation coverage;
  it makes no remote calls.

## Verification

- Initial red test: `npm run test -- src/lib/finance-storage.test.ts` failed as
  expected because `./finance-storage` did not exist.
- `npm run test -- src/lib/finance-storage.test.ts`: passed, 1 file / 4 tests.
- `npx eslint src/lib/finance-storage.ts src/lib/finance-storage.test.ts src/types/finance.ts`:
  passed.
- `npm run test`: passed, 2 files / 6 tests.
- `npm run build`: passed (existing Browserslist freshness and bundle-size
  notices only).
- `npm run lint`: retains only the established baseline errors in
  `src/hooks/use-toast.ts` and `src/main.tsx`, plus the two existing Fast
  Refresh warnings. This task adds no lint diagnostics.
- `git diff --check`: passed.

## Scope notes

`src/lib/storage.ts` did not require a change: invoice archival is isolated in
`finance-storage.ts`, so existing invoice, client, settings, import, and clear
data behavior is preserved. Expense draft deletion is database-preconditioned
to `needs_review`; booked and voided records return a
`FinancialRecordImmutableError` rather than being hard deleted.

## Integrity follow-up

The independent review found that the original lifecycle trigger permitted
booked-row field edits and that the broad Storage policies allowed mutable
invoice/export objects. The local-only additive migration
`20260831081534_finance_record_integrity.sql` resolves those findings without
rewriting or deploying the earlier migration.

- Booked expenses are now immutable in the database except for an unchanged
  booked-to-voided transition; `saveExpense` also refuses any non-review row.
- Storage inserts are limited to a current review expense or a current draft
  invoice archive. Only objects tied to review expense-document metadata are
  update/delete eligible. Issued-invoice and tax-export objects have no client
  mutation policy.
- Review-draft document metadata cascades with the parent. The client first
  removes review objects through the Storage API, then calls a security-invoker
  RPC which refuses parent deletion while a blob remains and atomically deletes
  the document metadata and review expense. This preserves Supabase Storage's
  mandatory API-only blob deletion safeguard.
- Invoice archival uploads first, then calls a security-invoker RPC that alone
  performs draft-to-pending plus path/hash persistence. A trigger blocks direct
  PDF metadata edits, and a constrained cleanup RPC removes an unreferenced
  attempted upload after a race/rejection.
- New invoice INSERTs now require `draft` with no archive metadata. Pending,
  paid, and overdue INSERTs are rejected; archive metadata can only be written
  by the constrained issue RPC. Historical unarchived non-draft rows remain
  editable, and only persisted `pending` or `overdue` rows may complete their
  lifecycle by transitioning to `paid` without archive metadata. Every other
  missing-PDF status transition remains blocked, and annual missing-PDF
  discovery continues to surface these legacy records.
- The invoice form now defaults new records to `draft`, while preserving an
  existing record's status during edits.
- Overdue is now explicitly display-only. A past-due pending legacy invoice
  retains its stored `pending` status when ordinary fields are saved. Database
  persistence failures propagate through storage and the invoice store; the
  form shows an error and neither navigates nor reports optimistic success.
- The invoice view and list now await mark-as-paid persistence. A rejected
  transition leaves local UI/store state unchanged and produces a destructive
  error toast instead of an optimistic success notification.

Follow-up verification (all local; no `db push`):

- `npx supabase db reset`: passed.
- Authenticated-role `finance_rls.integration.sql` run directly through the
  local database container: passed and rolled back; covers attached
  review-draft cascade, booked edit denial, review/issued object immutability,
  archive status/path/hash gating, allowed legacy `pending|overdue -> paid`,
  and rejection of other legacy missing-PDF status changes. A mutation run
  against the prior trigger failed at the newly allowed paid transition before
  a fresh reset restored the amended migration and passed the same script.
- `npx supabase db lint --local --level warning --fail-on warning`: passed.
- `npx supabase db advisors --local --type security`: passed with no issues.
- `npm run test -- src/lib/finance-storage.test.ts`: passed, 8 tests.
- `npm run test -- src/pages/MarkInvoicePaid.test.tsx src/hooks/useInvoices.test.ts`:
  passed, 2 files / 5 tests. The two page regressions failed first against the
  unawaited handlers, showing false success and optimistic paid UI.
- `npm run test`: passed, 7 files / 21 tests; `npm run build` passed with only
  the established Browserslist freshness and bundle-size notices.
- Focused client regression tests for the new-draft default, created draft
  upsert payload, and unchanged legacy-pending payload: passed
  including the finance storage coverage.
- Focused overdue persistence and failed-save UI regressions: passed.
- Focused ESLint for the changed React/store files: passed; `git diff --check`
  passed.
- Full lint retains only the established two baseline errors and two existing
  Fast Refresh warnings; the integrity change adds no diagnostics.
