import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from './Icon';

interface InfiniteLoadTriggerProps {
  hasMore: boolean;
  isLoading: boolean;
  onLoadMore: () => void;
  className?: string;
  label?: string;
  idleLabel?: string | null;
  loadingLabel?: string;
  buttonless?: boolean;
}

export default function InfiniteLoadTrigger({
  hasMore,
  isLoading,
  onLoadMore,
  className = '',
  label,
  idleLabel,
  loadingLabel,
  buttonless = false,
}: InfiniteLoadTriggerProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement | null>(null);
  const visibleLabel = label ?? t('infiniteLoad.more');
  const visibleIdleLabel = idleLabel === undefined ? t('infiniteLoad.idle') : idleLabel;
  const visibleLoadingLabel = loadingLabel ?? t('infiniteLoad.loading');

  useEffect(() => {
    if (!hasMore || isLoading) return;
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
      },
      { rootMargin: '240px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, isLoading, onLoadMore]);

  if (!hasMore && !isLoading) return null;

  if (buttonless) {
    const showIdleLabel = visibleIdleLabel !== null;
    const showStatus = isLoading || showIdleLabel;

    return (
      <div
        ref={ref}
        className={`flex justify-center ${showStatus ? 'py-3' : 'h-px py-0'} ${className}`}
        data-infinite-load-trigger
        data-infinite-load-mode="buttonless"
        data-infinite-load-state={isLoading ? 'loading' : 'idle'}
      >
        {showStatus ? (
          <span className="inline-flex items-center gap-2 rounded-full bg-surface-container-low px-3 py-1 text-[11px] text-on-surface-variant">
            {isLoading ? <Icon name="autorenew" size={13} className="animate-spin" /> : <Icon name="south" size={13} />}
            {isLoading ? visibleLoadingLabel : visibleIdleLabel}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className={`flex justify-center py-4 ${className}`}
      data-infinite-load-trigger
      data-infinite-load-mode="button"
      data-infinite-load-state={isLoading ? 'loading' : 'idle'}
    >
      <button
        type="button"
        onClick={onLoadMore}
        disabled={!hasMore || isLoading}
        className="inline-flex items-center gap-2 rounded-sm border border-outline-variant/20 bg-surface-container-high px-4 py-2 text-xs font-medium text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isLoading ? (
          <Icon name="autorenew" size={14} className="animate-spin" />
        ) : (
          <Icon name="expand_more" size={14} />
        )}
        {isLoading ? visibleLoadingLabel : visibleLabel}
      </button>
    </div>
  );
}
