import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { usePageRefreshActive } from './PageRefreshFallback';

type ProgressPhase = 'idle' | 'entering' | 'settling' | 'exiting';

const ENTER_DELAY_MS = 40;
const SETTLE_DELAY_MS = 460;
const EXIT_DELAY_MS = 180;
const MAX_WAIT_MS = 8000;

export default function RouteProgress() {
  const location = useLocation();
  const pageRefreshActive = usePageRefreshActive();
  const firstRunRef = useRef(true);
  const routeStartedAtRef = useRef(0);
  const routePendingRef = useRef(false);
  const timersRef = useRef<Array<ReturnType<typeof window.setTimeout>>>([]);
  const frameRef = useRef<number | null>(null);
  const progressRef = useRef(0);
  const [phase, setPhase] = useState<ProgressPhase>('idle');
  const [progress, setProgress] = useState(0);
  const [transitionId, setTransitionId] = useState(0);

  const setRouteProgress = useCallback((nextProgress: number | ((current: number) => number)) => {
    setProgress((current) => {
      const next = typeof nextProgress === 'function' ? nextProgress(current) : nextProgress;
      const clamped = Math.min(100, Math.max(0, next));
      progressRef.current = clamped;
      return current === clamped ? current : clamped;
    });
  }, []);

  const setRouteProgressAtLeast = useCallback(
    (nextProgress: number) => {
      setRouteProgress((current) => Math.max(current, nextProgress));
    },
    [setRouteProgress],
  );

  const clearRouteTimers = useCallback(() => {
    timersRef.current.forEach(window.clearTimeout);
    timersRef.current = [];
    if (frameRef.current != null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  const completeRouteProgress = useCallback(() => {
    if (!routePendingRef.current) return;
    routePendingRef.current = false;
    setPhase('settling');
    setRouteProgress(100);

    timersRef.current.push(
      window.setTimeout(() => {
        setPhase('exiting');
        setRouteProgress(100);
      }, EXIT_DELAY_MS),
      window.setTimeout(() => {
        setPhase('idle');
        setRouteProgress(0);
      }, EXIT_DELAY_MS + 160),
    );
  }, [setRouteProgress]);

  useEffect(() => clearRouteTimers, [clearRouteTimers]);

  useEffect(() => {
    if (firstRunRef.current) {
      firstRunRef.current = false;
      return;
    }

    clearRouteTimers();
    routeStartedAtRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();
    routePendingRef.current = true;

    setTransitionId((value) => value + 1);
    setPhase('entering');
    if (progressRef.current >= 98) {
      setRouteProgress(0);
    }
    setRouteProgressAtLeast(18);

    frameRef.current = window.requestAnimationFrame(() => {
      setRouteProgressAtLeast(58);
    });

    timersRef.current.push(
      window.setTimeout(() => {
        setRouteProgressAtLeast(86);
      }, ENTER_DELAY_MS),
      window.setTimeout(completeRouteProgress, MAX_WAIT_MS),
    );
  }, [clearRouteTimers, completeRouteProgress, location.pathname, setRouteProgress, setRouteProgressAtLeast]);

  useEffect(() => {
    if (!routePendingRef.current || phase === 'idle' || phase === 'exiting' || pageRefreshActive) return;

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const remaining = Math.max(0, SETTLE_DELAY_MS - (now - routeStartedAtRef.current));
    const timer = window.setTimeout(completeRouteProgress, remaining);
    timersRef.current.push(timer);

    return () => {
      window.clearTimeout(timer);
      timersRef.current = timersRef.current.filter((item) => item !== timer);
    };
  }, [completeRouteProgress, pageRefreshActive, phase]);

  const mounted = phase !== 'idle';
  const visible = phase !== 'idle' && phase !== 'exiting';

  return (
    <div
      className={`pointer-events-none fixed inset-x-0 top-0 z-[10050] h-[2px] overflow-hidden transition-opacity duration-150 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
      aria-hidden="true"
      data-route-progress
      data-route-progress-phase={phase}
    >
      {mounted ? (
        <div
          key={transitionId}
          className={`h-full origin-left bg-primary-container shadow-[0_0_14px_color-mix(in_srgb,var(--color-primary-container)_65%,transparent)] ${
            phase === 'settling'
              ? 'transition-transform duration-180 ease-out'
              : 'transition-transform duration-500 ease-out'
          }`}
          style={{ transform: `scaleX(${progress / 100})` }}
          data-route-progress-bar
        />
      ) : null}
    </div>
  );
}
