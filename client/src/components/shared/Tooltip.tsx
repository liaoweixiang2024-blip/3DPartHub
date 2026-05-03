import { useState, useRef, useEffect, type ReactNode } from "react";

const isTouchDevice = typeof window !== "undefined" && ("ontouchstart" in window || navigator.maxTouchPoints > 0);

interface TooltipProps {
  text: string;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  delay?: number;
}

export default function Tooltip({ text, children, side = "top", delay = 120 }: TooltipProps) {
  const [show, setShow] = useState(false);
  const [adjusted, setAdjusted] = useState<{ x: number; side: "top" | "bottom" | "left" | "right" }>({ x: 0, side });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tipRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!show || !tipRef.current) {
      setAdjusted({ x: 0, side });
      return;
    }
    const rect = tipRef.current.getBoundingClientRect();
    let x = 0;
    let newSide: "top" | "bottom" | "left" | "right" = side;

    if (rect.left < 8) x = -rect.left + 8;
    if (rect.right > window.innerWidth - 8) x = window.innerWidth - 8 - rect.right;

    if (side === "top" && rect.top < 8) newSide = "bottom";
    if (side === "bottom" && rect.bottom > window.innerHeight - 8) newSide = "top";
    if (side === "left" && rect.left < 8) newSide = "right";
    if (side === "right" && rect.right > window.innerWidth - 8) newSide = "left";

    setAdjusted({ x, side: newSide });
  }, [show, side, text]);

  if (isTouchDevice) return <>{children}</>;

  const positionClasses: Record<string, string> = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
  };

  return (
    <span
      className="relative inline-flex"
      data-tooltip-ignore
      onMouseEnter={() => {
        timerRef.current = setTimeout(() => setShow(true), delay);
      }}
      onMouseLeave={() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        setShow(false);
      }}
    >
      {children}
      {show && (
        <span
          ref={tipRef}
          className={`absolute z-50 ${positionClasses[adjusted.side]} pointer-events-none whitespace-nowrap rounded bg-inverse-surface px-2.5 py-1 text-xs font-medium text-inverse-on-surface shadow-lg animate-in fade-in duration-100`}
          style={adjusted.x ? { marginLeft: adjusted.x } : undefined}
          role="tooltip"
        >
          {text}
        </span>
      )}
    </span>
  );
}
