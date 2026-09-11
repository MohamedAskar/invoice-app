# Finance Dashboard Operations Guide

This guide is the production handoff for expenses, Gmail discovery, frozen invoice archives, and annual tax packages. The code is complete locally, but the remote migrations, Edge Functions, secrets, and two-account staging validation are still pending. Do not enable Gmail discovery or share annual packages until the release checklist has passed in staging.

The dashboard is an organisation tool, not tax, accounting, or legal advice. It does not calculate a tax return, validate VAT treatment, reconcile a bank account, or decide whether an expense is deductible. Confirm the annual registers and attached documents with the tax advisor before filing.

## Production scope

The application keeps its existing EUR-only behaviour. Expense documents are uploaded manually or discovered from Gmail, but their vendor, invoice number, accounting dates, amounts, VAT, category, and booking decision are always entered and confirmed by the user. There is no GPT, OCR, or other document-data extraction service.

Gmail discovery reads only incoming messages and creates `needs_review` expense drafts. It does not change Gmail messages, labels, or threads. A draft cannot become a booked expense until it has a document and the user completes the required financial fields; Gmail drafts also require a confirmed review, vendor invoice number, paid date, and non-zero amount.

## Deploy in this order

Use a clean deployment environment, back up the project database, and inspect the linked migration history before applying anything. Apply the migration files in their committed timestamp order; do not cherry-pick a later finance migration over an earlier one.

1. `20260830213228_remote_schema.sql`
2. `20260830213951_finance_dashboard.sql`
3. `20260831081534_finance_record_integrity.sql`
4. `20260903081852_replace_pdf_cleanup_definer.sql`
5. `20260903184919_authorize_orphan_review_receipt_cleanup.sql`
6. `20260903233331_require_receipt_before_booking.sql`
7. `20260907090042_serialize_booked_expense_documents.sql`
8. `20260907114500_backfill_missing_invoice_archives.sql`
9. `20260907114501_harden_issued_invoice_archival.sql`
10. `20260908160119_tax_export_worker_leases_and_retention.sql`
11. `20260908183000_secure_gmail_connection_lifecycle.sql`
12. `20260908214718_serialize_gmail_oauth_lifecycle.sql`
13. `20260909084329_gmail_expense_discovery.sql`
14. `20260909202734_harden_gmail_discovery_integrity.sql`
15. `20260911075634_lock_archived_invoice_content.sql`
16. `20260911075715_make_gmail_import_failures_retryable.sql`

### Existing remote rollout

The existing remote project already has the baseline through `20260903081852_replace_pdf_cleanup_definer.sql`; migrations 5-16 remain pending remote deployment. First run `npx supabase@2.117.0 migration list --linked` and confirm that exact state. If linked access or the Supabase admin role fails, stop there: do not mark local migrations as applied or retry a partial push. Apply the pending chain only after the linked list succeeds and the CLI dry run shows exactly the expected pending files.

### Fresh staging or bootstrap project

