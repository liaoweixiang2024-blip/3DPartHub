/**
 * Thread-size tool: table-scroll wrapper and shared table style constants.
 * Extracted from ThreadSizeToolPage.
 */

import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react';
import { type ThreadSizeScrollPosition } from './threadSizeData';

// ── Table style constants ────────────────────────────────────────────

export const TABLE_SCROLL =
  'min-h-0 flex-1 max-w-full overflow-auto border-y border-outline-variant/10 overscroll-contain [touch-action:none] md:border-x';
export const TABLE_BASE =
  'min-w-full border-separate border-spacing-0 text-left text-[13px] md:text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap [&_td:not(:last-child)]:border-r [&_td:not(:last-child)]:border-outline-variant/8 [&_th:not(:last-child)]:border-r [&_th:not(:last-child)]:border-outline-variant/10';
export const TABLE_HEAD = 'text-on-surface';
export const TABLE_CARD = 'flex h-full min-h-0 flex-col overflow-hidden bg-transparent';
export const TABLE_TH =
  'sticky top-0 z-20 select-none bg-surface-container-low px-4 py-3 text-xs font-bold tracking-wide text-on-surface shadow-sticky [touch-action:pan-y] md:text-[13px]';
export const TABLE_FIRST_TH =
  'sticky left-0 top-0 z-30 select-none bg-surface-container-low px-4 py-3 text-xs font-bold tracking-wide text-on-surface shadow-[1px_0_0_rgba(0,0,0,0.08),0_1px_0_rgba(0,0,0,0.08)] [touch-action:pan-y] md:text-[13px]';
export const TABLE_FIRST_TD =
  'sticky left-0 z-10 select-none bg-surface px-4 py-3 font-semibold shadow-[1px_0_0_rgba(0,0,0,0.05)] [touch-action:pan-y]';
export const TABLE_FIRST_WIDTH = 'w-28 min-w-28 max-w-28 md:w-36 md:min-w-36 md:max-w-36';
export const TABLE_FIRST_TEXT = 'block max-w-full truncate';
export const TABLE_FIRST_BADGE = 'inline-block max-w-full truncate align-middle';
export const TABLE_TD = 'px-4 py-3';
export const TABLE_LONG_TH = `${TABLE_TH} min-w-72`;
export const TABLE_LONG_TD = `${TABLE_TD} min-w-72 max-w-[420px] leading-6 text-on-surface-variant [white-space:normal]`;
export const TABLE_HEADER = 'flex items-center justify-between gap-3 bg-transparent px-1 pb-3 pt-1 md:px-0';

const TABLE_TOUCH_LOCK_THRESHOLD = 6;

function clampScroll(value: number, max: number) {
  if (value < 0) return 0;
  if (value > max) return max;
  return value;
}

// ── Scroll helper (exposed for parent) ──────────────────────────────

export function getTableScrollPosition(event?: MouseEvent<HTMLTableRowElement>): ThreadSizeScrollPosition | null {
  const scrollNode = event?.currentTarget.closest('[data-thread-size-scroll="primary"]') as HTMLElement | null;
  if (!scrollNode) return null;
  return { top: scrollNode.scrollTop, left: scrollNode.scrollLeft };
}

// ── Component ────────────────────────────────────────────────────────

export default function ThreadTableScroll({ children }: { children: ReactNode }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;

    let startX = 0;
    let startY = 0;
    let startScrollLeft = 0;
    let startScrollTop = 0;
    let verticalOnlyTarget = false;
    let lockedAxis: 'vertical' | 'horizontal' | null = null;

    const handleTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      startX = touch.clientX;
      startY = touch.clientY;
      startScrollLeft = node.scrollLeft;
      startScrollTop = node.scrollTop;
      lockedAxis = null;
      const target = event.target instanceof Element ? event.target : null;
      const cell = target?.closest('td, th') as HTMLTableCellElement | null;
      verticalOnlyTarget = Boolean(cell?.closest('thead') || cell?.cellIndex === 0);
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      if (!touch) return;

      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      if (event.cancelable) event.preventDefault();

      if (!lockedAxis) {
        if (absX < TABLE_TOUCH_LOCK_THRESHOLD && absY < TABLE_TOUCH_LOCK_THRESHOLD) return;
        lockedAxis = verticalOnlyTarget || absY >= absX - 2 ? 'vertical' : 'horizontal';
      }

      if (lockedAxis === 'vertical') {
        const maxScrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
        node.scrollLeft = startScrollLeft;
        node.scrollTop = clampScroll(startScrollTop - dy, maxScrollTop);
        return;
      }

      const maxScrollLeft = Math.max(0, node.scrollWidth - node.clientWidth);
      node.scrollTop = startScrollTop;
      node.scrollLeft = clampScroll(startScrollLeft - dx, maxScrollLeft);
    };

    const handleTouchEnd = () => {
      lockedAxis = null;
    };

    node.addEventListener('touchstart', handleTouchStart, { passive: true });
    node.addEventListener('touchmove', handleTouchMove, { passive: false });
    node.addEventListener('touchend', handleTouchEnd, { passive: true });
    node.addEventListener('touchcancel', handleTouchEnd, { passive: true });
    return () => {
      node.removeEventListener('touchstart', handleTouchStart);
      node.removeEventListener('touchmove', handleTouchMove);
      node.removeEventListener('touchend', handleTouchEnd);
      node.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, []);

  return (
    <div ref={scrollRef} className={TABLE_SCROLL} data-thread-size-scroll="primary">
      {children}
    </div>
  );
}
