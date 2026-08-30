# Freelance Finance Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing invoice app into a secure freelance-finance dashboard with receipt-backed expenses, optional Gmail receipt intake, and annual invoice/expense packages for a tax advisor.

**Architecture:** Keep the React/Vite client as the presentation layer and extend Supabase with user-owned relational data, private document storage, scheduled Edge Functions for privileged Gmail OAuth/import, and ZIP generation. Gmail performs a historical scan and daily incremental discovery without asking the user to search or label mail; deterministic metadata/file rules and learned vendor choices create reviewable document candidates. The user manually enters financial fields before booking, while issued invoice PDFs and booked-expense history remain immutable or voidable.

**Tech Stack:** React 18, TypeScript, React Router, Zustand, Supabase Postgres/Auth/Storage/Edge Functions/Cron, Vitest + Testing Library, JSZip, `@react-pdf/renderer`, Gmail API OAuth 2.0.

**Spec:** `docs/finance-dashboard-spec.md`

## Global Constraints

- Keep all money fields as `numeric(12,2)` in Postgres and `number` in the existing TypeScript view models; round only at input/formatting boundaries.
- Keep expenses EUR-only, matching the existing app currency setting; require manual EUR entry rather than silently converting non-EUR documents.
- Every new table has `user_id uuid not null references auth.users(id)` and RLS policies using `auth.uid() = user_id`.
- Capture the existing remote Supabase schema and RLS policies in a baseline migration before adding finance tables or altering invoices.
- Use private Storage buckets `expense-documents`, `issued-invoices`, and `tax-exports`; use the object name prefix `<user_id>/` and never save public document URLs.
- Restrict receipt uploads to PDF/JPEG/PNG, maximum 15 MB, and calculate a SHA-256 checksum to detect duplicate documents.
- Never expose Google client secrets, refresh tokens, Supabase service-role keys, or document bytes in browser logs, tables, error strings, or analytics.
- Do not send invoice documents to an AI extraction provider. Gmail intake stores source documents and safe metadata; the user enters financial fields manually.
- Request only `https://www.googleapis.com/auth/gmail.readonly`, never modify Gmail data, and ship Gmail behind an explicit opt-in settings control. Run one daily incremental sync plus a user-triggered sync.
- A Gmail attachment creates `needs_review`; only a user action can create `booked` status.
- Exclude Gmail `SENT`, the authenticated user's own sender address, and issued-invoice filename/number patterns before expense classification.
- Group invoice and receipt attachments from one purchase into one expense candidate; ignore unrelated PDF documents and inline assets.
- Permit a PDF labeled `application/octet-stream` only when its filename ends in `.pdf` and its decoded bytes begin with `%PDF-`.
- Allow hard deletion only for draft expenses. Booked expenses use `voided_at`, `void_reason`, and an immutable audit trail.
- Issued invoice annual exports filter `invoices.date`; expense annual exports filter the configured accounting date and `expenses.status = 'booked'`.
- Preserve existing invoice and client behaviors. Do not change an already-issued invoice’s frozen PDF when business settings later change.

---

## Planned file structure

| Path | Responsibility |
| --- | --- |
| `supabase/config.toml` | Local Supabase project configuration. |
| `supabase/migrations/202608300000_existing_schema.sql` | Pulled baseline of the current remote schema and policies before finance changes. |
| `supabase/migrations/202608300001_finance_dashboard.sql` | Expense, document, Gmail connection/import, and export-job schema; indexes; RLS; private bucket policies. |
| `supabase/functions/gmail-authorize/index.ts` | Creates a state-bound Google OAuth authorization URL for the signed-in user. |
| `supabase/functions/gmail-callback/index.ts` | Exchanges code, encrypts refresh token, stores connection, and redirects to settings. |
| `supabase/functions/gmail-sync/index.ts` | Performs historical/incremental discovery, classifies and groups attachments, de-duplicates, and creates draft candidates. |
| `supabase/functions/_shared/gmail-candidate-filter.ts` | Deterministically excludes sent/known-unrelated content and applies learned vendor rules to candidate mail. |
| `supabase/functions/create-tax-export/index.ts` | Builds yearly ZIP packages and uploads a short-lived export artifact. |
| `src/types/finance.ts` | Expense, document, import, reporting, and export TypeScript interfaces/constants. |
| `src/lib/finance-storage.ts` | RLS-scoped CRUD, document uploads, signed download URLs, dashboard query helpers, and Edge Function invocation. |
| `src/lib/finance-calculations.ts` | Pure validation, totals, accounting date, year filters, deduplication helpers, and CSV row mapping. |
| `src/hooks/useExpenses.ts` | Zustand store for loading and mutating expenses and import candidates. |
| `src/hooks/useFinanceDashboard.ts` | Query/store for tax-year financial totals and chart series. |
| `src/components/expenses/ExpenseForm.tsx` | Accessible create/edit/review form with document picker and status action. |
| `src/components/expenses/ExpenseDocumentPanel.tsx` | Receipt upload, preview, replacement, and source provenance view. |
| `src/components/expenses/ExpenseFilters.tsx` | Year/category/status/search controls shared by the list and reports. |
| `src/components/expenses/ExpenseTable.tsx` | Expense list, sums, and actions. |
| `src/components/expenses/GmailSyncCard.tsx` | Gmail connection/schedule status, sync control, and imported-item summary. |
| `src/components/dashboard/FinanceSummary.tsx` | Revenue, expenses, profit, and draft-review summary cards. |
| `src/components/dashboard/IncomeExpenseChart.tsx` | Monthly income/expense/profit data visualization. |
| `src/components/reports/AnnualExportCard.tsx` | Year selector, export package controls, readiness errors, and download link. |
| `src/pages/Expenses.tsx` | Expense list and review queue route. |
| `src/pages/NewExpense.tsx` | Manual expense entry route. |
| `src/pages/EditExpense.tsx` | Existing expense edit/review route. |
| `src/pages/Reports.tsx` | Annual exports and report totals route. |
| `src/pages/Settings.tsx` | Finance/Gmail settings panel and accountant reporting-date preference. |
| `src/App.tsx`, `src/components/layout/Sidebar.tsx` | Routes and Finance navigation. |
| `src/lib/pdf-generator.tsx` | Return the generated invoice `Blob` and support archival upload when issuing. |
| `src/components/invoice/InvoiceForm.tsx` | Explicit draft versus issue flow and frozen-PDF upload. |
| `src/**/*.test.ts(x)` | Unit and component tests named within individual tasks. |

