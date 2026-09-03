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

## Recovery fix — 2026-09-03

- Recovered the uncommitted post-review remediation without discarding prior
  work. The archive RPC and the Storage cleanup policy now both acquire a
  `FOR UPDATE` lock on the same invoice row before checking object/reference
  state. Cleanup rechecks references after that lock; archive rechecks object
  existence after that lock. Therefore cleanup-first deletes the attempted
  blob and archive fails closed, while archive-first records the immutable
  reference and cleanup is denied.
- The cleanup authorizer is a volatile `SECURITY INVOKER` function in the
  non-exposed `finance_private` schema. `PUBLIC` and `anon` have neither
  schema usage nor execute access; `authenticated` has the minimum grants
  needed for the Storage policy to invoke it. The former public
  `SECURITY DEFINER` cleanup RPC remains revoked and dropped.
- Added `finance_pdf_cleanup_concurrency.integration.sql`, a real two-session
  local proof using separate asynchronous `dblink` connections. It holds the
  cleanup lock while archive waits, then holds the archive lock while cleanup
  waits, asserts both lock waits, final states, and outcomes. The async result
  streams are explicitly drained between interleavings so both races execute.
- Invoice cleanup now requires `storage.remove()` to return the attempted path.
  An RLS-filtered empty `data` array with no error is surfaced as
  `invoice_archive_cleanup_failed`; focused unit coverage covers both the
  non-empty successful removal and empty-result failure.

Recovery verification (all local; no remote deployment):

- Reviewed current Supabase Storage/RLS/function docs and changelog before
  changing the recovered implementation; no relevant breaking change applied.
- `npx supabase db reset --local --no-seed`: passed, including
  `20260903081852_replace_pdf_cleanup_definer.sql`.
- `docker exec -i supabase_db_finance-dashboard psql -U postgres -d postgres
  -v ON_ERROR_STOP=1 < supabase/tests/finance_rls.integration.sql`: passed and
  rolled back.
- `docker exec -i supabase_db_finance-dashboard psql -U supabase_admin -d
  postgres -v ON_ERROR_STOP=1 <
  supabase/tests/finance_pdf_cleanup_concurrency.integration.sql`: passed and
  rolled back; reported `cleanup-first | 1 | false` and
  `archive-first | 0 | true`.
- `npx supabase db lint --local --level warning --fail-on warning`: passed.
- `npx supabase db advisors --local --type security --fail-on warn`: passed
  with no issues.
- `npm run test -- src/lib/finance-storage.test.ts`: passed, 1 file / 10 tests.
- `npm run test`: passed, 7 files / 23 tests.
- `npm run build`: passed; only the existing Browserslist freshness and bundle
  size notices were emitted.
- `git diff --check`: passed.

Commit: `fix: serialize invoice PDF cleanup with archival`

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

## Remote deployment — 2026-09-02

- Pre-deploy `npx supabase migration list --linked` confirmed remote migration
  versions `20260830213228` and `20260830213951`; version `20260831081534` was
  local-only.
- `npx supabase db push --dry-run` listed exactly one pending migration:
  `20260831081534_finance_record_integrity.sql` (no seeds or roles).
- `npx supabase db push --yes` applied exactly
  `20260831081534_finance_record_integrity.sql` successfully.
- Post-deploy `npx supabase migration list --linked` reports all three local
  versions aligned remotely: `20260830213228`, `20260830213951`, and
  `20260831081534`.
- `npx supabase db advisors --linked --type security` completed with two
  external WARN findings: authenticated callers can execute the intentional
  `SECURITY DEFINER` function
  `public.discard_unarchived_invoice_pdf(uuid, text, text)`, and Supabase Auth
  leaked-password protection is disabled. No migration deployment failure was
  reported.
- `npm run build` passed (`tsc -b && vite build`). Vite emitted the existing
  Browserslist freshness notice and a chunk-size notice; output included a
  2,239.51 kB JavaScript bundle (715.23 kB gzip).

## Post-deploy security remediation — 2026-09-03

- Added the new local migration
  `20260903081852_replace_pdf_cleanup_definer.sql`; the deployed integrity
  migration was not modified and no remote command was run.
- Revoked and dropped the legacy `SECURITY DEFINER`
  `public.discard_unarchived_invoice_pdf(uuid, text, text)` helper. The
  remaining finance RPCs are `SECURITY INVOKER`.
- Added a narrowly scoped authenticated Storage DELETE policy for
  `issued-invoices`: it requires the authenticated owner prefix and object
  owner, the immutable invoice-PDF path shape, and the absence of every
  `invoices.pdf_storage_path` reference. It grants no deletion access to
  expense documents or tax exports, and leaves referenced/archived PDFs and
  other users' objects protected.
- The finance client now cleans up a failed archive attempt through the normal
  Storage API, relying on that RLS policy instead of a privileged cleanup RPC.
  Focused unit coverage verifies the RLS cleanup call and the retained orphan
  cleanup failure state.
- Expanded the local authenticated-role SQL proof to allow an orphan attempted
  invoice PDF while denying a referenced archive, another user's PDF, a booked
  expense document, and a tax export. The Storage guard's transaction-local
  API flag is used only inside the rolled-back proof so it can exercise RLS.

Verification (all local):

- `npx supabase db reset`: passed with the new migration.
- `finance_rls.integration.sql` through the local database container: passed
  and rolled back.
- `npx supabase db lint --local --level warning --fail-on warning`: passed.
- `npx supabase db advisors --local --type security`: passed with no issues.
- `npm run test -- src/lib/finance-storage.test.ts`: passed, 9 tests.
- `npm run test`: passed, 7 files / 22 tests.
- `npm run build`: passed; only the existing Browserslist freshness and bundle
  size notices remain.
- `npm run lint`: retains only the established errors in `src/hooks/use-toast.ts`
  and `src/main.tsx`, plus the two existing Fast Refresh warnings; this change
  adds no lint diagnostics.
- `git diff --check`: passed.
