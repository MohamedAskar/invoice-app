# Task 1 schema report

## Status

Completed the remaining schema-only portion of Task 1. The previously reviewed
Vitest/calculation foundation was left unchanged.

## Changes

- Added `20260830213951_finance_dashboard.sql` through `supabase migration new`.
- Added EUR-only expenses with stored generated gross totals, booking/voiding
  controls, immutable void protections, and append-only transition auditing.
- Added expense documents, normalized vendor rules, Gmail connection/import/sync
  state, one-time expiring OAuth states, and tax export jobs with ownership
  constraints, checks, unique source identifiers, and query indexes.
- Added private finance buckets with PDF/ZIP/CSV MIME and size limits plus
  owner-folder Storage policies.
- Added explicit grants and RLS for all client-visible finance data. Gmail token
  and PKCE tables have neither authenticated grants nor client policies.
- Exposed Gmail status only through a security-invoker view over a non-secret
  status projection; database advisors report no definer-view finding.
- Limited expense documents and their bucket to PDF, JPEG, and PNG files at a
  consistent 15 MiB maximum.
- Split expense and document permissions into explicit per-operation policies:
  only `needs_review` expenses can be deleted, and documents can only be added,
  changed, or deleted while their parent remains `needs_review`.
- Made every voided expense immutable, including vendor, document identity,
  classification, dates, amounts, source, notes, and void metadata. Booked
  expenses can remain booked or transition to voided; successful booking and
  voiding transitions append their corresponding audit rows.
- Aligned cross-task enum contracts: expense sources are exactly `upload` or
  `gmail`, and Gmail connection status uses `reauthorization_required`.

## Verification

- `git diff --check`: passed.
- `npx supabase db reset`: passed; applied the reconciled baseline then this
  migration to the disposable local instance.
- `npx supabase db lint --local --level warning --fail-on warning`: passed.
- `npx supabase db advisors --local --type security`: passed with no issues.
- `docker exec -i supabase_db_finance-dashboard psql ... -f
  supabase/tests/finance_rls.integration.sql`: passed. The rollback-only local
  authenticated-role session temporarily overrides the sanitized owner helper,
  then proves owner/non-owner isolation, Gmail token-table denial, status-view
  access, storage folder isolation, review-only deletion, document locking,
  booking/voiding, and append-only audit transitions. A local database reset
  was run immediately afterwards, restoring the sanitized baseline function.
- `npm run test -- --run`: passed (1 file, 2 tests).
- `npm run build`: passed (existing Browserslist and chunk-size notices only).
- `npm run lint`: retains only the pre-existing errors in `src/hooks/use-toast.ts`
  and `src/main.tsx`, plus the two existing Fast Refresh warnings; this migration
  adds no lint diagnostics.

## Scope and deployment

The approved deployment ran after `npx supabase db push --dry-run` reported
exactly one pending migration: `20260830213951_finance_dashboard.sql`.
`npx supabase db push --yes` then applied that migration to the linked remote
project. `npx supabase migration list --linked` confirms both the reconciled
baseline (`20260830213228`) and finance migration (`20260830213951`) are aligned
locally and remotely.

`npx supabase db advisors --linked --type security` completed with one existing
project-level warning: leaked-password protection is disabled in Supabase Auth.
It is unrelated to this finance migration; no schema-security findings were
reported. No Gmail sync, Gmail mutation, application UI, storage client, or
other remote action was performed.
