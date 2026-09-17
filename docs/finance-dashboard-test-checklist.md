# Finance Dashboard Release Test Checklist

Run this checklist in staging with two separate authenticated accounts: owner A and non-owner B. Use only synthetic fixtures and a dedicated Google test mailbox. Do not connect a personal or production mailbox until every relevant test has passed. The production release is blocked while remote migrations, Edge Functions, Google OAuth configuration, Vault/Edge secrets, or this staging validation are incomplete.

## Build and automated verification

- [ ] From a clean checkout, run `npm run test` and record the result. The finance suite must pass.
- [ ] Run `npm run build`; TypeScript compilation and the production bundle must pass.
- [ ] Run `npm run lint`. The current repository baseline is not clean: it reports two pre-existing errors (`src/hooks/use-toast.ts` type-only `actionTypes` import and `src/main.tsx` `var` usage) plus two Fast Refresh warnings in `badge.tsx` and `button.tsx`. Do not claim lint is passing until those separate baseline issues are fixed. No new finance-dashboard lint issue is acceptable.
- [ ] Run the documented Deno and local Supabase integration suites for tax exports, Gmail OAuth lifecycle/races, Gmail discovery/races, finance RLS, expense booking concurrency, invoice archive integrity, and document cleanup.
- [ ] Deploy the migration chain, Edge Functions, bucket policies, and secrets to staging; rerun the relevant integration tests against that staging project before production.

## Ownership and authentication

- [ ] In a fresh staging/bootstrap project, verify the securely configured `public.is_owner()` returns true for owner A and false for B before testing finance access. Confirm the owner identity was configured outside version control, following [the sanitized owner bootstrap procedure](supabase-baseline.md#sanitized-owner-bootstrap).
- [ ] Verify an unauthenticated request to every sensitive Edge Function operation returns HTTP 401: export creation/status, Gmail authorize, Gmail callback POST, manual sync, and scheduled sync without its cron secret.
- [ ] Verify owner A can view only their own rows and objects, and user B cannot read, insert, update, delete, or obtain a signed URL for A's expense documents, issued PDFs, tax-export ZIPs, Gmail connection status, exports, or review drafts.
- [ ] Verify a cross-owner export path is rejected and never creates a ZIP or signed URL.
- [ ] Verify all three buckets remain private and their RLS policies retain the owner path checks after migration.

## Manual expenses and invoice archives

- [ ] Upload a 16 MiB PDF and verify it is rejected before a document row or Storage object is retained.
- [ ] Upload/import the same document checksum twice and verify the duplicate is skipped without a second expense document.
- [ ] Verify drafts, `needs_review` records, and voided expenses are excluded from dashboard expense totals; only booked records use paid date with document-date fallback.
- [ ] Verify a booked expense cannot be edited or hard-deleted, and that a void requires a reason and preserves the audit record.
- [ ] Verify an expense cannot be booked without at least one linked document.
- [ ] Issue an invoice, then change business settings and confirm the existing invoice download remains the frozen original PDF. Confirm issued financial content and line items cannot be changed, while an allowed payment-status change does not alter annual CSV totals or archived bytes.
- [ ] For a legacy issued invoice with no archive, use the explicit backfill action and confirm it creates exactly one immutable archive; a missing invoice archive blocks the annual invoice package.

## Gmail OAuth, discovery, and review

- [ ] Inspect the Google consent URL and verify it requests only `https://www.googleapis.com/auth/gmail.readonly`.
- [ ] Verify the exact registered Google redirect URI is `https://<project-ref>.supabase.co/functions/v1/gmail-callback`, and verify callback state/code stay out of logs, browser history, and application routes after the fragment relay.
- [ ] Confirm OAuth state is single-use, expires in ten minutes, and an account switch cannot complete a connection for a different signed-in user.
- [ ] Use fixtures to verify messages from Gmail `SENT` and filenames that match this application's issued invoices are excluded.
- [ ] Use an incoming message containing an invoice and receipt and verify it creates one review candidate with both documents, not two expenses. Verify splitting is rejected while a multi-batch candidate is incomplete and succeeds only after all attachments import.
- [ ] Verify a valid, structurally checked PDF declared as `application/octet-stream` is accepted.
- [ ] Verify unrelated PDF attachments are ignored and unsupported/oversized/malformed image or PDF inputs are skipped without aborting the entire sync.
- [ ] Run the same daily fixture twice and verify discovery is idempotent: no duplicate candidate, document, import, or Storage object is created.
- [ ] Simulate a transient message-metadata and attachment fetch failure, then a successful retry. Verify each source is retried from the bounded failure queue before new discovery, imports exactly once on recovery, and no successful, duplicate, or excluded source is retried.
- [ ] Verify Gmail-created candidates remain `needs_review`, have no automatically extracted amounts, and cannot be booked until the user confirms the required details.
- [ ] Disconnect the test mailbox and verify usable server token access is erased/disabled, scheduled processing stops, queued/running work fails safely, and imports remain. A completed Google HTTP/provider failure may release the claim as `retry` for a fresh revocation attempt. Simulate a transport timeout separately and verify it remains `uncertain` with its exclusive claim held. The UI still displays **Retry disconnect** for public `disconnecting` status; click it and verify the server returns no credential and the Google fixture receives no second revocation request. Only the documented operator reconciliation procedure can release the held claim.

## Annual exports

- [ ] For a fixed fixture year, request both package types and confirm the ZIP CSV total, document count, year boundary, and included items match the finance dashboard.
- [ ] Verify the issued-invoice ZIP contains original archived PDF bytes and excludes drafts.
- [ ] Verify the business-expenses ZIP contains originals for booked expenses, excludes review drafts and voided amounts, and includes voided records only in the separate audit CSV.
- [ ] Verify a missing qualifying invoice PDF or expense document blocks the final export rather than creating a partial ZIP.
- [ ] Verify generated ZIPs are private, only owner A receives a signed download URL, and the URL expires within 15 minutes. After the 24-hour expiry boundary, verify a successful cleanup run removes the ZIP while source documents remain; simulate a failed deletion and verify `cleanup_pending` and the path remain for retry instead of promising removal at exactly 24 hours.
- [ ] Verify a 50 MiB-or-larger generated package fails safely without a completed job or downloadable partial ZIP.

## Go-live sign-off

- [ ] Confirm Google restricted-scope consent-screen verification and any required security assessment are complete for the production OAuth client.
- [ ] Confirm the production `GMAIL_TOKEN_ENCRYPTION_KEY` is protected and backed up through the approved secret-management process.
- [ ] Confirm tax-export and Gmail Vault scheduler secrets exist. Verify the database-only tax-export lease-recovery cron still runs without Vault configuration, while retention dispatch reports a clear error until its Vault entries are installed. For a configured retention run, inspect `cron.job_run_details`, the matching `net._http_response`, and cleanup JSON `expired`/`failed` counts; a cron dispatch alone is not proof that cleanup completed.
- [ ] Have the business owner and tax advisor review one fixed-year package and confirm the package is an organisational aid, not a tax return or tax-law calculation.
- [ ] Record the deployed migration version, Edge Function versions, test evidence, secret owner, and rollback contact before enabling production Gmail discovery.
