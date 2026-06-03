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