### Task 0: Capture and verify the existing Supabase baseline

**Files:**
- Create: `supabase/config.toml`
- Create: `supabase/migrations/202608300000_existing_schema.sql`
- Create: `docs/supabase-baseline.md`

**Interfaces:**
- Produces a reproducible baseline containing the existing `business_settings`, `clients`, `invoices`, `invoice_line_items`, views, constraints, functions, storage configuration, and RLS policies.
- Produces an ownership decision for every existing table before Task 1 adds owner-scoped finance records.

- [ ] **Step 1: Initialize and link the local Supabase project**

Read the project ref from the configured `VITE_SUPABASE_URL`, initialize the checked-in Supabase directory, and link it without printing keys:

```bash
finance_project_ref="$(sed -nE 's#VITE_SUPABASE_URL=https://([^.]+)\.supabase\.co#\1#p' .env)"
test -n "$finance_project_ref"
npx supabase init
npx supabase link --project-ref "$finance_project_ref"
```

Expected: the CLI links to the same project used by `src/lib/supabase.ts`.

- [ ] **Step 2: Pull the remote schema into a baseline migration**

Run:

```bash
npx supabase db pull 202608300000_existing_schema
```

Expected: `supabase/migrations/202608300000_existing_schema.sql` contains the current public schema. Do not hand-edit the pulled baseline to add finance features.

- [ ] **Step 3: Record ownership and policy evidence**

In `docs/supabase-baseline.md`, list each current table/view, primary/foreign keys, whether it has `user_id`, and its RLS policies. Record the exact migration needed if current invoices/clients/settings are still single-user rows. The finance migration must either add/backfill owner IDs consistently or explicitly preserve single-user access; it may not mix owner-scoped expenses with globally readable invoices.

- [ ] **Step 4: Verify the baseline from scratch**

Run:

```bash
npx supabase start
npx supabase db reset
npm run build
```

Expected: local Supabase applies the baseline and the existing app still builds. Stop and correct the baseline if any current relation referenced by `src/lib/storage.ts` is missing.

- [ ] **Step 5: Commit**

```bash
git add supabase/config.toml supabase/migrations/202608300000_existing_schema.sql docs/supabase-baseline.md
git commit -m "chore: capture Supabase schema baseline"
```

### Task 1: Establish finance schema, private storage, and test harness

**Files:**
- Create: `supabase/migrations/202608300001_finance_dashboard.sql`
- Create: `src/lib/finance-calculations.test.ts`
- Modify: `package.json`
- Modify: `vite.config.ts`

**Interfaces:**
- Consumes the verified ownership and schema baseline from Task 0.
- Produces database tables `expenses`, `expense_documents`, `expense_vendor_rules`, `gmail_connections`, `gmail_oauth_states`, `gmail_imports`, `gmail_sync_runs`, and `tax_export_jobs`.
- Produces private buckets `expense-documents`, `issued-invoices`, and `tax-exports` and adds `invoices.pdf_storage_path text` plus `invoices.pdf_sha256 text`.
- Produces the command `npm run test` using Vitest.

- [ ] **Step 1: Add test packages and scripts**

Add `vitest`, `jsdom`, `@testing-library/react`, and `@testing-library/jest-dom` as dev dependencies, then add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

Configure `vite.config.ts` with `test: { environment: 'jsdom', setupFiles: ['./src/test/setup.ts'] }` and create `src/test/setup.ts` importing `@testing-library/jest-dom/vitest`.

- [ ] **Step 2: Write the failing finance-calculation test**

```ts
import { describe, expect, it } from 'vitest';
import { accountingDateForExpense, expenseTotal } from './finance-calculations';

describe('accountingDateForExpense', () => {
  it('prefers the payment date and otherwise uses the document date', () => {
    expect(accountingDateForExpense({ expenseDate: '2026-03-05', paidDate: '2026-03-12' }))
      .toBe('2026-03-12');
    expect(accountingDateForExpense({ expenseDate: '2026-03-05', paidDate: undefined }))
      .toBe('2026-03-05');
  });
});

describe('expenseTotal', () => {
  it('adds net and VAT with two-decimal precision', () => {
    expect(expenseTotal(19.99, 3.8)).toBe(23.79);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test -- src/lib/finance-calculations.test.ts`

