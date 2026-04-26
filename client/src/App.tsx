import { BrowserRouter } from "react-router-dom";
import { SWRConfig } from "swr";
import Router from "./router";
import { ToastProvider } from "./components/shared/Toast";
import ErrorBoundary from "./components/shared/ErrorBoundary";
import { notifyGlobalError } from "./lib/errorNotifications";

export default function App() {
  return (
    <SWRConfig value={{
      dedupingInterval: 5000,
      focusThrottleInterval: 10000,
      revalidateOnFocus: false,
      onError: (error) => notifyGlobalError(error, "数据加载失败，请稍后重试"),
    }}>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ToastProvider>
          <ErrorBoundary>
            <Router />
          </ErrorBoundary>
        </ToastProvider>
      </BrowserRouter>
    </SWRConfig>
  );
}
