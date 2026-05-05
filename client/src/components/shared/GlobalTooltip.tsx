import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const TOOLTIP_SELECTOR = [
  '[data-tooltip]',
  'button[aria-label]',
  'a[aria-label]',
  "[role='button'][aria-label]",
  'button[title]',
  'a[title]',
  "[role='button'][title]",
].join(',');

const DELAY_MS = 120;
const GAP = 10;
const EDGE_PADDING = 12;

type TooltipState = {
  text: string;
  left: number;
  top: number;
  placement: TooltipPlacement;
};

type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

function getTooltipText(element: HTMLElement) {
  return (element.dataset.tooltip || element.getAttribute('aria-label') || element.getAttribute('title') || '').trim();
}

function isTooltipTarget(element: Element | null): element is HTMLElement {
  return Boolean(element instanceof HTMLElement && element.matches(TOOLTIP_SELECTOR));
}

function isPlacement(value: string | undefined): value is TooltipPlacement {
  return value === 'top' || value === 'bottom' || value === 'left' || value === 'right';
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function canFitHorizontally(rect: DOMRect, tooltipWidth: number, vw: number) {
  const center = rect.left + rect.width / 2;
  const left = center - tooltipWidth / 2;
  const right = center + tooltipWidth / 2;
  return left >= EDGE_PADDING && right <= vw - EDGE_PADDING;
}

function choosePlacement(
  rect: DOMRect,
  tooltipWidth: number,
  tooltipHeight: number,
  preferred?: TooltipPlacement,
): TooltipPlacement {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const spaceTop = rect.top - GAP - tooltipHeight;
  const spaceBottom = vh - rect.bottom - GAP - tooltipHeight;
  const spaceLeft = rect.left - GAP - tooltipWidth;
  const spaceRight = vw - rect.right - GAP - tooltipWidth;

  // If user explicitly requested a side, try it first
  if (preferred) {
    if (preferred === 'top' && spaceTop >= 0 && canFitHorizontally(rect, tooltipWidth, vw)) return 'top';
    if (preferred === 'bottom' && spaceBottom >= 0 && canFitHorizontally(rect, tooltipWidth, vw)) return 'bottom';
    if (preferred === 'left' && spaceLeft >= 0) return 'left';
    if (preferred === 'right' && spaceRight >= 0) return 'right';
  }

  // Auto-select: prefer the direction with the most space
  const scores: [TooltipPlacement, number][] = [
    ['bottom', spaceBottom],
    ['top', spaceTop],
    ['right', spaceRight],
    ['left', spaceLeft],
  ];

  // Filter to directions that actually fit (including horizontal check for top/bottom)
  const viable = scores.filter(([dir]) => {
    if (dir === 'top' || dir === 'bottom') {
      return canFitHorizontally(rect, tooltipWidth, vw);
    }
    return true;
  });

  if (viable.length > 0) {
    viable.sort((a, b) => b[1] - a[1]);
    return viable[0][0];
  }

  // Fallback: pick direction with most space even if it doesn't fully fit
  scores.sort((a, b) => b[1] - a[1]);
  return scores[0][0];
}

function tooltipPoint(rect: DOMRect, placement: TooltipPlacement, width: number, height: number) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  if (placement === 'top') {
    const left = clamp(rect.left + rect.width / 2 - width / 2, EDGE_PADDING, vw - width - EDGE_PADDING);
    const top = rect.top - GAP - height;
    return { left, top };
  }
  if (placement === 'bottom') {
    const left = clamp(rect.left + rect.width / 2 - width / 2, EDGE_PADDING, vw - width - EDGE_PADDING);
    const top = rect.bottom + GAP;
    return { left, top };
  }
  if (placement === 'left') {
    const left = rect.left - GAP - width;
    const top = clamp(rect.top + rect.height / 2 - height / 2, EDGE_PADDING, vh - height - EDGE_PADDING);
    return { left, top };
  }
  // right
  const left = rect.right + GAP;
  const top = clamp(rect.top + rect.height / 2 - height / 2, EDGE_PADDING, vh - height - EDGE_PADDING);
  return { left, top };
}