Expected: FAIL because `finance-calculations` does not exist.

- [ ] **Step 4: Add the migration**

Create `expenses` with `id uuid primary key default gen_random_uuid()`, user ownership, `vendor`, optional `vendor_invoice_number`, `category`, `description`, `expense_date`, nullable `paid_date`, `net_amount`, `vat_amount`, generated/stored `gross_amount`, currency fixed by check to `EUR`, `status`, `source`, `notes`, `voided_at`, `void_reason`, and timestamps. Checks must enforce non-negative amounts, allowed enum-like values, and require a void reason whenever status is `voided`. Create `expense_documents` with an expense FK, document role (`invoice | receipt | supporting`), `is_primary`, `storage_path`, filename, declared/detected MIME type, size, SHA-256, and unique `(user_id, sha256)`.

Create `expense_vendor_rules` keyed by normalized sender domain/vendor with action `always_include | review | ignore`, optional default category, source (`learned | manual`), and timestamps. Create `gmail_connections` with user id, Gmail address, encrypted token fields, status, `history_id`, `last_synced_at`, and timestamps; do not grant client `select` access to token columns. Create expiring/single-use `gmail_oauth_states`, per-run `gmail_sync_runs`, and `gmail_imports` with unique Gmail message/attachment IDs, source metadata, checksum, `expense_id`, document role, deterministic filter reason/rule, and import state.

Use indexes on `(user_id, expense_date desc)`, `(user_id, paid_date desc)`, `(user_id, status)`, normalized vendor/domain, and Gmail’s unique source identifier. Enable RLS on every table. Add owner-only policies for expenses/documents/vendor rules/imports/sync runs/exports; allow `gmail_connections` client access only through a `gmail_connection_status` view that excludes tokens. Set bucket MIME/size restrictions and Storage RLS that checks the first folder segment equals `auth.uid()::text`. Add an owner-only append/update audit table or trigger that records booking and voiding transitions; disallow changing monetary/source/document identity fields after an expense is voided.

- [ ] **Step 5: Implement the minimal pure calculation module**

```ts
export function accountingDateForExpense(input: { expenseDate: string; paidDate?: string }) {
  return input.paidDate || input.expenseDate;
}

export function expenseTotal(netAmount: number, vatAmount: number) {
  return Math.round((netAmount + vatAmount) * 100) / 100;
}
```

- [ ] **Step 6: Run verification**

Run: `npm run test -- src/lib/finance-calculations.test.ts && npm run build && npm run lint`

Expected: all pass. Apply the migration to a disposable local Supabase instance before applying it to the production project.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vite.config.ts src/test/setup.ts src/lib/finance-calculations.ts src/lib/finance-calculations.test.ts supabase/migrations/202608300001_finance_dashboard.sql
git commit -m "feat: add finance data foundation"
```

### Task 2: Define finance models and RLS-scoped client data access

**Files:**
- Create: `src/types/finance.ts`
- Create: `src/lib/finance-storage.ts`
- Create: `src/lib/finance-storage.test.ts`
- Modify: `src/lib/storage.ts`

**Interfaces:**
- Consumes: schema from Task 1 and `supabase` from `src/lib/supabase.ts`.
- Produces `Expense`, `ExpenseDocument`, `ExpenseStatus`, `ExpenseCategory`, `ExpenseInput`, `getExpenses`, `getExpenseById`, `saveExpense`, `deleteDraftExpense`, `voidExpense`, `uploadExpenseDocument`, `getDocumentDownloadUrl`, and `getMissingInvoicePdfIds`.

- [ ] **Step 1: Write failing mapping and validation tests**

```ts
import { describe, expect, it } from 'vitest';
import { toExpense } from './finance-storage';

