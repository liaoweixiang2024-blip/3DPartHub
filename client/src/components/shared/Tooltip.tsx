import { useState, useRef, type ReactNode } from "react";

interface TooltipProps {
  text: string;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  delay?: number;
}

export default function Tooltip({ text, children, side = "top", delay = 400 }: TooltipProps) {
  const [show, setShow] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const positionClasses: Record<string, string> = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
  };

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => {
        timerRef.current = setTimeout(() => setShow(true), delay);
      }}
      onMouseLeave={() => {
        clearTimeout(timerRef.current);
        setShow(false);
      }}
    >
      {children}
      {show && (
        <span
          className={`absolute z-50 ${positionClasses[side]} pointer-events-none whitespace-nowrap rounded bg-inverse-surface px-2.5 py-1 text-xs font-medium text-inverse-on-surface shadow-lg animate-in fade-in duration-100`}
          role="tooltip"
        >
          {text}
        </span>
      )}
    </span>
  );
}
