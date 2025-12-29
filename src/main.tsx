import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { Toaster } from '@/components/ui/toaster'

// Clear old data and reset to clean state (v3 reset)
const DATA_VERSION = 'v3'
if (localStorage.getItem('invoice-app-version') !== DATA_VERSION) {
  localStorage.removeItem('invoice-app-settings')
  localStorage.removeItem('invoice-app-invoices')
  localStorage.removeItem('invoice-app-clients')
  localStorage.setItem('invoice-app-version', DATA_VERSION)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
      <Toaster />
    </BrowserRouter>
  </StrictMode>,
)
