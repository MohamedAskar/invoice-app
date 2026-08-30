# Freelance Finance Dashboard Product Specification

## Objective

Extend InvoiceApp into a private freelance-finance dashboard that records business expenses with their source receipts, keeps an immutable copy of issued invoices, and produces a complete, shareable annual tax package.

## User journeys

1. **Record an expense:** The user uploads a PDF/JPG/PNG receipt, checks the proposed supplier/date/amount/category, corrects anything needed, and books it. The original file remains attached to the expense.
2. **Bring in subscription receipts from Gmail:** The user authorizes Gmail once. The app performs a historical discovery scan and then checks daily for likely supplier invoices without requiring the user to search, label, or forward messages. It excludes sent client invoices, groups an invoice and receipt from the same purchase into one candidate, ignores unrelated attachments, and learns vendor-specific import/ignore choices. Every candidate remains reviewable before it is booked.
3. **Review finances:** The dashboard displays revenue, paid revenue, deductible expenses, operating profit, and the current month/year. It clearly distinguishes booked versus draft expenses.
4. **Give records to the tax advisor:** The user selects a year and downloads one ZIP per package: `issued-invoices-YYYY.zip` and `business-expenses-YYYY.zip`. Each ZIP contains original/frozen PDFs and a German-friendly CSV index with totals and document references.

## Scope and decisions

- This is a single-user Supabase application today, but every new row and stored object is owned by `auth.uid()` so it remains safe if additional accounts are added.
- The release remains EUR-only, matching the existing app setting. Expense invoices must be recorded in EUR; multi-currency conversion is outside this plan.
- A booked expense has `expense_date` (document date), optional `paid_date`, and a report `accounting_date`. The report setting is **payment date when available, otherwise expense date**. The user and tax advisor must confirm whether this matches their accounting/tax method before relying on a tax filing export.
- Expense documents are retained in a private Supabase Storage bucket. No public URLs are stored; the UI obtains short-lived signed URLs only when a user previews/downloads a document.
- The issued-invoice PDF is frozen at the point the invoice moves from `draft` to `pending` (renamed in UI to **Issue invoice**). The frozen file, rather than a regenerated PDF using current settings, is used in annual exports.
- Gmail discovery uses the least-permissive attachment-capable scope, `gmail.readonly`. It searches incoming mail with invoice/receipt signals, excludes `SENT` and the app's issued-invoice filename/number pattern, and validates candidate attachments by file signature. The Gmail API permission is broader than the app's search behavior and remains a restricted Google scope.
- Gmail runs an initial backfill and a daily incremental sync, with **Sync now** available as a fallback. It persists Gmail message/attachment IDs and a history cursor so repeat scans are idempotent. It does not require the user to maintain a Gmail label.
- Gmail imports never silently book an expense and never move, label, delete, or send email. The app stores only the source message ID, attachment IDs, sender/domain, subject, received date, selected provenance fields, and copied documents—not full mail bodies.
- Multiple documents from one purchase become one expense candidate. An invoice is the primary document; a receipt is retained as supporting evidence. AGB, returns instructions, privacy policies, inline images, and sent client invoices are excluded.
- `application/pdf` is accepted directly. `application/octet-stream` is accepted only when the filename ends in `.pdf` and the decoded bytes start with the PDF signature; this covers real supplier mail that mislabels PDF attachments.
- Candidate filtering uses sender/domain, subject, attachment filename, file signature, and learned `always_include`, `review`, or `ignore` vendor rules. It does not inspect documents with an AI model and never books an expense automatically.
- Gmail supplies the source message metadata and receipt documents only. The expense review form may prefill sender-derived vendor text and the email received date as a convenience, but the user manually enters or confirms invoice number, document date, paid date, category, net, VAT, and gross before booking.
- If one email contains several likely invoice/receipt documents, the app groups them into one review candidate and lets the user select the primary document, remove unrelated supporting documents, or split the candidate into multiple expenses.
- Draft expenses may be deleted. Booked expenses are voided/archived rather than hard-deleted, and issued invoice documents remain immutable, so previously generated tax records do not silently change.
- The Gmail connection available to Codex can be used for discovery and a supervised initial backfill during implementation. The deployed invoice app must still obtain and store its own server-side Google OAuth grant; connector credentials are not exposed to application code.
- Exporting invoices means invoices **issued** in the selected calendar year. Exporting expenses uses the selected accounting-date rule and includes only `booked` expenses. Drafts are listed separately in-app and excluded from tax packages.

## Non-goals for this release

- Bank-feed reconciliation, payment initiation, double-entry bookkeeping, VAT return filing, and automatic tax advice.
- Gmail push notifications; the first version uses one daily incremental sync plus an explicit **Sync now** action.
- Support for non-receipt email content or unlimited attachment types.
- Multi-user collaboration or accountant portal access.

## Success criteria

- A user can create, edit, filter, and delete a draft expense while retaining its linked receipt; booked expenses can only be voided/archived.
- Historical and daily Gmail discovery requires no manual mailbox search or labeling and excludes sent client invoices.
- An email containing both a receipt and invoice creates one expense candidate with both documents, while unrelated PDFs in that email are excluded.
- Repeating the same Gmail sync cannot create a second expense candidate for the same attachment.
- An annual expense ZIP has a CSV, one primary invoice/receipt per booked expense, and any relevant supporting receipt documents associated with the same purchase.
- An annual issued-invoice ZIP has a CSV and exactly one frozen invoice PDF per included invoice; missing historical PDFs are visibly reported and can be backfilled by the user before a final export.
- A user cannot read another user’s expense metadata, OAuth connection, or receipt file through the browser client.

## Reference material

- [Google Gmail scope classification](https://developers.google.com/workspace/gmail/api/auth/scopes): `gmail.readonly` is restricted and server storage/transmission may require a security assessment.
- [Google server-side OAuth flow](https://developers.google.com/workspace/gmail/api/auth/web-server): use an authorization-code flow and store refresh tokens server-side for offline access.
- [Gmail attachment API](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages.attachments/get): attachment bytes are retrieved by message and attachment ID.
- [Supabase private-bucket access control](https://supabase.com/docs/guides/storage/security/access-control): protect documents with `storage.objects` RLS and signed URLs.
