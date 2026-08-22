import { MotionConfig } from 'framer-motion';
import { BrowserRouter } from 'react-router-dom';
import { SWRConfig } from 'swr';
import ErrorBoundary from './components/shared/ErrorBoundary';
import ForceChangePassword from './components/shared/ForceChangePassword';
import GlobalTooltip from './components/shared/GlobalTooltip';
import { GlobalPageRefreshIndicator } from './components/shared/PageRefreshFallback';
import RouteProgress from './components/shared/RouteProgress';
import { ToastProvider } from './components/shared/Toast';
import { i18n } from './i18n';
import { isRateLimitError, notifyGlobalError } from './lib/errorNotifications';
import { motionDuration, motionEase } from './lib/motion';
import { getPublicSettingsSnapshot } from './lib/publicSettings';
import Router from './router';

export default function App() {
  return (
    <SWRConfig
      value={{
        fallback: {
          publicSettings: getPublicSettingsSnapshot(),
        },
        dedupingInterval: 5000,
        focusThrottleInterval: 10000,
        revalidateOnFocus: false,
        shouldRetryOnError: (error) => !isRateLimitError(error),
        onError: (error) => {
          if (isRateLimitError(error)) return;
          notifyGlobalError(error, i18n.t('app.dataLoadFailed'));
        },
      }}
    >
      {/* react-router v7：v7_startTransition / v7_relativeSplatPath 已是默认行为，无需 future flag */}
      <BrowserRouter>
        <MotionConfig reducedMotion="user" transition={{ duration: motionDuration.base, ease: motionEase.standard }}>
          <ToastProvider>
            <ErrorBoundary>
              <RouteProgress />
              <GlobalPageRefreshIndicator />
              <Router />
              <ForceChangePassword />
              <GlobalTooltip />
            </ErrorBoundary>
          </ToastProvider>
        </MotionConfig>
      </BrowserRouter>
    </SWRConfig>
  );
}
