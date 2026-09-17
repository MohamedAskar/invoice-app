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
job expiry. After expiry a status response provides no URL, and Storage RLS
also refuses fresh direct signed links. A worker has one ten-minute lease;
failed or expired jobs cannot be reclaimed. Claim, completion, timeout and
cleanup use atomic database transitions. Storage writes lock the same job row
and reject revoked leases, including a late upload after cleanup.

## Required cleanup schedule activation

The `20260908160119_tax_export_worker_leases_and_retention.sql` migration
installs two active cron jobs: database-only stale-lease recovery every minute,
and authenticated retention dispatch every five minutes. **This change has
been applied only to the local test stack; it has not been deployed remotely.**
Every job receives durable `expires_at` metadata at creation, with a fixed
24-hour deadline that completion cannot extend. The handler's server-only
`{ "mode": "cleanup" }` mode removes ZIP objects through the Storage API, then
marks expired copies unavailable and clears their paths only after deletion
is acknowledged. Failed removals retain `cleanup_pending` and their paths for
the next run. Cleanup atomically revokes stale workers before deleting and
never claims an active lease. Worker recovery attempts are independently
caught: if all Edge database requests fail, the deadline already committed at
creation still lets the database-only cron fail the worker and enqueue cleanup
once the database is available. A lost completion response does not delete an
already-completed ZIP. The
cleanup handler processes at most 100 expired jobs per invocation; monitor
backlog and increase frequency when needed.

The migration enables `pg_cron`, `pg_net`, and Vault. Securely provision
Vault entries named `tax_export_project_url` (the project's API origin) and
`tax_export_service_role_key` (its legacy service-role JWT; the gateway's JWT
check stays enabled). Supply values via the target project's secret management
interface; never commit them. Rotate this Vault entry when the project key
rotates. Apply the migration and deploy the Edge Function, then execute
`schedule-cleanup.sql` as a configuration preflight after provisioning those
entries. The scheduled dispatcher always calls the same preflight: absent or
malformed values raise a clear error in cron history and no HTTP request is
sent. No secret values are embedded in the migration or cron command text.
Expired objects are removed at the first successful
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
npx supabase@2.117.0 migration up --local
docker exec -i supabase_db_finance-dashboard psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/tax_export_leases.integration.sql
npx deno test --allow-run=docker --config supabase/functions/create-tax-export/deno.json supabase/tests/tax_export_concurrency.integration.ts
npx deno test --allow-env --allow-run=docker,npx --allow-net=127.0.0.1:54321 --config supabase/functions/create-tax-export/deno.json supabase/tests/tax_export_storage.integration.ts
```

The function-directory Deno tests use synthetic bytes and a mocked HTTP boundary.
The separate local integration uses real Auth sign-in, user JWT verification,
PostgREST, RLS, private Storage and signed-download ZIP bytes for two fixture
users. It requires an empty local Auth database, refuses non-loopback API
origins, temporarily configures the local owner predicate, restores it, and
removes generated fixtures on completion. It verifies both packages, source
isolation, late-worker rejection and direct signing denial after expiry.
Credentials are captured from local CLI output in memory and never printed or
written to files. Use CLI 2.117.0 or newer for this repository's config keys.
The handler runs directly in Deno against the real local services; this does
not exercise the deployed Edge gateway. Before production activation verify
the scheduled HTTP dispatch succeeds in the target environment. ZIPs use pinned
`fflate@0.8.2` stored entries (no recompression), preserve original bytes, and
are bounded below the private bucket's 50 MiB limit. Larger packages fail
explicitly and require a future streaming export implementation.
