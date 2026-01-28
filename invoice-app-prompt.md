# Invoice Management Dashboard - Development Prompt

## Overview
Build a full-featured invoice management system as a multi-page web application. This is a dashboard-style application for freelancers/small businesses to manage invoices, clients, and business settings - all running locally with data persistence.

## Tech Stack

### Core Technologies
- **Framework**: React with React Router for multi-page navigation
- **UI Library**: shadcn/ui components (NOT plain Tailwind)
- **Styling**: Tailwind CSS (as shadcn's foundation)
- **PDF Generation**: jsPDF + jsPDF-AutoTable or react-pdf
- **Charts/Analytics**: Recharts (for dashboard visualizations)
- **State Management**: React Context API or Zustand
- **Data Persistence**: Browser localStorage
- **Icons**: Lucide React (comes with shadcn/ui)
- **IDE**: Cursor (with potential MCP server integration for shadcn)

### Project Structure
```
invoice-dashboard/
├── src/
│   ├── components/
│   │   ├── ui/ (shadcn components)
│   │   │   ├── button.tsx
│   │   │   ├── input.tsx
│   │   │   ├── card.tsx
│   │   │   ├── table.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── select.tsx
│   │   │   └── ... (other shadcn components)
│   │   ├── dashboard/
│   │   │   ├── RevenueChart.tsx
│   │   │   ├── InvoiceStats.tsx
│   │   │   ├── RecentInvoices.tsx
│   │   │   └── ClientsList.tsx
│   │   ├── invoice/
│   │   │   ├── InvoiceForm.tsx
│   │   │   ├── InvoicePreview.tsx
│   │   │   ├── LineItemEditor.tsx
│   │   │   └── InvoiceList.tsx
│   │   ├── settings/
│   │   │   ├── BusinessSettings.tsx
│   │   │   ├── BankDetails.tsx
│   │   │   └── PreferencesSettings.tsx
│   │   └── layout/
│   │       ├── Sidebar.tsx
│   │       ├── Header.tsx
│   │       └── Layout.tsx
│   ├── pages/
│   │   ├── Dashboard.tsx
│   │   ├── CreateInvoice.tsx
│   │   ├── EditInvoice.tsx
│   │   ├── InvoicesList.tsx
│   │   └── Settings.tsx
│   ├── lib/
│   │   ├── utils.ts (shadcn utils)
│   │   ├── storage.ts (localStorage operations)
│   │   ├── calculations.ts (invoice calculations)
│   │   ├── formatting.ts (date, currency formatting)
│   │   └── pdf-generator.ts (PDF export logic)
│   ├── hooks/
│   │   ├── useInvoices.ts
│   │   ├── useSettings.ts
│   │   └── useLocalStorage.ts
│   ├── types/
│   │   └── invoice.ts (TypeScript interfaces)
│   ├── App.tsx
│   └── main.tsx
├── components.json (shadcn config)
├── tailwind.config.js
├── tsconfig.json
├── package.json
└── README.md
```

## Application Structure

### Multi-Page Navigation
Use React Router with the following routes:
- `/` - Dashboard (home page)
- `/invoices` - All invoices list
- `/invoices/new` - Create new invoice
- `/invoices/:id` - View invoice details
- `/invoices/:id/edit` - Edit existing invoice
- `/settings` - Settings page

### Sidebar Navigation (Always visible)
- Dashboard (home icon)
- Invoices (file-text icon)
- Create Invoice (plus icon, quick action)
- Settings (settings icon)

## Page Specifications

### 1. Dashboard Page (`/`)
**Purpose**: Overview of business health and quick insights

**Components**:
- **Header Stats Cards** (4 cards across):
  - Total Revenue (this month)
  - Pending Invoices (count + amount)
  - Paid Invoices (this month)
  - Total Clients (unique count)

- **Revenue Chart**:
  - Line or bar chart showing monthly revenue (last 6-12 months)
  - Use Recharts library
  - Show trends and growth

- **Recent Invoices Table**:
  - Last 5-10 invoices
  - Columns: Invoice #, Client, Date, Amount, Status (Paid/Pending/Overdue)
  - Click to view/edit
  - Quick actions (view, edit, mark as paid)

- **Top Clients Widget**:
  - List of clients by total revenue
  - Shows client name and total amount invoiced

**UI Notes**:
- Use shadcn Card components for widgets
- Clean, minimal design with Inter font
- Subtle shadows and borders
- Responsive grid layout

### 2. Invoices List Page (`/invoices`)
**Purpose**: View and manage all invoices

**Features**:
- Searchable/filterable table of all invoices
- Filter by: Status (All/Paid/Pending/Overdue), Date range, Client
- Sort by: Date, Amount, Client name, Invoice number
- Columns: Invoice #, Client, Date, Amount, Status, Actions
- Actions: View, Edit, Download PDF, Mark as Paid, Delete
- Pagination if many invoices
- "Create Invoice" button prominent at top

**UI Notes**:
- Use shadcn Table component
- Use shadcn Badge for status indicators
- Use shadcn DropdownMenu for actions
- Use shadcn Input for search
- Use shadcn Select for filters

### 3. Create Invoice Page (`/invoices/new`)
**Purpose**: Create new invoices with live preview

**Layout**: Two-panel (or responsive stacked on mobile)
- **Left Panel (60%)**: Form inputs in English
  - Auto-populated business details (from settings)
  - Client details (with autocomplete from previous clients)
  - Invoice metadata (number auto-incremented, date pickers)
  - Line items editor (add/remove rows dynamically)
  - Payment terms
  - Notes/additional info (optional)
  - Kleinunternehmer toggle

- **Right Panel (40%)**: Live preview in German
  - Real-time preview of invoice as it will appear in PDF
  - Uses the minimal invoice design (Inter font, clean layout)
  - Scrollable preview

**Form Fields**:
- Invoice number (auto-generated, editable)
- Invoice date (date picker, default: today)
- Service period (start/end date pickers)
- Client selection (dropdown with autocomplete or "Add new client")
- Client details: Name, Address (street, postal code, city)
- Line items:
  - Description
  - Sub-description (optional)
  - Quantity
  - Unit (dropdown: Tage, Stunden, Stück)
  - Unit price
  - Total (auto-calculated)
- Payment terms (default: 14 days)
- Bank details (auto-filled from settings, editable)
- Additional notes (textarea)

**Actions**:
- Save as Draft
- Save & Download PDF
- Cancel

**UI Notes**:
- Use shadcn Form components with validation
- Use shadcn Button for actions
- Use shadcn DatePicker for dates
- Use shadcn Textarea for notes
- Use shadcn Select for dropdowns

### 4. Edit Invoice Page (`/invoices/:id/edit`)
**Purpose**: Edit existing invoices

**Features**:
- Same layout as Create Invoice page
- Pre-populated with existing invoice data
- Can modify all fields
- Shows invoice status (Paid/Pending/Overdue)
- If invoice is marked as paid, show warning before editing
- Save changes or discard

**UI Notes**:
- Use shadcn Alert for warnings
- Same form components as create page

### 5. Settings Page (`/settings`)
**Purpose**: Manage business settings and preferences

**Sections** (use tabs or accordion):

**A. Business Information**
- Business/Your name
- Address (street, house number, postal code, city)
- Tax ID (optional field, can mark as "wird beantragt")
- Email, phone (optional)

**B. Bank Details**
- Account holder name
- IBAN
- BIC
- Bank name

**C. Invoice Preferences**
- Default payment terms (14, 30, 60 days)
- Default Kleinunternehmer status (toggle)
- Invoice number prefix (e.g., "2024-")
- Starting invoice number
- Currency (default: EUR)

**D. Data Management**
- Export all data (JSON)
- Import data
- Clear all data (with confirmation)

**Actions**:
- Save settings button
- Reset to defaults

**UI Notes**:
- Use shadcn Tabs for sections
- Use shadcn Switch for toggles
- Use shadcn Input for text fields
- Use shadcn Button for actions
- Use shadcn AlertDialog for destructive actions

## Data Models (TypeScript Interfaces)

```typescript
interface BusinessSettings {
  name: string;
  street: string;
  postalCode: string;
  city: string;
  taxNumber?: string;
  taxNumberPending: boolean;
  email?: string;
  phone?: string;
  bankDetails: {
    accountHolder: string;
    iban: string;
    bic: string;
    bankName: string;
  };
  preferences: {
    defaultPaymentTerms: number; // days
    isKleinunternehmer: boolean;
    invoicePrefix: string;
    startingInvoiceNumber: number;
    currency: string;
  };
}

interface Client {
  id: string;
  name: string;
  street: string;
  postalCode: string;
  city: string;
  email?: string;
  totalInvoiced: number; // calculated
}

interface LineItem {
  id: string;
  description: string;
  subDescription?: string;
  quantity: number;
  unit: string; // "Tage", "Stunden", "Stück"
  unitPrice: number;
  total: number; // quantity * unitPrice
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  date: string; // ISO date
  servicePeriodStart: string;
  servicePeriodEnd: string;
  clientId: string;
  client: Client;
  lineItems: LineItem[];
  subtotal: number;
  vatRate: number; // 0 if Kleinunternehmer
  vatAmount: number;
  total: number;
  paymentTerms: number; // days
  dueDate: string; // calculated
  status: "draft" | "pending" | "paid" | "overdue";
  paidDate?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}
```

## PDF Export Specifications

### Design
- Use the minimal invoice design from our previous conversation:
  - Clean header with "Rechnung" and invoice number
  - Side-by-side address blocks with labels
  - Metadata grid (date, period, payment terms)
  - Clean services table
  - **Cleaner payment details section**: Simple grid or list, no heavy styling
  - Kleinunternehmer clause at bottom
  - Professional, minimal aesthetic with Inter font

### Functionality
- Generate PDF from invoice data
- Filename: `Rechnung-[invoice-number]-[date].pdf`
- Auto-download on export
- Single page layout (for up to ~10 line items)
- Proper German formatting (dates, currency)

## Key Features

### Auto-Population
- Business details auto-filled from settings
- Bank details auto-filled from settings
- Client autocomplete from previous invoices
- Invoice number auto-incremented

### Calculations
- Line item totals (quantity × unit price)
- Subtotal (sum of all line items)
- VAT calculation (if not Kleinunternehmer)
- Grand total
- Due date calculation (invoice date + payment terms)

### Status Management
- Draft: Saved but not finalized
- Pending: Sent to client, awaiting payment
- Paid: Payment received
- Overdue: Past due date and not paid
- Auto-update status based on due date

### Data Persistence
- All data stored in localStorage
- Auto-save as user types (with debouncing)
- Export/import functionality for backup

### Validation
- Required fields validation
- IBAN format validation
- Date validation (service period, due date)
- Prevent duplicate invoice numbers

## Design System (shadcn/ui)

### Components to Use
- **Card**: For dashboard widgets, invoice preview
- **Button**: Primary actions, secondary actions
- **Input**: Text fields
- **Textarea**: Notes, descriptions
- **Select**: Dropdowns (units, clients, filters)
- **Table**: Invoices list, line items
- **Form**: Invoice forms with validation
- **Dialog**: Modals for confirmations
- **AlertDialog**: Destructive actions
- **Badge**: Status indicators
- **DatePicker**: Date selections
- **Tabs**: Settings sections
- **Switch**: Toggle settings
- **DropdownMenu**: Action menus
- **Separator**: Visual dividers

### Color Scheme
- Primary: Keep it minimal (black/white/gray)
- Accent: Subtle blue or neutral tone for interactive elements
- Status colors:
  - Paid: Green
  - Pending: Yellow/Orange
  - Overdue: Red
  - Draft: Gray

### Typography
- Font: Inter (from Google Fonts)
- Headings: 600-700 weight
- Body: 400-500 weight
- Clean, readable hierarchy

## Development Setup

### Using Cursor IDE
- Set up project with Vite + React + TypeScript
- Install shadcn/ui using their CLI
- Configure Tailwind CSS
- Set up React Router
- Consider using shadcn MCP server if available in Cursor for faster component integration

### Installation Steps
```bash
npm create vite@latest invoice-dashboard -- --template react-ts
cd invoice-dashboard
npm install

# Install shadcn/ui
npx shadcn-ui@latest init

# Install additional dependencies
npm install react-router-dom
npm install recharts
npm install jspdf jspdf-autotable
npm install zustand # or use Context API
npm install date-fns
npm install lucide-react
```

## User Flow Examples

### Creating First Invoice
1. User opens app → lands on Dashboard
2. Clicks "Settings" to add business details
3. Fills in business info and bank details → saves
4. Clicks "Create Invoice" from sidebar
5. Enters client details (auto-saved for future)
6. Adds line items (e.g., "5 Tage Flutter Development @ €500")
7. Reviews live preview in German on the right
8. Clicks "Save & Download PDF"
9. Invoice saved to localStorage, PDF downloaded
10. Redirected to Dashboard showing the new invoice

### Editing Invoice
1. User goes to Invoices list
2. Clicks "Edit" on an invoice
3. Modifies line items or details
4. Saves changes
5. Can re-download updated PDF

### Dashboard Insights
1. User opens app → Dashboard
2. Sees quick stats: €5,000 revenue this month, 3 pending invoices
3. Views revenue chart showing growth over 6 months
4. Checks recent invoices, marks one as paid
5. Status updates, dashboard stats refresh

## Language Requirements
- **App Interface**: All UI text in English (buttons, labels, navigation, settings)
- **Invoice Preview/PDF**: All content in German (Rechnung, Leistungszeitraum, etc.)
- **Dual-language approach**: Makes the app internationally usable while producing proper German invoices

## Additional Requirements

### Responsive Design
- Desktop-first but works on tablets
- Mobile view: stacked layouts, collapsible sidebar

### Accessibility
- Use semantic HTML
- ARIA labels where needed
- Keyboard navigation support
- Focus management

### Error Handling
- Validation errors shown inline
- Toast notifications for success/error states
- Graceful localStorage failures

### Performance
- Debounce auto-save (500ms delay)
- Lazy load routes
- Optimize chart rendering
- Efficient localStorage operations

## Nice-to-Have Features (Future Enhancements)
- Client management page
- Recurring invoices
- Email invoice directly (if possible locally)
- Multi-currency support
- Invoice templates
- Dark mode
- Expense tracking
- Profit/loss reports
- VAT reports
- Invoice reminders

## Deliverables
1. Full React project with modular file structure
2. All shadcn/ui components properly configured
3. README.md with setup and usage instructions
4. Example seed data for testing
5. TypeScript types for all data models
6. Working PDF export functionality
7. Functional dashboard with charts
8. Complete CRUD operations for invoices
9. Settings page with all business config
10. Clean, professional UI using shadcn components

## Success Criteria
- ✅ User can create, edit, and manage invoices
- ✅ Dashboard shows meaningful insights
- ✅ Settings persist and auto-populate forms
- ✅ PDF export works and looks professional
- ✅ Invoice preview matches PDF output
- ✅ All German legal requirements included
- ✅ Clean, minimal design with Inter font
- ✅ Fast, responsive, no build errors
- ✅ Easy to debug and extend (modular code)
- ✅ Works completely offline (no backend needed)