it('maps numeric database values and documents to an Expense', () => {
  expect(toExpense({ id: 'e1', vendor: 'Figma', net_amount: '10.00', vat_amount: '1.90', gross_amount: '11.90', expense_date: '2026-01-05', paid_date: null, category: 'software', description: null, currency: 'EUR', status: 'booked', source: 'upload', notes: null, created_at: '2026-01-05T00:00:00Z', updated_at: '2026-01-05T00:00:00Z', expense_documents: [] }).grossAmount).toBe(11.9);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- src/lib/finance-storage.test.ts`

Expected: FAIL because the module/type does not exist.

- [ ] **Step 3: Create stable domain types and mappings**

Define categories as `software | equipment | office | travel | professional_services | marketing | telecommunications | insurance | training | other`, statuses as `needs_review | booked | voided`, and sources as `upload | gmail`. Keep `toExpense` exported only for test coverage; it must convert numeric strings and order documents deterministically with the primary invoice first.

```ts
export interface ExpenseInput {
  vendor: string;
  vendorInvoiceNumber?: string;
  category: ExpenseCategory;
  description?: string;
  expenseDate: string;
  paidDate?: string;
  netAmount: number;
  vatAmount: number;
  currency: 'EUR';
  status: ExpenseStatus;
  notes?: string;
}
```

Implement `deleteDraftExpense(id)` with a database status precondition of `needs_review`. Implement `voidExpense(id, reason)` with a non-empty reason and a database transaction that retains documents and source metadata. Any attempt to hard-delete a booked or voided row must return a typed `FinancialRecordImmutableError`.

`uploadExpenseDocument(file, expenseId)` must reject unsupported MIME/oversize files before upload, calculate `crypto.subtle.digest('SHA-256', await file.arrayBuffer())`, upload to `expense-documents/<userId>/<expenseId>/<checksum>-<safe-name>`, then insert document metadata. If the database insert fails, remove the object. If a duplicate checksum exists, surface a specific duplicate error and leave the existing document untouched.

- [ ] **Step 4: Add issued-PDF archival helpers without changing issuance UI**

Implement `uploadIssuedInvoicePdf(invoiceId: string, blob: Blob): Promise<void>` and `getMissingInvoicePdfIds(year: number): Promise<string[]>`. Store a hash and path `issued-invoices/<userId>/<invoiceId>/<sha256>.pdf`; update only the current invoice row. The helper must refuse any non-PDF blob and must not overwrite an existing immutable file without a deliberate backfill confirmation in a later UI task.

- [ ] **Step 5: Run verification**

Run: `npm run test -- src/lib/finance-storage.test.ts && npm run build && npm run lint`

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/types/finance.ts src/lib/finance-storage.ts src/lib/finance-storage.test.ts src/lib/storage.ts
git commit -m "feat: add expense data access and secure documents"
```

### Task 3: Ship manual expense capture and review before Gmail

**Files:**
- Create: `src/hooks/useExpenses.ts`
- Create: `src/components/expenses/ExpenseForm.tsx`
- Create: `src/components/expenses/ExpenseDocumentPanel.tsx`
- Create: `src/components/expenses/ExpenseForm.test.tsx`
- Create: `src/pages/Expenses.tsx`
- Create: `src/pages/NewExpense.tsx`
- Create: `src/pages/EditExpense.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/layout/Sidebar.tsx`

**Interfaces:**
- Consumes: Task 2’s `ExpenseInput` and storage functions.
- Produces `/expenses`, `/expenses/new`, and `/expenses/:id/edit`; `useExpenses` methods `loadExpenses`, `createExpense`, `updateExpense`, `deleteDraftExpense`, `bookExpense`, and `voidExpense`.

- [ ] **Step 1: Write the failing form behavior test**

```tsx
it('keeps a new uploaded receipt in review until the user books it', async () => {
  render(<ExpenseForm initialStatus="needs_review" onSave={onSave} />);
  await userEvent.type(screen.getByLabelText(/vendor/i), 'Figma');
  await userEvent.click(screen.getByRole('button', { name: /save for review/i }));
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ vendor: 'Figma', status: 'needs_review' }));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- src/components/expenses/ExpenseForm.test.tsx`

Expected: FAIL because the component is missing.

- [ ] **Step 3: Implement store and accessible form**

Create the Zustand store with busy/error state and await each persistence operation before mutating local state. Build a React Hook Form/Zod form containing vendor, category, description, document date, paid date, net, VAT, calculated gross, notes, receipt picker, and status action. Require vendor, category, date, non-negative money values, and one document before enabling **Book expense**. Permit **Save for review** with an attachment, but show a clear missing-fields summary.

`ExpenseDocumentPanel` previews PDFs/images through an expiring signed URL, labels Gmail-origin documents and document roles, and has an explicit replace/remove action for review drafts. Booked/voided documents are read-only. Removing a draft document must first delete its database reference within an operation that can be retried, then remove an otherwise-unreferenced storage object; refresh the detail state and surface an orphan cleanup warning if storage deletion fails.

- [ ] **Step 4: Implement list, review queue, and routing**

`/expenses` defaults to `needs_review` first, has a separate booked list, and has an empty state linking to `/expenses/new`. Add `Receipt` navigation entry named **Expenses** immediately after **Invoices**. Add routes under the authenticated `Layout`; no route may be reachable outside `AuthGate`.

- [ ] **Step 5: Run verification**

Run: `npm run test -- src/components/expenses/ExpenseForm.test.tsx && npm run build && npm run lint`

Expected: all pass. Manually upload a sample PDF and verify its signed preview stops working after its expiry and can be re-opened by the current user.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useExpenses.ts src/components/expenses src/pages/Expenses.tsx src/pages/NewExpense.tsx src/pages/EditExpense.tsx src/App.tsx src/components/layout/Sidebar.tsx
git commit -m "feat: add receipt-backed expense tracking"
```

### Task 4: Freeze issued invoice PDFs and make the invoice export-ready

**Files:**
- Create: `src/lib/invoice-archive.test.ts`
- Modify: `src/lib/pdf-generator.tsx`
- Modify: `src/components/invoice/InvoiceForm.tsx`
- Modify: `src/pages/InvoicesList.tsx`
- Modify: `src/pages/ViewInvoice.tsx`

**Interfaces:**
- Consumes: `uploadIssuedInvoicePdf` from Task 2 and existing invoice forms.
- Produces `generateInvoicePdfBlob(invoice, settings): Promise<Blob>` and an explicit invoice issue action.

- [ ] **Step 1: Write the failing archive test**

```ts
it('stores a PDF only after a draft is issued', async () => {
  await archiveIssuedInvoicePdf({ ...invoice, status: 'draft' }, settings);
  expect(uploadIssuedInvoicePdf).not.toHaveBeenCalled();
  await archiveIssuedInvoicePdf({ ...invoice, status: 'pending' }, settings);
  expect(uploadIssuedInvoicePdf).toHaveBeenCalledWith(invoice.id, expect.any(Blob));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- src/lib/invoice-archive.test.ts`

Expected: FAIL because the archive function is absent.

- [ ] **Step 3: Refactor PDF generation without changing its visual output**

Extract the current `pdf(<InvoicePDF ... />).toBlob()` logic into `generateInvoicePdfBlob`. Keep `generatePDF` as a thin browser-download wrapper using the blob. Implement `archiveIssuedInvoicePdf(invoice, settings)` that no-ops for drafts, reuses an existing archive path, and otherwise uploads exactly the blob it generated.

- [ ] **Step 4: Add the issue transition**

In the invoice form, present **Save draft** and **Issue invoice** rather than relying on a generic save. Issue must save the invoice as `pending`, archive its PDF, and report a recoverable error if archival fails (the invoice is visible as pending with a `PDF archive missing` warning and a retry action). Existing pending/paid invoices get a **Backfill archived PDF** action after confirmation; never silently replace their archive.

- [ ] **Step 5: Run verification**

Run: `npm run test -- src/lib/invoice-archive.test.ts && npm run build && npm run lint`

Expected: all pass. Issue an invoice, change business settings, download the archived version, and confirm it retains the original issued details.

- [ ] **Step 6: Commit**

```bash
git add src/lib/pdf-generator.tsx src/lib/invoice-archive.test.ts src/components/invoice/InvoiceForm.tsx src/pages/InvoicesList.tsx src/pages/ViewInvoice.tsx
git commit -m "feat: archive issued invoice PDFs"
```

### Task 5: Add finance dashboard totals and filters

**Files:**
- Create: `src/hooks/useFinanceDashboard.ts`
- Create: `src/components/dashboard/FinanceSummary.tsx`
- Create: `src/components/dashboard/IncomeExpenseChart.tsx`
- Create: `src/components/dashboard/FinanceSummary.test.tsx`
- Create: `src/components/expenses/ExpenseFilters.tsx`
- Create: `src/components/expenses/ExpenseTable.tsx`
- Modify: `src/pages/Dashboard.tsx`
- Modify: `src/pages/Expenses.tsx`

**Interfaces:**
- Consumes: invoices, booked expenses, `accountingDateForExpense`, and filters.
- Produces `FinanceDashboardData` with `issuedRevenue`, `paidRevenue`, `bookedExpenses`, `operatingProfit`, `needsReviewCount`, and 12 monthly values for a selected year.

- [ ] **Step 1: Write failing summary test**

```tsx
it('calculates operating profit from issued revenue minus booked expenses', () => {
  render(<FinanceSummary data={{ issuedRevenue: 1500, paidRevenue: 900, bookedExpenses: 275, operatingProfit: 1225, needsReviewCount: 2 }} />);
  expect(screen.getByText('€1,225.00')).toBeInTheDocument();
  expect(screen.getByText(/2 expenses need review/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- src/components/dashboard/FinanceSummary.test.tsx`

Expected: FAIL because the component is absent.

- [ ] **Step 3: Implement totals as pure, documented rules**

Use `invoice.date` for issued revenue, `paidDate` for paid revenue, and `accountingDateForExpense` for booked expenses. Do not include draft/review or voided expenses in profit. Preserve net, VAT, and gross in reports; use gross booked expense for the EUR-only Kleinunternehmer dashboard profile and label the rule explicitly. Label the result card **Operating result (before tax)** and provide a tooltip stating the calculation is an overview, not a filed return and must be confirmed with the tax advisor.

- [ ] **Step 4: Implement UX**

Add a dashboard year selector defaulting to the current year. Add five cards: issued revenue, paid revenue, booked expenses, operating result, and expenses requiring review. Add a monthly grouped chart (issued revenue, expenses, operating result). Expense filters must support year, category, status, source, vendor/full-text search, and date sorting; table totals must only sum the filtered booked rows.

- [ ] **Step 5: Run verification**

Run: `npm run test -- src/components/dashboard/FinanceSummary.test.tsx && npm run build && npm run lint`

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useFinanceDashboard.ts src/components/dashboard src/components/expenses/ExpenseFilters.tsx src/components/expenses/ExpenseTable.tsx src/pages/Dashboard.tsx src/pages/Expenses.tsx
git commit -m "feat: add income and expense dashboard"
```

### Task 6: Implement annual CSV and ZIP exports

**Files:**
- Create: `src/components/reports/AnnualExportCard.tsx`
- Create: `src/components/reports/AnnualExportCard.test.tsx`
- Create: `src/pages/Reports.tsx`
- Create: `supabase/functions/create-tax-export/index.ts`
- Create: `supabase/functions/create-tax-export/deno.json`
- Modify: `src/lib/finance-storage.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/layout/Sidebar.tsx`

**Interfaces:**
- Consumes: private document paths, frozen invoice paths, and finance reports.
- Produces `requestAnnualExport(kind: 'issued_invoices' | 'business_expenses', year: number): Promise<TaxExportJob>` and `/reports`.

- [ ] **Step 1: Write failing export-readiness test**

```tsx
it('blocks an invoice export with missing archived PDFs', async () => {
  render(<AnnualExportCard year={2026} missingInvoiceCount={2} onRequest={vi.fn()} />);
  expect(screen.getByRole('button', { name: /download issued invoices/i })).toBeDisabled();
  expect(screen.getByText(/2 issued invoices need PDF backfill/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- src/components/reports/AnnualExportCard.test.tsx`

Expected: FAIL because reports UI is absent.

- [ ] **Step 3: Implement the authenticated export function**

Require a user JWT and derive `user_id` from the verified token; never accept a user id from the request. Validate `year` is an integer from 2000 through current year. Query only owner-visible rows. For issued invoices use `date >= YYYY-01-01 and date < (YYYY+1)-01-01`; require non-null `pdf_storage_path`. For booked expenses calculate/report the selected accounting date, include each linked original document, and reject/report any booked expense with no document. Exclude voided expenses from totals and include `voided-expenses-YYYY.csv` as a separate audit register when the selected year has voided records.

Create UTF-8 BOM CSVs named `issued-invoices-YYYY.csv` and `business-expenses-YYYY.csv` with semicolon delimiters. Invoice columns: invoice number, issue date, client, net, VAT, gross, status, PDF filename. Expense columns: accounting date, document date, paid date, vendor, vendor invoice number, category, description, net, VAT, gross, source, primary invoice filename, supporting-document filenames. Add `README.txt` explaining year/filter rule, generation timestamp, included-count, missing-count (which must be zero for a final ZIP), voided-count, and total net/VAT/gross. Build a ZIP using original bytes from private storage and upload it to `tax-exports/<user_id>/<kind>-<year>-<job-id>.zip`; create a completed/failed `tax_export_jobs` row and return a 15-minute signed download URL. Schedule deletion of ZIP objects and completed job download paths after 24 hours.

- [ ] **Step 4: Implement the reports UI**

Create `/reports` with an explicit year selector, total preview, two independent cards, file-count preview, and blocked-state explanations. Add **Reports** navigation after Expenses. Poll the export job only while it is queued/running; show the server-provided error in a safe generic form and do not produce a partial final ZIP.

- [ ] **Step 5: Run verification**

Run: `npm run test -- src/components/reports/AnnualExportCard.test.tsx && npm run build && npm run lint`

Expected: all pass. In a local test project, inspect a ZIP: it has semicolon CSV, UTF-8 BOM, `README.txt`, expected PDF count, and no document belonging to another test user.

- [ ] **Step 6: Commit**

```bash
git add src/components/reports src/pages/Reports.tsx src/lib/finance-storage.ts src/App.tsx src/components/layout/Sidebar.tsx supabase/functions/create-tax-export
git commit -m "feat: export annual tax document packages"
```

### Task 7: Add Gmail OAuth connection status and secure authorization

**Files:**
- Create: `supabase/functions/gmail-authorize/index.ts`
- Create: `supabase/functions/gmail-callback/index.ts`
- Create: `supabase/functions/_shared/google-oauth.ts`
- Create: `src/components/expenses/GmailSyncCard.tsx`
- Create: `src/components/expenses/GmailSyncCard.test.tsx`
- Modify: `src/pages/Settings.tsx`
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Consumes: `gmail_connections`, authenticated Edge Function invocation, Google OAuth web-server flow.
- Produces `startGmailConnection(): Promise<{ authorizationUrl: string }>` and an owner-visible connection status with sync timestamps/state, not OAuth tokens.

- [ ] **Step 1: Write the failing connected-state component test**

```tsx
it('offers sync and shows the automatic schedule only after Gmail is active', () => {
  render(<GmailSyncCard connection={{ status: 'active', gmailAddress: 'me@example.com', lastSyncedAt: null, dailySyncEnabled: true }} onConnect={vi.fn()} onSync={vi.fn()} />);
  expect(screen.getByRole('button', { name: /sync now/i })).toBeEnabled();
  expect(screen.getByText(/checked automatically every day/i)).toBeInTheDocument();
  expect(screen.queryByText(/refresh token/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- src/components/expenses/GmailSyncCard.test.tsx`

Expected: FAIL because the component is absent.

- [ ] **Step 3: Implement OAuth endpoints**

`gmail-authorize` must verify the caller JWT, create a high-entropy, single-use state row bound to user and callback expiry, and return a Google authorization URL using authorization-code flow, `access_type=offline`, `prompt=consent`, a precise callback URL, and only `gmail.readonly`. `gmail-callback` must validate and consume state, exchange the code server-side, encrypt the refresh token with `GMAIL_TOKEN_ENCRYPTION_KEY`, resolve the Gmail profile email, and store only encrypted token data with the user id. It must redirect to `/settings/finance?gmail=connected`.

Both functions must send strict CORS headers only for the configured app origin, redact provider response bodies, and handle revoked/expired connections by setting status `reauthorization_required` without deleting import history. Add secrets `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, and `GMAIL_TOKEN_ENCRYPTION_KEY` to the function environment—not Vite variables.

- [ ] **Step 4: Implement settings and disconnect behavior**

Add `finance` to settings routes/sidebar. State in clear copy: the app searches incoming mail for likely invoice/receipt documents during an initial backfill and daily incremental checks, does not modify Gmail, excludes sent client invoices, and creates review drafts. Provide **Sync now**, last-success/last-failure timestamps, and a paused/active schedule switch. Disconnect must revoke the Google token where possible, securely erase encrypted tokens, stop scheduled sync, and retain already imported receipts/expenses.

- [ ] **Step 5: Run verification**

Run: `npm run test -- src/components/expenses/GmailSyncCard.test.tsx && npm run build && npm run lint`

Expected: all pass. Test callback state replay, callback for a different signed-in user, invalid redirect origin, expired state, failed token exchange, and disconnect; each must fail closed.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/gmail-authorize supabase/functions/gmail-callback supabase/functions/_shared/google-oauth.ts src/components/expenses/GmailSyncCard.tsx src/components/expenses/GmailSyncCard.test.tsx src/pages/Settings.tsx .env.example README.md
git commit -m "feat: add secure Gmail connection settings"
```

### Task 8: Discover and group Gmail expense documents automatically

**Files:**
- Create: `supabase/functions/gmail-sync/index.ts`
- Create: `supabase/functions/gmail-sync/index.test.ts`
- Create: `supabase/functions/gmail-sync-scheduled/index.ts`
- Create: `supabase/functions/_shared/gmail-candidate-filter.ts`
- Create: `supabase/functions/_shared/gmail-candidate-filter.test.ts`
- Modify: `src/lib/finance-storage.ts`
- Modify: `src/components/expenses/GmailSyncCard.tsx`
- Modify: `src/hooks/useExpenses.ts`

**Interfaces:**
- Consumes: active Gmail connection/token, history cursor, vendor rules, and `gmail_imports` unique constraints.
- Produces `syncGmailReceipts(): Promise<{ candidates: number; documents: number; ignored: number; skipped: number; needsReview: number }>` and grouped review expenses with `source: 'gmail'`.

- [ ] **Step 1: Write the failing idempotency test**

```ts
it('groups an invoice and receipt while excluding unrelated and sent PDFs', async () => {
  gmailListMock.mockResolvedValue([
    incomingMessage('message-a', ['Invoice-123.pdf', 'Receipt-123.pdf', 'Terms.pdf']),
    sentMessage('message-b', ['Rechnung-2026-008.pdf']),
  ]);
  const result = await syncForUser(userId);
  expect(result).toEqual({ candidates: 1, documents: 2, ignored: 2, skipped: 0, needsReview: 1 });
  expect(db.insertExpense).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test supabase/functions/gmail-sync/index.test.ts`

Expected: FAIL because the sync function is absent.

- [ ] **Step 3: Implement constrained, idempotent sync**

Verify the JWT for manual calls; the scheduled wrapper must accept only the dedicated Supabase cron secret and then iterate active connections without exposing user data across runs. Load/decrypt one user's token only in memory. For the first run, page through incoming mail matching `-in:sent has:attachment` plus invoice/receipt subject and filename signals. For later runs, use the stored Gmail history cursor and fall back to a bounded date search if Gmail says the cursor is too old.

Traverse MIME parts recursively. Accept PDF/JPEG/PNG attachments up to 15 MB. Accept `application/octet-stream` only when the filename ends with `.pdf` and the fetched bytes begin with `%PDF-`; use detected MIME type for storage. Reject executables, archives, HTML, oversized/corrupt files, and inline assets. Exclude `SENT`, messages sent by the connected mailbox, and filenames/numbers matching the app's own issued invoices before downloading when metadata is sufficient.

Filter remaining attachments deterministically using normalized sender domain, subject, filename, extension/file signature, and `expense_vendor_rules`; do not parse monetary fields and do not call an AI provider. Group likely invoice/receipt attachments by Gmail message. Prefer filenames containing `invoice`, `rechnung`, `receipt`, `beleg`, or `quittung`; deprioritize names containing `terms`, `agb`, `privacy`, `datenschutz`, `returns`, `retoure`, or `widerruf`. Choose the first invoice-named PDF as the tentative primary document and retain receipt-named files as supporting evidence. If several invoice-named files remain, keep them in one candidate flagged `multiple_possible_invoices` so the user can split it manually. Before copying, enforce unique Gmail source IDs and SHA-256. Insert one `needs_review` expense per candidate, prefill only sender-derived vendor text and Gmail received date, and link relevant documents; never persist full mail bodies and never auto-book.

Return summary counts and generic per-item errors. Mark expired/revoked connections `reauthorization_required` without looping. Persist pagination and history cursor only after the corresponding imports commit. The first backfill may span multiple runs of at most 100 messages/200 attachments each; automatically enqueue the next page until exhausted. Schedule `gmail-sync-scheduled` once daily and retain **Sync now** for immediate checks.

- [ ] **Step 4: Wire the review queue**

After a manual sync, reload state and navigate to `/expenses?status=needs_review`. Show source, Gmail received date, tentative primary/supporting filenames, deterministic filter reason, and ignored/duplicate counts. The editor requires the user to enter/confirm vendor, invoice number, document date, paid date, category, net, VAT, and gross; validate `net + VAT = gross` within €0.01 before booking. Provide **Set as primary**, **Remove from candidate**, and **Split into separate expense** for multi-document mail. When the user books or ignores a recurring sender, offer **Remember for this vendor** and persist `always_include` or `ignore`; `always_include` still means create a review candidate, never book it.

- [ ] **Step 5: Run verification**

Run: `deno test supabase/functions/gmail-sync/index.test.ts && npm run test && npm run build && npm run lint`

Expected: all pass. Use the connected Gmail account for a supervised staging backfill. Confirm that an incoming supplier email with invoice and receipt becomes one draft with two documents, unrelated shopping/terms PDFs remain unbooked, sent client invoices are excluded, and a second sync creates no duplicates. Do not apply Gmail labels or modify messages during the test.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/gmail-sync supabase/functions/gmail-sync-scheduled supabase/functions/_shared/gmail-candidate-filter.ts supabase/functions/_shared/gmail-candidate-filter.test.ts src/lib/finance-storage.ts src/components/expenses/GmailSyncCard.tsx src/hooks/useExpenses.ts
git commit -m "feat: discover Gmail expense documents for review"
```

### Task 9: Security review, operational documentation, and release validation

**Files:**
- Create: `docs/finance-dashboard-operations.md`
- Create: `docs/finance-dashboard-test-checklist.md`
- Modify: `README.md`
- Modify: `.env.example`

**Interfaces:**
- Consumes: completed features and deployment configuration.
- Produces a user/admin runbook, privacy/deletion behavior, rollout checklist, and documented recovery steps.

- [ ] **Step 1: Document exact operations**

Write the OAuth setup (consent screen, redirect URI, restricted-scope caveat), all function secret names, bucket configuration, migration order, backfill procedure for old invoice PDFs, receipt retention/delete behavior, Gmail disconnect/re-auth behavior, and tax-export meaning. State plainly that the reports are organization aids and need accountant confirmation before filing.

- [ ] **Step 2: Create a release test checklist**

Include the following non-negotiable assertions: unauthenticated requests get 401; user A cannot access user B rows/objects/export URL; a 16 MB PDF is rejected; duplicate checksum/source import is skipped; drafts and voided rows stay out of expense totals; booked rows cannot be hard-deleted; an issued invoice’s frozen PDF survives setting changes; missing documents block final export; Gmail consent asks only for `gmail.readonly`; Gmail `SENT` and issued invoice filenames are excluded; invoice+receipt pairs create one candidate; verified octet-stream PDFs are accepted; unrelated PDFs are ignored; daily sync is idempotent; disconnect removes server token access and stops cron processing; and each ZIP CSV total matches the dashboard for a fixed fixture year.

- [ ] **Step 3: Run full verification**

Run: `npm run test && npm run build && npm run lint`

Expected: all pass. Apply migration/functions to staging and execute the checklist with two test accounts before production rollout.

- [ ] **Step 4: Commit**

```bash
git add docs/finance-dashboard-operations.md docs/finance-dashboard-test-checklist.md README.md .env.example
git commit -m "docs: add finance dashboard rollout guide"
```

## Delivery sequence and release gates

1. Complete Task 0 before any implementation so existing Supabase data and access policies have a reproducible baseline.
2. Complete Tasks 1–3 for secure EUR expense storage, manual fallback, review/booking, and void/archive behavior.
3. Complete Tasks 7–8 as the core Gmail intake: native app OAuth, historical plus daily discovery, deterministic attachment filtering/grouping, learned vendor rules, and manual financial entry. Use the already connected Gmail connector only for read-only discovery and a supervised staging backfill; the app must obtain its own OAuth grant. Google classifies `gmail.readonly` as restricted, and server handling can trigger verification/security-assessment requirements. [Google scope guidance](https://developers.google.com/workspace/gmail/api/auth/scopes)
4. Complete Tasks 4–6 for frozen issued-invoice PDFs, combined finance dashboard, and annual tax packages.
5. Complete Task 9 before relying on exports with a tax advisor. Gmail intake may launch only after its fixture set shows correct deterministic grouping and deduplication; manual entry/review remains the booking gate.

## Self-review

- **Spec coverage:** schema baseline, manual expense entry, automatic Gmail discovery, grouped invoice/receipt documents, review workflow, immutable/voidable records, dashboard reporting, annual exports, ownership/security, and accounting-date semantics map to Tasks 0–9.
- **Deliberate boundary:** no tax-law calculation, VAT filing, bank reconciliation, Gmail message mutation/push notification, multi-currency conversion, or accountant portal is implicitly added.
- **Gmail evidence:** the read-only mailbox sample contained incoming business-style subscription invoices, personal purchases, outgoing client invoices, paired receipt/invoice PDFs, unrelated supporting PDFs, and PDFs declared as octet-stream. Tasks 7–8 cover each pattern with deterministic rules and manual review without storing mail bodies.
- **Gmail risk:** Tasks 7–8 isolate OAuth/tokens in Edge Functions, request the minimal attachment-capable Gmail scope, use bounded daily scans, and keep manual entry/review mandatory.
- **Extraction decision:** no GPT, OCR, or external document-extraction provider is part of this plan. Gmail supplies files and basic message metadata; the user enters financial fields manually.
- **Consistency:** the same terms (`needs_review`, `booked`, `voided`, `expenseDate`, `paidDate`, `vendorInvoiceNumber`, `documentRole`, `pdf_storage_path`) are used through schema, types, UI, and exports.