Do not treat that existing-project migration history as a bootstrap recipe. The committed baseline intentionally contains a deny-by-default `OWNER_EMAIL_PLACEHOLDER__CONFIGURE_SECURELY` in `public.is_owner()`. Before applying finance migrations to a fresh project, follow the [sanitized owner bootstrap procedure](supabase-baseline.md#sanitized-owner-bootstrap): establish the designated owner outside version control using the project's approved secret/configuration process, then verify `public.is_owner()` returns true only for that owner. Never commit an owner identity or replace the placeholder in a migration checked into this repository.

Deploy these Edge Functions after their schema dependencies and secrets are present:

- `create-tax-export` after migrations 1-10.
- `gmail-authorize` and `gmail-callback` after migrations 1-12.
- `gmail-sync` and `gmail-sync-scheduled` after migrations 1-14.

The Supabase gateway configuration intentionally has `verify_jwt = false` for the Gmail functions. Each sensitive POST validates the bearer JWT itself and checks the sole owner; do not change that setting to bypass application-level checks. The scheduled Gmail endpoint accepts only its dedicated cron secret. The export function also uses the server-provided `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`; never expose the service-role key to the browser.

## Buckets and retention

The migrations create three private buckets. Do not make any of them public or broaden their object policies.

| Bucket | Contents | Retention and access |
| --- | --- | --- |
| `expense-documents` | Original PDF, JPEG, and PNG evidence for review and booked expenses, including Gmail imports | Owner-scoped. Review evidence may be removed while the expense remains in review. Booked or voided records retain their evidence and cannot be hard-deleted. |
| `issued-invoices` | Frozen original PDF bytes for issued invoices | Owner-scoped and immutable. The archive is not regenerated after settings or invoice details change. |
| `tax-exports` | Generated annual ZIP packages | Owner-scoped. A completed ZIP produces a 15-minute signed link. It becomes eligible for cleanup after 24 hours, and is removed only after a later successful cleanup run. Failed cleanup retains the ZIP path for retry. Source invoices and expense documents remain in their source buckets. |

Supabase Storage has a 50 MiB bucket-object limit, while an individual expense/Gmail document is capped at 15 MiB. The production project must preserve those restrictive bucket policies and enable the `pg_cron`, `pg_net`, and Vault extensions installed by the migration. The database-only tax-export lease recovery runs every minute even without Vault or Edge configuration. Tax-export retention dispatch runs every five minutes but fails clearly in cron history until its Vault secrets are configured. Gmail discovery runs daily at 05:00 and checks queued continuation work every minute; its dispatcher returns without an HTTP request until its Vault values exist.

## Tax-export scheduler configuration

Before migration 10 is relied on in production, create these Vault entries with production values:

- `tax_export_project_url`: the HTTPS project origin, such as `https://<project-ref>.supabase.co`.
- `tax_export_service_role_key`: the project legacy service-role JWT used only by the database dispatcher to call `create-tax-export` cleanup.

Run `select finance_private.tax_export_retention_preflight();` as an authorised operator, then inspect `cron.job` and `cron.job_run_details` for the two tax-export jobs. A missing or malformed secret deliberately produces a clear retention-dispatch cron failure rather than an unauthenticated request; it does not stop database-only lease recovery. A successful cron row proves only that the database dispatched an HTTP request. Also inspect `net._http_response` and the cleanup response JSON: its `expired` and `failed` counts are the evidence that object cleanup completed or needs another run. Keep Vault values and the Edge Function service-role credential out of logs, browser variables, repository files, and support tickets.

## Gmail OAuth and scheduler configuration

Create a dedicated Google Cloud OAuth **Web application** client, enable the Gmail API, and configure the OAuth consent screen before connecting a mailbox. Register this exact production redirect URI with Google:

`https://<project-ref>.supabase.co/functions/v1/gmail-callback`

Set the same full value as `GOOGLE_OAUTH_REDIRECT_URI`. The callback must be the Supabase Function URL, not the front-end route. Configure the fixed `GMAIL_APP_ORIGIN` and `GMAIL_APP_BASE_PATH` to match the deployed app, for example `https://<account>.github.io` and `/invoice-app`; neither has a trailing slash. Use a separate localhost/127.0.0.1 client and redirect URI for local development.

The consent request must contain only `https://www.googleapis.com/auth/gmail.readonly`. This is a Google restricted scope. Complete the applicable Google consent-screen verification and, if Google requires it for the production deployment, the restricted-scope security assessment before launch. The Codex Gmail connector is not an application OAuth credential and must not be substituted for this flow.

Set these **Supabase Edge Function secrets**, not `VITE_*` variables:

| Secret | Required value |
| --- | --- |
| `GOOGLE_OAUTH_CLIENT_ID` | Google Web application client ID |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google Web application client secret |
| `GOOGLE_OAUTH_REDIRECT_URI` | Exact Function callback URL above |
| `GMAIL_TOKEN_ENCRYPTION_KEY` | Base64 of exactly 32 cryptographically random bytes, for example `openssl rand -base64 32` |
| `GMAIL_APP_ORIGIN` | Exact application origin, no trailing slash or path |
| `GMAIL_APP_BASE_PATH` | Application base path, `/invoice-app` for this build, no trailing slash |
| `GMAIL_CRON_SECRET` | Random value at least 32 characters long |

Create matching Supabase Vault values `gmail_project_url` (the project HTTPS origin) and `gmail_cron_secret` (the same value as `GMAIL_CRON_SECRET`). The database scheduler returns without an HTTP request if either one is absent. Store local-only function values in ignored `supabase/.env.local`; do not commit them. Preserve `GMAIL_TOKEN_ENCRYPTION_KEY`: changing it without re-encrypting stored credentials makes existing connections unreadable and requires users to reconnect.

The public Google GET callback only relays the code and state to the fixed finance page in a URL fragment. The signed-in browser removes that fragment and sends it to the authenticated callback handler. Tokens, provider error bodies, and callback query parameters must never be logged or stored in browser history. OAuth state expires in ten minutes and is consumed once; PKCE and encrypted server-side token storage are mandatory.

## Invoice archive backfill

After migrations 8 and 9, existing issued invoices without `pdf_storage_path` are intentionally not silently repaired. For each such invoice, an owner opens the invoice, verifies the saved content, and chooses **Backfill archived PDF**. That action produces a single immutable PDF from the invoice as it is currently saved. It cannot replace a pre-existing archive. Once archived, matching invoice content and line items are immutable, so the annual register cannot diverge from its PDF; payment status may still progress. Resolve the missing-archive count before requesting an annual issued-invoice package; the export is deliberately blocked while any qualifying issued invoice lacks its frozen PDF.

## Expense evidence deletion and correction

A `needs_review` expense can be edited, have documents replaced or removed, or be deleted. The safe deletion flow removes database metadata first and then Storage; if the Storage delete is ambiguous, keep and retry the recorded orphan cleanup rather than manually removing an object with a live database reference.

Booked records are immutable financial evidence and cannot be hard-deleted. To correct a booked expense, void it with a required reason and create a replacement record if appropriate. Voided entries are excluded from dashboard totals and the booked-expenses package, but appear in the package's separate voided audit CSV. They retain their audit metadata; do not use direct SQL or Storage administration to remove their source evidence.

## Gmail review, disconnect, and reauthorisation

Gmail discovery uses deterministic filename, sender, direction, MIME, and document-structure rules. It groups likely invoice/receipt attachments from one message into one review candidate, rejects unsupported or suspicious files, and never extracts amounts. Incoming PDFs declared as `application/octet-stream` are accepted only after structural validation. Sent mail, filenames matching this app's issued invoices, and unrelated PDFs are excluded. A user can split a grouped review item only after its complete attachment batch has imported, or remove supporting evidence before booking.

Generic Gmail provider item failures are persisted without provider bodies and retried before new discovery, in bounded pages of 25 message IDs. A failed source is not terminal deduplication: a later successful fetch replaces only that failure record and imports the document once. A retryable failure keeps the discovery cursor stable until the retry page clears, so a continuously failing source should be investigated rather than deleted from private import history.

Clicking **Disconnect Gmail** immediately removes usable access from the connection, disables daily checks, invalidates pending/in-flight OAuth, and stops queued/running syncs. The refresh token moves briefly into a service-only disconnect job for an exclusive Google revocation attempt; imported records and documents remain. While status is `disconnecting`, reconnect and completion are blocked. A confirmed `invalid_token` outcome is treated as already revoked and the ciphertext is erased.

A completed Google HTTP/provider failure is recorded as `retry`; only that completed failure releases the claim for a fresh provider revocation attempt. A transport failure or timeout is `uncertain`: Google may still be processing the request, so the exclusive claim remains. The settings UI still exposes **Retry disconnect** for every public `disconnecting` status because it does not receive the private job outcome. If the claim is held, that click reaches the server but `disconnect_gmail()` returns no credential, so it cannot send a second Google revocation request. Never clear a claim merely because time passed.

For an `uncertain` disconnect, use the reconciliation procedure; a visible retry is safely a no-op while the claim is held, not a resolution. First establish the outcome of the original request and that the old worker has stopped; inspect only the job's user ID, attempt ID, timestamps, and outcome, never token ciphertext. An authorised operator may then invoke the service-only `finish_gmail_disconnect` for that exact user and attempt with `revoked` when revocation is confirmed, or `retry` only when the completed original request is confirmed not to have revoked the grant. Reconnect with the same mailbox to preserve deduplication. If Google has invalidated a refresh grant, the application marks the connection `reauthorization_required`, stops future syncs, and retains imported evidence; reconnect through the normal consent flow.

## Annual package interpretation

Issued-invoice packages select non-draft invoices by issue date and contain a semicolon-delimited UTF-8-with-BOM register plus the original archived PDFs. Business-expense packages use `paid_date` when present, otherwise `expense_date`; they include booked expenses, all linked original documents, and a separate voided audit register. Review drafts never contribute to annual totals. A missing source document blocks the final package instead of producing a partial archive.

The ZIP itself is limited to 50 MiB and download links expire after 15 minutes. An export copy is eligible for cleanup after 24 hours, but removal happens only in a successful cleanup run; failed removal remains recorded for retry, so do not promise deletion at exactly 24 hours. Compare its CSV totals and document count to the dashboard for the chosen year before sharing it. Provide the ZIP as supporting evidence to the tax advisor, then use the advisor's conclusion for any filing decision.

## Release status

Local implementation and fixture-based tests are complete. No real Gmail account was read or changed during development. Production remains blocked on linked Supabase access, the pending remote migration/function deployment, Google OAuth setup and approval, Vault/Edge secrets, and the staging checklist with two isolated test accounts. Follow [the release checklist](finance-dashboard-test-checklist.md) before production enablement.
