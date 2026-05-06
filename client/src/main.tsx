import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import App from './App';
import { getCachedPublicSettings } from './lib/publicSettings';
import { initSentry } from './lib/sentry';

initSentry();

// Pre-fetch site config so TopNav renders with correct title/logo immediately
getCachedPublicSettings();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