const isTouchDevice = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

export default function GlobalTooltip() {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  const [measured, setMeasured] = useState<{ width: number; height: number } | null>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // Phase 2: measure the hidden tooltip and compute final position
  useEffect(() => {
    if (!tooltip || measured) return;
    const el = measureRef.current;
    if (!el) return;
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    setMeasured({ width, height });

    // Re-position with actual dimensions
    const active = activeRef.current;
    if (!active) return;
    const rect = active.getBoundingClientRect();
    const requested = isPlacement(active.dataset.tooltipSide) ? active.dataset.tooltipSide : undefined;
    const placement = choosePlacement(rect, width, height, requested);
    const point = tooltipPoint(rect, placement, width, height);
    setTooltip({ text: tooltip.text, left: point.left, top: point.top, placement });
  }, [tooltip, measured]);

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };

    const restoreNativeTitle = (element: HTMLElement | null) => {
      if (!element) return;
      const nativeTitle = element.dataset.nativeTitle;
      if (nativeTitle !== undefined) {
        element.setAttribute('title', nativeTitle);
        delete element.dataset.nativeTitle;
      }
    };

    const hide = () => {
      clearTimer();
      restoreNativeTitle(activeRef.current);
      activeRef.current = null;
      setTooltip(null);
      setMeasured(null);
    };

    const showFor = (element: HTMLElement) => {
      if (element.closest('[data-tooltip-ignore]')) return;
      const text = getTooltipText(element);
      if (!text) return;

      clearTimer();
      restoreNativeTitle(activeRef.current);
      activeRef.current = element;

      const title = element.getAttribute('title');
      if (title) {
        element.dataset.nativeTitle = title;
        element.removeAttribute('title');
      }

      timerRef.current = setTimeout(() => {
        // Phase 1: render with placeholder position (will be measured)
        const rect = element.getBoundingClientRect();
        const requested = isPlacement(element.dataset.tooltipSide) ? element.dataset.tooltipSide : undefined;
        // Estimate placement for initial render (without dimensions)
        const placement = requested || (rect.top < 56 ? 'bottom' : 'top');
        setTooltip({
          text,
          left: rect.left + rect.width / 2,
          top: placement === 'top' ? rect.top - GAP : rect.bottom + GAP,
          placement,
        });
        setMeasured(null);
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

    document.addEventListener('mouseover', handleMouseOver, true);
    document.addEventListener('mouseout', handleMouseOut, true);
    document.addEventListener('focusin', handleFocusIn, true);
    document.addEventListener('focusout', handleFocusOut, true);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', hide);

    return () => {
      document.removeEventListener('mouseover', handleMouseOver, true);
      document.removeEventListener('mouseout', handleMouseOut, true);
      document.removeEventListener('focusin', handleFocusIn, true);
      document.removeEventListener('focusout', handleFocusOut, true);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', hide);
      hide();
    };
  }, []);

  if (!tooltip || isTouchDevice || isMobile) return null;

  const isVisible = measured !== null;

  return createPortal(
    <div
      ref={measureRef}
      role="tooltip"
      className="pointer-events-none fixed z-[500] max-w-[12rem] rounded bg-inverse-surface px-2.5 py-1 text-xs font-medium leading-snug text-inverse-on-surface shadow-lg"
      style={{
        left: tooltip.left,
        top: tooltip.top,
        visibility: isVisible ? 'visible' : 'hidden',
        opacity: isVisible ? 1 : 0,
        transform: measured ? 'none' : 'translateX(-50%)',
        transition: 'opacity 0.1s ease-in',
      }}
    >
      {tooltip.text}
    </div>,
    document.body,
  );
}
