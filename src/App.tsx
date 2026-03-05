import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { Dashboard } from '@/pages/Dashboard';
import { InvoicesList } from '@/pages/InvoicesList';
import { CreateInvoice } from '@/pages/CreateInvoice';
import { EditInvoice } from '@/pages/EditInvoice';
import { ViewInvoice } from '@/pages/ViewInvoice';
import { Clients } from '@/pages/Clients';
import { Settings } from '@/pages/Settings';
import { ExpensesList } from '@/pages/ExpensesList';
import { CreateExpense } from '@/pages/CreateExpense';
import { EditExpense } from '@/pages/EditExpense';

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="invoices" element={<InvoicesList />} />
        <Route path="invoices/new" element={<CreateInvoice />} />
        <Route path="invoices/:id" element={<ViewInvoice />} />
        <Route path="invoices/:id/edit" element={<EditInvoice />} />
        <Route path="clients" element={<Clients />} />
        <Route path="expenses" element={<ExpensesList />} />
        <Route path="expenses/new" element={<CreateExpense />} />
        <Route path="expenses/:id/edit" element={<EditExpense />} />
        <Route path="settings" element={<Navigate to="/settings/business" replace />} />
        <Route path="settings/:section" element={<Settings />} />
      </Route>
    </Routes>
  );
}

export default App;
