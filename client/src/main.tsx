import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/space-grotesk/latin-400.css';
import '@fontsource/space-grotesk/latin-600.css';
import '@fontsource/space-grotesk/latin-700.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
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
