import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import Icon from "./Icon";

type ToastType = "success" | "error" | "info";

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });
export const useToast = () => useContext(ToastContext);

const iconMap: Record<ToastType, { name: string; color: string }> = {
  success: { name: "check_circle", color: "text-emerald-400" },
  error: { name: "error", color: "text-red-400" },
  info: { name: "info", color: "text-blue-400" },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const toast = useCallback((message: string, type: ToastType = "info") => {
    const id = ++counter.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {createPortal(
        <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
          <AnimatePresence>
            {toasts.map((t) => {
              const ic = iconMap[t.type];
              return (
                <motion.div
                  key={t.id}
                  initial={{ opacity: 0, x: 40, scale: 0.95 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  exit={{ opacity: 0, x: 40, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                  className="pointer-events-auto flex items-center gap-2 bg-surface-container-high border border-outline-variant/20 shadow-lg rounded-sm px-4 py-2.5 text-sm text-on-surface min-w-[200px] max-w-[360px]"
                >
                  <Icon name={ic.name} size={18} className={ic.color} />
                  <span className="flex-1">{t.message}</span>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}
