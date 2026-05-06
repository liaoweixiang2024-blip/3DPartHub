import { useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { SWRConfig } from 'swr';
import ErrorBoundary from './components/shared/ErrorBoundary';
import ForceChangePassword from './components/shared/ForceChangePassword';
import GlobalTooltip from './components/shared/GlobalTooltip';
import { ToastProvider } from './components/shared/Toast';
import { notifyGlobalError } from './lib/errorNotifications';
import Router from './router';

export default function App() {
  useEffect(() => {
    // Wait for the headline font, then reveal the page in the next frame
    // Using rAF ensures the browser has painted the hidden state first
    document.fonts
      .load('bold 1px "Space Grotesk"')
      .catch(() => {})
      .finally(() => {
        requestAnimationFrame(() => {
          const root = document.getElementById('root');
          if (root) root.style.opacity = '1';
        });
      });
  }, []);

  return (
    <SWRConfig
      value={{
        dedupingInterval: 5000,
        focusThrottleInterval: 10000,
        revalidateOnFocus: false,
        onError: (error) => notifyGlobalError(error, '数据加载失败，请稍后重试'),
      }}
    >
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ToastProvider>
          <ErrorBoundary>
            <Router />
            <ForceChangePassword />
            <GlobalTooltip />
          </ErrorBoundary>
        </ToastProvider>
      </BrowserRouter>
    </SWRConfig>
  );
}
