# Annual export deployment

The function requires the existing finance migrations, private `tax-exports`,
`issued-invoices`, and `expense-documents` buckets, and Supabase-provided
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` server secrets.
Deploy `create-tax-export` with JWT verification enabled (the default). The
handler additionally verifies user tokens through Auth `getUser` and checks
the application's `is_owner()` rule before reading caller-visible records.
No server credential belongs in a Vite environment variable or browser bundle.

The API accepts `{ "kind": "issued_invoices" | "business_expenses", "year": 2026 }`.
The existing database kind `expenses` is mapped at the boundary. It returns a
queued job and performs work through `EdgeRuntime.waitUntil`. Poll with
`{ "mode": "status", "jobId": "..." }` only while queued/running. Completed
responses contain a signed URL valid for at most 900 seconds and never past
job expiry. After expiry a status response provides no URL. A worker that
stops responding becomes a generic failure on status lookup after ten minutes.

## Required cleanup schedule activation

**No remote schedule has been activated by this change.** Deployment must
configure an authenticated scheduler before advertising 24-hour retention.
Every job receives durable `expires_at` metadata at creation. Completion sets
expiry to 24 hours after completion. The handler's server-only
`{ "mode": "cleanup" }` mode removes ZIP objects through the Storage API, then
marks jobs expired and clears their paths. Failed removals keep their paths
and are retried next run. Abandoned queued/running jobs also expire. The
cleanup handler processes at most 100 expired jobs per invocation; monitor
backlog and increase frequency when needed.

Enable `pg_cron`, `pg_net`, and Vault in the target project. Securely provision
Vault entries named `tax_export_project_url` (the project's API origin) and
`tax_export_service_role_key` (its legacy service-role JWT; the gateway's JWT
check stays enabled). Supply values via the target project's secret management
interface; never commit them. Rotate this Vault entry when the project key
rotates. Execute `schedule-cleanup.sql` in the deployment environment after
provisioning those entries. It validates both entries and schedules cleanup
every five minutes, so expired objects are removed at the first successful
run after the 24-hour boundary. Only trusted project administrators should
have Vault/cron access. Inspect `cron.job_run_details` and
`net._http_response` for HTTP failures; a successful cron dispatch alone does
not prove cleanup success. The HTTP JSON result reports `expired` and `failed`.

An external scheduler can equivalently POST to
`<project API origin>/functions/v1/create-tax-export` with
`Authorization: Bearer <server service-role JWT>` and the cleanup JSON body.
That credential authorizes cleanup only and is explicitly rejected as a user
identity by the ordinary export path.

## Local verification

```
npx deno check --config supabase/functions/create-tax-export/deno.json supabase/functions/create-tax-export/index.ts
npx deno test --allow-env --config supabase/functions/create-tax-export/deno.json supabase/functions/create-tax-export/
```

The Deno tests use synthetic bytes and a mocked HTTP boundary; they never use
project credentials or access a live project. Before production deployment,
also run the function against a disposable local Supabase project with two
test users and inspect a downloaded archive. Verify actual RLS, both packages,
missing-object failures, expiry and scheduler retries. ZIPs use pinned
`fflate@0.8.2` stored entries (no recompression), preserve original bytes, and
are bounded below the private bucket's 50 MiB limit. Larger packages fail
explicitly and require a future streaming export implementation.
