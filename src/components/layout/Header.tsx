import { useLocation, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';

const pageTitles: Record<string, string> = {
  '/': 'Dashboard',
  '/invoices': 'Invoices',
  '/invoices/new': 'Create Invoice',
  '/clients': 'Clients',
  '/settings/business': 'Business Information',
  '/settings/bank': 'Bank Details',
  '/settings/preferences': 'Invoice Preferences',
  '/settings/data': 'Data Management',
};

export function Header() {
  const location = useLocation();
  
  // Handle dynamic routes
  let title = pageTitles[location.pathname];
  if (!title) {
    if (location.pathname.includes('/invoices/') && location.pathname.includes('/edit')) {
      title = 'Edit Invoice';
    } else if (location.pathname.includes('/invoices/')) {
      title = 'Invoice Details';
    } else if (location.pathname.startsWith('/settings')) {
      title = 'Settings';
    } else {
      title = 'InvoiceApp';
    }
  }

  const showCreateButton = location.pathname === '/';

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex w-full items-center justify-between px-8">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {showCreateButton && (
          <Link to="/invoices/new">
            <Button className="rounded-lg">
              <Plus className="h-4 w-4" />
              Create Invoice
            </Button>
          </Link>
        )}
      </div>
    </header>
  );
}
