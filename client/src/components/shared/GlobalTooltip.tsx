import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const TOOLTIP_SELECTOR = [
  "[data-tooltip]",
  "button[aria-label]",
  "a[aria-label]",
  "[role='button'][aria-label]",
  "button[title]",
  "a[title]",
  "[role='button'][title]",
].join(",");

const DELAY_MS = 120;
const GAP = 8;
const EDGE_PADDING = 12;
const CENTER_SAFE_WIDTH = 96;
const SIDE_SAFE_WIDTH = 132;

type TooltipState = {
  text: string;
  left: number;
  top: number;
  placement: TooltipPlacement;
};

type TooltipPlacement = "top" | "bottom" | "left" | "right";

function getTooltipText(element: HTMLElement) {
  return (
    element.dataset.tooltip ||
    element.getAttribute("aria-label") ||
    element.getAttribute("title") ||
    ""
  ).trim();
}

function isTooltipTarget(element: Element | null): element is HTMLElement {
  return Boolean(element instanceof HTMLElement && element.matches(TOOLTIP_SELECTOR));
}

function isPlacement(value: string | undefined): value is TooltipPlacement {
  return value === "top" || value === "bottom" || value === "left" || value === "right";
}

function choosePlacement(element: HTMLElement, rect: DOMRect): TooltipPlacement {
  const requested = element.dataset.tooltipSide;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  let placement: TooltipPlacement;

  if (isPlacement(requested)) {
    placement = requested;
  } else if (rect.right > viewportWidth - SIDE_SAFE_WIDTH) {
    placement = "left";
  } else if (rect.left < SIDE_SAFE_WIDTH) {
    placement = "right";
  } else {
    placement = rect.top < 56 ? "bottom" : "top";
  }

  if (placement === "left" && rect.left < SIDE_SAFE_WIDTH) return "right";
  if (placement === "right" && viewportWidth - rect.right < SIDE_SAFE_WIDTH) return "left";
  if (placement === "top" && rect.top < 44) return "bottom";
  if (placement === "bottom" && viewportHeight - rect.bottom < 44) return "top";
  return placement;
}

function tooltipPoint(rect: DOMRect, placement: TooltipPlacement) {
  if (placement === "left") {
    return {
      left: rect.left - GAP,
      top: Math.min(Math.max(rect.top + rect.height / 2, EDGE_PADDING), window.innerHeight - EDGE_PADDING),
    };
  }
  if (placement === "right") {
    return {
      left: rect.right + GAP,
      top: Math.min(Math.max(rect.top + rect.height / 2, EDGE_PADDING), window.innerHeight - EDGE_PADDING),
    };
  }
  return {
    left: Math.min(
      Math.max(rect.left + rect.width / 2, CENTER_SAFE_WIDTH),
      Math.max(CENTER_SAFE_WIDTH, window.innerWidth - CENTER_SAFE_WIDTH)
    ),
    top: placement === "top" ? rect.top - GAP : rect.bottom + GAP,
  };
}

function transformForPlacement(placement: TooltipPlacement) {
  if (placement === "top") return "translate(-50%, -100%)";
  if (placement === "bottom") return "translateX(-50%)";
  if (placement === "left") return "translate(-100%, -50%)";
  return "translateY(-50%)";
}

export default function GlobalTooltip() {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };

    const restoreNativeTitle = (element: HTMLElement | null) => {
      if (!element) return;
      const nativeTitle = element.dataset.nativeTitle;
      if (nativeTitle !== undefined) {
        element.setAttribute("title", nativeTitle);
        delete element.dataset.nativeTitle;
      }
    };

    const hide = () => {
      clearTimer();
      restoreNativeTitle(activeRef.current);
      activeRef.current = null;
      setTooltip(null);
    };

    const showFor = (element: HTMLElement) => {
      if (element.closest("[data-tooltip-ignore]")) return;
      const text = getTooltipText(element);
      if (!text) return;

      clearTimer();
      restoreNativeTitle(activeRef.current);
      activeRef.current = element;

      const title = element.getAttribute("title");
      if (title) {
        element.dataset.nativeTitle = title;
        element.removeAttribute("title");
      }

      timerRef.current = setTimeout(() => {
        const rect = element.getBoundingClientRect();
        const placement = choosePlacement(element, rect);
        const point = tooltipPoint(rect, placement);
        setTooltip({
          text,
          left: point.left,
          top: point.top,
          placement,
        });
      }, DELAY_MS);
    };

    const handleMouseOver = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest(TOOLTIP_SELECTOR) : null;
      if (!isTooltipTarget(target) || target === activeRef.current) return;
      showFor(target);
    };

    const handleMouseOut = (event: MouseEvent) => {
      const active = activeRef.current;
      if (!active) return;
      const next = event.relatedTarget instanceof Node ? event.relatedTarget : null;
      if (next && active.contains(next)) return;
      hide();
    };

    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target instanceof Element ? event.target.closest(TOOLTIP_SELECTOR) : null;
      if (isTooltipTarget(target)) showFor(target);
    };

    const handleFocusOut = () => hide();

    const handleScroll = () => hide();

    document.addEventListener("mouseover", handleMouseOver, true);
    document.addEventListener("mouseout", handleMouseOut, true);
    document.addEventListener("focusin", handleFocusIn, true);
    document.addEventListener("focusout", handleFocusOut, true);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", hide);

    return () => {
      document.removeEventListener("mouseover", handleMouseOver, true);
      document.removeEventListener("mouseout", handleMouseOut, true);
      document.removeEventListener("focusin", handleFocusIn, true);
      document.removeEventListener("focusout", handleFocusOut, true);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", hide);
      hide();
    };
  }, []);

  if (!tooltip) return null;

  return createPortal(
    <div
      role="tooltip"
      className="pointer-events-none fixed z-[500] max-w-[12rem] rounded bg-inverse-surface px-2.5 py-1 text-xs font-medium leading-snug text-inverse-on-surface shadow-lg animate-in fade-in zoom-in-95 duration-100"
      style={{
        left: tooltip.left,
        top: tooltip.top,
        transform: transformForPlacement(tooltip.placement),
      }}
    >
      {tooltip.text}
    </div>,
    document.body
  );
}
