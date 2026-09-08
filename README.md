# Invoice Management Dashboard

A full-featured invoice management system built with React, TypeScript, and shadcn/ui. Perfect for freelancers and small businesses to manage invoices, clients, and track revenue - all running locally with data persistence.

![Invoice Dashboard](https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=800)

## Features

### Dashboard
- Revenue overview with interactive charts
- Quick stats (monthly revenue, pending invoices, paid this month, total clients)
- Recent invoices with quick actions
- Top clients by revenue

### Invoice Management
- Create, edit, and delete invoices
- Live preview in German while editing in English
- Support for Kleinunternehmer (small business) regulation
- Multiple line items with automatic calculations
- PDF export with professional German invoice layout
- Status tracking (Draft, Pending, Paid, Overdue)

### Client Management
- Autocomplete from existing clients
- Quick client creation
- Client address book

### Settings
- Business information
- Bank details for invoices
- Invoice preferences (numbering, payment terms, VAT)
- Data export/import (JSON backup)

## Tech Stack

- **React 18** with TypeScript
- **React Router** for navigation
- **shadcn/ui** components (Radix UI + Tailwind CSS)
- **Recharts** for dashboard visualizations
- **jsPDF** for PDF generation
- **Zustand** for state management
- **date-fns** for date handling
- **localStorage** for data persistence

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd invoice-dashboard
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

