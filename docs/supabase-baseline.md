# Supabase baseline

**Captured:** 2026-08-30 with authenticated, read-only Supabase CLI commands. No remote schema, migration history, data, bucket, or policy was changed.

## Capture boundary and reproducibility

The remote baseline was inspected without committing a database dump. To reproduce the public-schema capture in a secure local temporary directory, run:

```bash
npx supabase db dump --linked --schema public --file <temporary-path>/public-schema.sql
```

The capture file is deliberately not a migration and must not be committed. It may contain private deployment configuration or other values unsuitable for source control. Review its schema definitions locally, then discard it using the operating system's secure temporary-file process.

The read-only capture and inspection commands were:

```bash
npx supabase db dump --linked --schema public --file <temporary-path>/public-schema.sql
npx supabase db dump --linked --schema storage --file <temporary-path>/storage-schema.sql
npx supabase db dump --linked --schema storage --data-only --file <temporary-path>/storage-data.sql
npx supabase migration list
```

Local project metadata under `supabase/.temp/` remains ignored. Credentials were used only by the CLI process and were neither printed, copied, nor committed.

## Remote public-schema evidence

### Types and functions

- `public.invoice_status` contains the existing invoice lifecycle values: `draft`, `pending`, `paid`, and `overdue`.
- `public.is_owner()` is a stable SQL access helper. It compares the authenticated identity's email claim with a privately configured owner value; no owner value is recorded in this repository.
- `public.set_updated_at()` is a `before update` trigger helper that assigns `new.updated_at = now()`.

### Relations, keys, and RLS

| Relation | Primary/unique keys and relationships | `user_id` | RLS/policy evidence |
| --- | --- | --- | --- |
| `business_settings` | Primary key `id`; a check requires `id = 1`. Singleton business, tax, banking, currency, and timestamp fields. | No | RLS enabled; policy `owner full access` for `authenticated`; both `USING` and `WITH CHECK` call `public.is_owner()`. |
| `clients` | Primary key `id uuid`; client identity, address, contact, and timestamp fields. | No | RLS enabled; policy `owner full access` with the same authenticated-owner checks. |
| `invoices` | Primary key `id uuid`; unique `invoice_number`; `client_id` references `clients(id)` with `ON DELETE RESTRICT`; indexes support client, issue-date, and status access. Stores frozen client fields, totals, dates, status, notes, and timestamps. | No | RLS enabled; policy `owner full access` with the same authenticated-owner checks. |
| `invoice_line_items` | Primary key `id uuid`; `invoice_id` references `invoices(id)` with `ON DELETE CASCADE`; index on `(invoice_id, position)`. | No | RLS enabled; policy `owner full access` with the same authenticated-owner checks. |
| `clients_with_totals` view | Security-invoker view over clients and invoices; aggregates non-draft invoice totals. | Not applicable | Uses the invoker's underlying table access; no separate policy. |

The `business_settings_updated_at`, `clients_updated_at`, and `invoices_updated_at` triggers call `set_updated_at()` before updates.

## Storage evidence

The Storage probes were re-run after this remediation:

```bash
npx supabase db dump --linked --schema storage --file <temporary-path>/storage-schema.sql
npx supabase db dump --linked --schema storage --data-only --file <temporary-path>/storage-data.sql
```

Both commands completed successfully. The data-only file contained zero bucket records and zero object records. The schema file contained zero `CREATE POLICY` statements for application Storage objects. No app bucket definition or object policy is committed here; the finance migration must create and own its private buckets and RLS policies.

## Ownership decision for finance work

The existing invoice app is single-owner rather than row-multi-user: legacy base tables lack `user_id`, but the shared owner policy blocks non-owner access through `public.is_owner()`.

Do not backfill `user_id` onto legacy `business_settings`, `clients`, `invoices`, or `invoice_line_items` in the finance migration. Preserve their behavior. New finance tables must instead include `user_id uuid not null references auth.users(id)` and enforce both:

```sql
public.is_owner() AND auth.uid() = user_id
```

A future multi-user conversion is separate work: add and deterministically backfill legacy ownership, replace the legacy owner policies, and revise the view before supporting additional owners.

## Remote migration-history reconciliation

`npx supabase migration list` shows remote migration entries that have no matching files in this repository. Consequently, `npx supabase db pull <new-migration-name>` is blocked by `LegacyDbPullMigrationConflictError`. No `supabase migration repair` command has been run.

This is a no-deploy condition: do not run `supabase db push` or deploy the finance migration to this remote project until the original migrations are restored from an authoritative historical source, or a separately approved migration-history reconciliation has completed. The schema evidence above supports local design and disposable-local checks only; it does not make the remote deployment history safe.

## Verification

- `npx supabase migration list` — completed; confirmed the unmatched remote/local migration history.
- `npx supabase db dump --linked --schema public` — completed; reviewed locally only, never committed.
- `npx supabase db dump --linked --schema storage` — completed; zero application Storage policy statements.
- `npx supabase db dump --linked --schema storage --data-only` — completed; zero bucket and object records.
- `npx supabase db pull <new-migration-name>` — correctly blocked by the migration-history mismatch; no repair attempted.
- `npm run build` — passed after baseline capture (existing Browserslist and bundle-size notices only).
- `git diff --check` — passed.
