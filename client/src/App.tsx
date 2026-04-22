import { BrowserRouter } from "react-router-dom";
import { SWRConfig } from "swr";
import Router from "./router";
import { ToastProvider } from "./components/shared/Toast";

export default function App() {
  return (
    <SWRConfig value={{
      dedupingInterval: 5000,
      focusThrottleInterval: 10000,
      revalidateOnFocus: false,
    }}>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ToastProvider>
          <Router />
        </ToastProvider>
      </BrowserRouter>
    </SWRConfig>
  );
}
