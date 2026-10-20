import * as Sentry from '@sentry/react';

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;

/** 剥掉 URL query：share_access_token / download_token 等一次性凭据走 query 传递，不得发往第三方 */
function stripUrlQuery<T>(url: T): T {
  return (typeof url === 'string' ? url.split(/[?#]/)[0] : url) as T;
}

type UrlScrubTarget = {
  request?: { url?: string };
  breadcrumbs?: Array<{ data?: Record<string, unknown> } | undefined>;
  spans?: Array<{ data?: Record<string, unknown> } | undefined>;
};

/**
 * 事件内所有 URL 统一去 query：breadcrumb（fetch/xhr 请求轨迹）、event.request、
 * tracing span 的 http url。token 在 URL 里只活几分钟，但错误事件会在 Sentry 留 90 天。
 */
function scrubEventUrls<T extends UrlScrubTarget>(event: T): T {
  if (event.request?.url) event.request.url = stripUrlQuery(event.request.url);
  for (const crumb of event.breadcrumbs || []) {
    if (crumb?.data?.url) crumb.data.url = stripUrlQuery(crumb.data.url);
    if (crumb?.data?.['http.url']) crumb.data['http.url'] = stripUrlQuery(crumb.data['http.url']);
  }
  for (const span of event.spans || []) {
    if (span?.data?.url) span.data.url = stripUrlQuery(span.data.url);
    if (span?.data?.['http.url']) span.data['http.url'] = stripUrlQuery(span.data['http.url']);
  }
  return event;
}

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
      'Network Error',
      'ResizeObserver loop limit exceeded',
      'Non-Error promise rejection captured',
      'Load failed',
      'Cancelled',
      /rate.?limit/i,
    ],
    beforeSend(event) {
      // Don't send events in dev mode
      if (import.meta.env.DEV) return null;
      return scrubEventUrls(event);
    },
  });
}

export { Sentry };