4. Open [http://localhost:5173](http://localhost:5173) in your browser.

### Building for Production

```bash
npm run build
```

The built files will be in the `dist` directory.

## Project Structure

```
src/
├── components/
│   ├── ui/              # shadcn/ui components
│   ├── dashboard/       # Dashboard widgets
│   ├── invoice/         # Invoice form and preview
│   ├── layout/          # App layout components
│   └── settings/        # Settings components
├── pages/               # Route pages
├── lib/                 # Utilities and helpers
│   ├── storage.ts       # localStorage operations
│   ├── calculations.ts  # Invoice calculations
│   ├── formatting.ts    # Date and currency formatting
│   └── pdf-generator.ts # PDF export
├── hooks/               # Custom React hooks
└── types/               # TypeScript interfaces
```

## Usage

### First Time Setup

1. Go to **Settings** and fill in your business information
2. Add your bank details for invoices
3. Configure invoice preferences (Kleinunternehmer status, numbering format)

### Creating an Invoice

1. Click **Create Invoice** in the sidebar
2. Select or create a client
3. Add line items with descriptions, quantities, and prices
4. Review the live preview in German
5. Save or Save & Download PDF

### Managing Invoices

- View all invoices in the **Invoices** page
- Filter by status (Draft, Pending, Paid, Overdue)
- Search by invoice number or client name
- Mark invoices as paid
- Download PDFs anytime

### Data Backup

- Export all data as JSON from Settings > Data
- Import data from a previous backup
- Data is stored in browser localStorage

## German Invoice Compliance

The generated PDF invoices include:

- **Rechnung** header with invoice number
- Proper German address formatting
- Service period (Leistungszeitraum)
- Payment terms (Zahlungsziel)
- Bank details (IBAN, BIC)
- Kleinunternehmer clause (§ 19 UStG) when applicable
- Tax ID (W-IdNr) if provided

## Sample Data

The app includes sample data to help you get started. When you first open the app, you'll see example invoices and clients. You can clear this data from Settings > Data > Clear All Data.

## Browser Support

Works in all modern browsers:
- Chrome/Edge (recommended)
- Firefox
- Safari

## License

MIT License - feel free to use this for personal or commercial projects.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Gmail connection settings

Settings → Finance connects an owner's Gmail account using Google's web-server
authorization-code flow and only `https://www.googleapis.com/auth/gmail.readonly`.
The planned import worker searches incoming mail for likely invoice/receipt
documents, excludes sent client invoices, and creates expense review drafts.
Gmail content is never modified. This connection layer queues the initial
backfill and manual checks in `gmail_sync_runs`; the import worker and recurring
daily dispatcher are delivered separately. Deploy those before enabling Gmail
for users. A queued request is not a completed mailbox check.

Configure a Google **Web application** OAuth client, enable the Gmail API, and
register the exact `GOOGLE_OAUTH_REDIRECT_URI` below. Gmail readonly is a restricted
scope; complete Google's applicable consent-screen/verification requirements
before production use. Use a dedicated OAuth project because Google revocation
can invalidate other grants in the same project.

Store these values in **Supabase Edge Function secrets**, never `VITE_*` variables
or committed environment files:

| Function secret | Value |
| --- | --- |
| `GOOGLE_OAUTH_CLIENT_ID` | Google web application's client ID |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google web application's secret |
| `GOOGLE_OAUTH_REDIRECT_URI` | Exact `https://<project-ref>.supabase.co/functions/v1/gmail-callback` |
| `GMAIL_TOKEN_ENCRYPTION_KEY` | Base64 encoding of 32 cryptographically random bytes (e.g. `openssl rand -base64 32`) |
| `GMAIL_APP_ORIGIN` | Exact app origin without a slash/path, e.g. `https://<account>.github.io` |
| `GMAIL_APP_BASE_PATH` | `/invoice-app` for the current build; no trailing slash |

Local development can put function secrets in ignored `supabase/.env.local`
and use `supabase functions serve --env-file supabase/.env.local`.
Use an exact localhost/127.0.0.1 origin and callback for a separate development
client. Production URLs must use HTTPS. Both functions also use the Supabase
server-provided URL, anon key, and service-role key; the service-role key must
never enter the browser.

Apply `20260908183000_secure_gmail_connection_lifecycle.sql` before serving
`gmail-authorize` and `gmail-callback`. Their `verify_jwt = false` gateway setting
is intentional: every POST verifies the bearer token through Supabase Auth and
checks `is_owner`. No credential operation accepts a client-supplied user ID.
The callback's unauthenticated GET only relays the authorization code and state
to the fixed finance page in a fragment; it never exchanges or stores credentials.
The signed-in app immediately removes that fragment and POSTs it with its current
session. A different signed-in user cannot complete the connection. After the
authenticated callback succeeds, the app redirects to
`/invoice-app/settings/finance?gmail=connected`.

State contains 256 bits of randomness, is stored hashed, expires in ten minutes,
and is consumed atomically before token exchange. PKCE uses S256; the verifier
is encrypted. Tokens use AES-256-GCM with a fresh nonce and authenticated user/
purpose binding. Only the service role can read ciphertext or state. Client
responses contain status, timestamps, or fixed navigation URLs; provider error
bodies, OAuth tokens, and secrets are never logged or returned. CORS allows only
the configured app origin. Do not enable request-body/authorization-header
logging or persist OAuth callback query strings in upstream access logs.

Disconnect erases both encrypted tokens, invalidates pending/in-flight
authorization, disables the schedule, and fails queued/running jobs atomically
before attempting Google revocation. Imported receipts/expenses and connection
IDs remain intact. If Google cannot be reached, local erasure still succeeds and
the UI explains how to remove access in the Google account. Reconnection must use
the same mailbox so message IDs and import history remain consistent.

The worker must consume only active connections, honor `daily_sync_enabled` for
scheduled checks, and recheck connection state before storing imports. On a
revoked/expired refresh grant it must erase credentials, stop future jobs, and
set `reauthorization_required` without deleting imports. Ordinary access-token
expiry should refresh server-side. Update `last_synced_at` only on successful
checks and `last_failed_at` on failures; the projection trigger updates settings.

Keep the encryption key stable and protected. Key rotation needs re-encryption
of stored credentials/verifiers or explicit reconnection; replacing it blindly
makes existing encrypted data unreadable.

Security references: [Google OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server),
[Google OAuth best practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices),
[Gmail profile API](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/getProfile),
[Supabase function authentication](https://supabase.com/docs/guides/functions/auth),
[Supabase function secrets](https://supabase.com/docs/guides/functions/secrets).

Synthetic verification (no real Gmail access):

```bash
npm run test -- src/components/expenses/GmailSyncCard.test.tsx supabase/functions/_shared/google-oauth.test.ts
npx --yes deno check --config supabase/functions/gmail-authorize/deno.json supabase/functions/gmail-authorize/index.ts supabase/functions/gmail-callback/index.ts
docker exec -i supabase_db_finance-dashboard psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/gmail_oauth_lifecycle.integration.sql
```
