import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import App from './App';
import { getCachedPublicSettings } from './lib/publicSettings';
import { scheduleSentryInit } from './lib/sentryLazy';

scheduleSentryInit();

async function bootstrap() {
  // Load site config before the first React render so the selected interface
  // theme is known immediately and does not flash to the default theme.
  await getCachedPublicSettings();

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
