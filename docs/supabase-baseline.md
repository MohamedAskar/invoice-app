# Supabase baseline

**Capture status:** blocked before schema extraction on 2026-08-30. This document deliberately does not claim a remote schema, RLS policy, function, or storage configuration that was not successfully pulled.

## Reproducibility evidence

- `supabase init` completed and generated the checked-in local `supabase/config.toml`.
- The Supabase CLI authenticated for project linking and the project derived from the ignored `VITE_SUPABASE_URL` was linked. The URL, project reference, and all keys remain untracked and undisclosed.
- `npx supabase db pull 202608300000_existing_schema` failed before generating a migration with `LegacyPlatformAuthRequiredError: Access token not provided. Supply an access token by running supabase login or setting the SUPABASE_ACCESS_TOKEN environment variable.`
- No baseline migration exists because hand-authoring one would misrepresent the remote database.

## Locally observed contract (not remote schema evidence)

`src/lib/storage.ts` uses `business_settings`, `clients`, `invoices`, `invoice_line_items`, and the `clients_with_totals` view. The client does not supply `user_id` in writes to the four tables. It also relies on invoices referencing clients and line items being deleted when their invoice is deleted. These are application expectations only; actual primary/foreign keys, constraints, policies, functions, and storage configuration are unknown until the pull succeeds.

## Ownership decision

Ownership cannot be decided from the browser client. Before adding user-owned finance records, inspect the pulled snapshot. If the four existing base tables are confirmed global/single-user, one coordinated migration must add and deterministically backfill `user_id` across all of them, update dependent views/functions, and replace access rules with consistent owner-scoped RLS. If legacy rows have no legitimate owner, an explicit single-user access decision must instead cover both existing records and new finance records. Do not mix globally readable invoices with owner-scoped expenses.

## Unblock

Authenticate a CLI session usable by the legacy database-pull path (for example, run `npx supabase login` in this worktree, or provide `SUPABASE_ACCESS_TOKEN` only to the command environment), then rerun:

```bash
npx supabase db pull 202608300000_existing_schema
npx supabase start
npx supabase db reset
npm run build
```

After a successful pull, record the actual tables/views, keys/constraints, RLS policies, functions, storage buckets/object policies, and ownership decision here. The generated `supabase/migrations/202608300000_existing_schema.sql` must remain an unedited remote snapshot.
