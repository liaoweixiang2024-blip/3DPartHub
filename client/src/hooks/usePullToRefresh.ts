import { useState, useEffect, useCallback, useRef } from 'react';

export function usePullToRefresh(
  scrollContainerRef: React.RefObject<HTMLElement | null>,
  deps: {
    isDesktop: boolean;
    onRefresh: () => Promise<void>;
  },
) {
  const { isDesktop, onRefresh } = deps;
  const pullStateRef = useRef<'idle' | 'pulling' | 'ready' | 'refreshing'>('idle');
  const pullStartY = useRef(0);
  const pullVisualRef = useRef<{ state: 'idle' | 'pulling' | 'ready' | 'refreshing'; offset: number }>({
    state: 'idle',
    offset: 0,
  });
  const pendingPullVisualRef = useRef<{
    state: 'idle' | 'pulling' | 'ready' | 'refreshing';
    offset: number;
  } | null>(null);
  const pullMoveFrameRef = useRef<number | null>(null);
  const [pullOffset, setPullOffset] = useState(0);
  const [pullState, setPullState] = useState<'idle' | 'pulling' | 'ready' | 'refreshing'>('idle');
  const pullThreshold = typeof window !== 'undefined' ? Math.round(window.innerHeight / 3) : 200;
  const pullMaxVisual = 80;

  const commitPullVisual = useCallback((state: 'idle' | 'pulling' | 'ready' | 'refreshing', offset: number) => {
    const next = { state, offset: Math.max(0, Math.round(offset)) };
    pullStateRef.current = state;
    pendingPullVisualRef.current = next;
    if (pullMoveFrameRef.current != null) return;
    pullMoveFrameRef.current = window.requestAnimationFrame(() => {
      pullMoveFrameRef.current = null;
      const pending = pendingPullVisualRef.current;
      pendingPullVisualRef.current = null;
      if (!pending) return;
      const current = pullVisualRef.current;
      if (current.state !== pending.state) setPullState(pending.state);
      if (current.offset !== pending.offset) setPullOffset(pending.offset);
      pullVisualRef.current = pending;
    });
  }, []);

  const finishPullGesture = useCallback(async () => {
    if (isDesktop || pullStateRef.current === 'refreshing') return;

    if (pullStateRef.current === 'ready') {
      commitPullVisual('refreshing', pullMaxVisual);
      const started = Date.now();
      try {
        await onRefresh();
      } catch {
        // SWR handles error reporting
      }
      // Keep the spinner visible at least 800ms so quick refreshes do not flash.
      const elapsed = Date.now() - started;
      if (elapsed < 800) {
        await new Promise((r) => setTimeout(r, 800 - elapsed));
      }
    }

    commitPullVisual('idle', 0);
  }, [commitPullVisual, isDesktop, onRefresh]);

  useEffect(() => {
    if (isDesktop) return;
    const container = scrollContainerRef.current;
    if (!container) return;

    let trackingPull = false;

    const handleTouchStart = (event: TouchEvent) => {
      if (pullStateRef.current === 'refreshing' || container.scrollTop > 0) {
        trackingPull = false;
        return;
      }
      const touch = event.touches[0];
      if (!touch) return;
      trackingPull = true;
      pullStartY.current = touch.clientY;
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!trackingPull || pullStateRef.current === 'refreshing') return;
      const touch = event.touches[0];
      if (!touch) return;
      if (container.scrollTop > 0 && pullStateRef.current === 'idle') {
        trackingPull = false;
        return;
      }

      const delta = touch.clientY - pullStartY.current;
      if (delta <= 0) {
        if (pullStateRef.current !== 'idle') commitPullVisual('idle', 0);
        return;
      }

      const resisted = pullMaxVisual * (1 - Math.exp(-delta / pullThreshold));
      commitPullVisual(delta >= pullThreshold ? 'ready' : 'pulling', resisted);
    };

    const handleTouchEnd = () => {
      if (!trackingPull && pullStateRef.current === 'idle') return;
      trackingPull = false;
      void finishPullGesture();
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: true });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });
    container.addEventListener('touchcancel', handleTouchEnd, { passive: true });
    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
      if (pullMoveFrameRef.current != null) {
        window.cancelAnimationFrame(pullMoveFrameRef.current);
        pullMoveFrameRef.current = null;
      }
      pendingPullVisualRef.current = null;
    };
  }, [commitPullVisual, finishPullGesture, isDesktop, pullMaxVisual, pullThreshold, scrollContainerRef]);

  const handlePullTransitionEnd = useCallback(() => {
    if (pullStateRef.current === 'idle') {
      setPullOffset(0);
    }
  }, []);

  return { pullOffset, pullState, handlePullTransitionEnd };
}
