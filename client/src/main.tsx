import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import App from './App';
import { initI18n } from './i18n';
import { getCachedPublicSettings } from './lib/publicSettings';
import { scheduleSentryInit } from './lib/sentryLazy';
import { reportWebVitals } from './lib/webVitals';

scheduleSentryInit();
reportWebVitals();

async function bootstrap() {
  // Load site config before the first React render so the selected interface
  // theme is known immediately and does not flash to the default theme.
  const publicSettings = await getCachedPublicSettings();
  await initI18n(publicSettings);

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();

// Register the service worker for PWA installability (the address-bar "Install"
// affordance). Non-blocking — a failed registration never impairs the app, it
// just means the install prompt won't appear. Both localhost and HTTPS are
// secure contexts, so this works in dev and production.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* silent — install prompt simply won't be offered */
    });
  });
}
