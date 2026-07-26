import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthGate } from '@/components/auth/AuthGate';
import { Layout } from '@/components/layout/Layout';
import { Dashboard } from '@/pages/Dashboard';
import { InvoicesList } from '@/pages/InvoicesList';
import { CreateInvoice } from '@/pages/CreateInvoice';
import { EditInvoice } from '@/pages/EditInvoice';
import { ViewInvoice } from '@/pages/ViewInvoice';
import { Clients } from '@/pages/Clients';
import { Settings } from '@/pages/Settings';
import { useSettings } from '@/hooks/useSettings';

function App() {
  const loadSettings = useSettings((s) => s.loadSettings);

  // Settings come from the database now, so they need loading once we're signed in.
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="invoices" element={<InvoicesList />} />
        <Route path="invoices/new" element={<CreateInvoice />} />
        <Route path="invoices/:id" element={<ViewInvoice />} />
        <Route path="invoices/:id/edit" element={<EditInvoice />} />
        <Route path="clients" element={<Clients />} />
        <Route path="settings" element={<Navigate to="/settings/business" replace />} />
        <Route path="settings/:section" element={<Settings />} />
      </Route>
    </Routes>
  );
}

export default function AppWithAuth() {
  return (
    <AuthGate>
      <App />
    </AuthGate>
  );
}
