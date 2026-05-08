import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';

const REFRESH_ICON_CLASS = 'animate-spin text-primary-container motion-reduce:animate-none';
const REFRESH_ENTER_DELAY_MS = 140;
const REFRESH_MIN_VISIBLE_MS = 220;

type RefreshEntry = {
  id: string;
  label: string;
};

let refreshVersion = 0;
let refreshEntries: RefreshEntry[] = [];
const refreshListeners = new Set<() => void>();

function notifyRefreshListeners() {
  refreshVersion += 1;
  refreshListeners.forEach((listener) => listener());
}

function subscribeRefresh(listener: () => void) {
  refreshListeners.add(listener);
  return () => refreshListeners.delete(listener);
}

function getRefreshSnapshot() {
  return refreshVersion;
}

function upsertRefreshEntry(entry: RefreshEntry) {
  const index = refreshEntries.findIndex((item) => item.id === entry.id);
  if (index >= 0) {
    refreshEntries[index] = entry;
  } else {
    refreshEntries = [...refreshEntries, entry];
  }
  notifyRefreshListeners();
}

function removeRefreshEntry(id: string) {
  refreshEntries = refreshEntries.filter((entry) => entry.id !== id);
  notifyRefreshListeners();
}

function getActiveRefreshEntry() {
  return refreshEntries.at(-1) ?? null;
}

function getCurrentTime() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function PageRefreshIndicator({ label = '页面刷新中' }: { label?: string }) {
  const refreshId = useId();

  useLayoutEffect(() => {
    upsertRefreshEntry({ id: refreshId, label });
    return () => removeRefreshEntry(refreshId);
  }, [label, refreshId]);

  return null;
}

export function usePageRefreshActive() {
  useSyncExternalStore(subscribeRefresh, getRefreshSnapshot, getRefreshSnapshot);
  return getActiveRefreshEntry() !== null;
}

export function GlobalPageRefreshIndicator() {
  useSyncExternalStore(subscribeRefresh, getRefreshSnapshot, getRefreshSnapshot);
  const [visibleEntry, setVisibleEntry] = useState<RefreshEntry | null>(null);
  const visibleSinceRef = useRef(0);
  const showTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);

  const activeEntry = getActiveRefreshEntry();

  useEffect(() => {
    return () => {
      if (showTimerRef.current !== null) window.clearTimeout(showTimerRef.current);
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (showTimerRef.current !== null) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }

    if (activeEntry) {
      if (visibleEntry) {
        setVisibleEntry(activeEntry);
        return;
      }

      showTimerRef.current = window.setTimeout(() => {
        visibleSinceRef.current = getCurrentTime();
        setVisibleEntry(activeEntry);
        showTimerRef.current = null;
      }, REFRESH_ENTER_DELAY_MS);
      return;
    }

    if (!visibleEntry) return;

    const elapsed = getCurrentTime() - visibleSinceRef.current;
    const remaining = Math.max(0, REFRESH_MIN_VISIBLE_MS - elapsed);
    hideTimerRef.current = window.setTimeout(() => {
      setVisibleEntry(null);
      hideTimerRef.current = null;
    }, remaining);
  }, [activeEntry, visibleEntry]);

  if (!visibleEntry || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div className="contents" aria-busy="true" aria-live="polite">
      <span className="sr-only">{visibleEntry.label}</span>
      <div
        className="pointer-events-none fixed left-1/2 top-1/2 z-[10040] flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-outline-variant/20 bg-surface-container-low shadow-[0_8px_24px_rgba(15,23,42,0.12)]"
        data-page-refresh-indicator
      >
        <Icon name="refresh" size={24} className={REFRESH_ICON_CLASS} />
      </div>
    </div>,
    document.body,
  );
}

export default function PageRefreshFallback({
  standalone = false,
  label = '页面刷新中',
}: {
  standalone?: boolean;
  label?: string;
}) {
  return (
    <div
      className={
        standalone ? 'flex min-h-dvh flex-col bg-surface-dim' : 'flex min-h-full flex-1 flex-col bg-surface-dim'
      }
      data-page-refresh-fallback
    >
      <PageRefreshIndicator label={label} />
    </div>
  );
}
