import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  label,
  loadingLabel,
  ariaLabel,
  disabled = false,
  mobileIconOnly = false,
}: AdminRefreshButtonProps) {
  const { t } = useTranslation();
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [refreshing, setRefreshing] = useState(false);
  const busy = refreshing || disabled;
  const showText = isDesktop || !mobileIconOnly;
  const visibleLabel = label ?? t('adminState.refresh');
  const visibleLoadingLabel = loadingLabel ?? t('adminState.refreshing');
  const visibleAriaLabel = ariaLabel ?? t('adminState.refresh');

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
        aria-label={refreshing ? visibleLoadingLabel : visibleAriaLabel}
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
      aria-label={refreshing ? visibleLoadingLabel : visibleAriaLabel}
      size={isDesktop ? 'md' : 'sm'}
      variant="secondary"
    >
      {refreshing ? visibleLoadingLabel : visibleLabel}
    </AdminButton>
  );
}
