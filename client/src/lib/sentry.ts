import * as Sentry from "@sentry/react";

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;

let initialized = false;

export function initSentry() {
  if (!SENTRY_DSN || initialized) return;
  initialized = true;

  Sentry.init({
    dsn: SENTRY_DSN,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_APP_VERSION || undefined,
    // Ignore common noise
    ignoreErrors: [
      "Network Error",
      "ResizeObserver loop limit exceeded",
      "Non-Error promise rejection captured",
      "Load failed",
      "Cancelled",
      /rate.?limit/i,
    ],
    beforeSend(event) {
      // Don't send events in dev mode
      if (import.meta.env.DEV) return null;
      return event;
    },
  });
}

export { Sentry };
