import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { Toaster } from '@/components/ui/toaster'

// Single Page Apps for GitHub Pages
// https://github.com/rafgraph/spa-github-pages
// This code checks to see if a redirect is present in the query string,
// converts it back into the correct url and adds it to the
// browser's history using window.history.replaceState(...),
// which won't cause the browser to attempt to load the new url.
// When the single page app is loaded further down in this file,
// the correct url will be waiting in the browser's history for
// the single page app to route accordingly.
(function(l) {
  if (l.search[1] === '/' ) {
    var decoded = l.search.slice(1).split('&').map(function(s) { 
      return s.replace(/~and~/g, '&')
    }).join('?');
    window.history.replaceState(null, '', l.pathname.slice(0, -1) + decoded + l.hash);
  }
}(window.location))

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
    <BrowserRouter basename="/invoice-app">
      <App />
      <Toaster />
    </BrowserRouter>
  </StrictMode>,
)
