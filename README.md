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
- Tax number (Steuernummer) if provided

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

