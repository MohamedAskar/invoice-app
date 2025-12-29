import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  FileText, 
  Settings,
  Receipt,
  ChevronDown,
  Building2,
  CreditCard,
  Database,
  Users
} from 'lucide-react';
import { cn } from '@/lib/utils';

const mainNavItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/invoices', icon: FileText, label: 'Invoices' },
  { to: '/clients', icon: Users, label: 'Clients' },
];

const settingsItems = [
  { to: '/settings/business', icon: Building2, label: 'Business Info' },
  { to: '/settings/bank', icon: CreditCard, label: 'Bank Details' },
  { to: '/settings/preferences', icon: FileText, label: 'Preferences' },
  { to: '/settings/data', icon: Database, label: 'Data Management' },
];

export function Sidebar() {
  const location = useLocation();
  const isSettingsActive = location.pathname.startsWith('/settings');
  const [settingsExpanded, setSettingsExpanded] = useState(isSettingsActive);

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-72 border-r bg-card">
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className="flex h-16 items-center gap-3 border-b px-6">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <Receipt className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="text-lg font-semibold tracking-tight">InvoiceApp</span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 p-4">
          {/* Main nav items */}
          {mainNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium transition-all',
                  isActive
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}

          {/* Settings with expandable sub-items */}
          <div>
            <button
              onClick={() => setSettingsExpanded(!settingsExpanded)}
              className={cn(
                'flex w-full items-center justify-between rounded-lg px-4 py-3 text-sm font-medium transition-all',
                isSettingsActive
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
              )}
            >
              <div className="flex items-center gap-2">
                <Settings className="h-4 w-4" />
                Settings
              </div>
              <ChevronDown 
                className={cn(
                  'h-4 w-4 transition-transform',
                  settingsExpanded && 'rotate-180'
                )} 
              />
            </button>

            {/* Settings sub-items */}
            {settingsExpanded && (
              <div className="mt-1 ml-8 space-y-1">
                {settingsItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all',
                        isActive
                          ? 'bg-secondary text-foreground'
                          : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
                      )
                    }
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        </nav>

        {/* Footer */}
        <div className="border-t p-4">
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} InvoiceApp
          </p>
        </div>
      </div>
    </aside>
  );
}
