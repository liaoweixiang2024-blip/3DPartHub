import { BrowserRouter } from "react-router-dom";
import Router from "./router";
import { ToastProvider } from "./components/shared/Toast";

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ToastProvider>
        <Router />
      </ToastProvider>
    </BrowserRouter>
  );
}
