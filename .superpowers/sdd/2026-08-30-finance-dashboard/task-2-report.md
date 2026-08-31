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
