# Supabase baseline

**Captured:** 2026-08-30 with authenticated Supabase CLI commands. The remote schema, business data, buckets, and policies were not changed. With explicit owner authorization, remote migration-history metadata was reconciled so the checked-in baseline can be treated as already applied to this existing project.

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

This repository had no local migration files for three historical remote migration metadata entries. With explicit authorization, those orphaned metadata entries were marked reverted using `supabase migration repair --linked --status reverted`. This changed migration bookkeeping only; it did not run SQL against business tables, data, buckets, or policies.

`npx supabase db pull --linked --yes` then captured the live remote schema in `supabase/migrations/20260830213228_remote_schema.sql` and marked that baseline migration applied on the existing remote project. A subsequent `npx supabase migration list --linked` shows the local and remote baseline aligned.

Deployment tooling must skip this baseline migration because it is already marked applied remotely. New finance migrations can now be applied after review in the normal order.

### Sanitized owner bootstrap

The generated baseline originally contained a live owner-email literal in `public.is_owner()`. That literal is intentionally replaced in the committed migration with the non-secret placeholder `OWNER_EMAIL_PLACEHOLDER__CONFIGURE_SECURELY`. The live remote function is unchanged.

For a fresh, independent Supabase project, this placeholder leaves owner access deny-by-default. Before using the baseline in such a project, establish an explicit secure owner bootstrap appropriate to that project; do not replace it with an identity value in version control.

## Verification

- `npx supabase migration list` — completed; confirmed the unmatched remote/local migration history.
- `npx supabase migration list --linked` — completed before and after reconciliation; confirmed an empty list after orphaned entries were reverted, then confirmed local/remote baseline alignment after the schema pull.
- `npx supabase db dump --linked --schema public` — completed; reviewed locally only, never committed.
- `npx supabase db dump --linked --schema storage` — completed; zero application Storage policy statements.
- `npx supabase db dump --linked --schema storage --data-only` — completed; zero bucket and object records.
- `npx supabase db pull <new-migration-name>` — correctly blocked by the migration-history mismatch; no repair attempted.
- `npx supabase migration repair --linked --status reverted` — completed for the three orphaned historical metadata entries under explicit authorization; no business schema or data operation was run.
- `npx supabase db pull --linked --yes` — completed; generated and remotely marked the sanitized baseline as applied.
- `npm run build` — passed after baseline capture (existing Browserslist and bundle-size notices only).
- `git diff --check` — passed.
