import { useState } from 'react';
import { useMediaQuery } from '../../layouts/hooks/useMediaQuery';
import { AdminButton, AdminIconButton } from './AdminControls';

interface AdminRefreshButtonProps {
  onRefresh: () => Promise<void> | void;
  label?: string;
  loadingLabel?: string;
  ariaLabel?: string;
  disabled?: boolean;
  mobileIconOnly?: boolean;
}

export default function AdminRefreshButton({
  onRefresh,
  label = '刷新',
  loadingLabel = '刷新中...',
  ariaLabel = '刷新',
  disabled = false,
  mobileIconOnly = false,
}: AdminRefreshButtonProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [refreshing, setRefreshing] = useState(false);
  const busy = refreshing || disabled;
  const showText = isDesktop || !mobileIconOnly;

  async function handleClick() {
    if (busy) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }

  if (!showText) {
    return (
      <AdminIconButton
        icon="refresh"
        iconClassName={refreshing ? 'animate-spin' : ''}
        iconSize={17}
        onClick={handleClick}
        disabled={busy}
        aria-label={refreshing ? loadingLabel : ariaLabel}
      />
    );
  }

  return (
    <AdminButton
      icon="refresh"
      iconClassName={refreshing ? 'animate-spin' : ''}
      iconSize={isDesktop ? 16 : 14}
      onClick={handleClick}
      disabled={busy}
      aria-label={refreshing ? loadingLabel : ariaLabel}
      size={isDesktop ? 'md' : 'sm'}
      variant="secondary"
    >
      {refreshing ? loadingLabel : label}
    </AdminButton>
  );
}
