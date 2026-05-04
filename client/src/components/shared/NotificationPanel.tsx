import { useState, useEffect, useRef, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import Icon from './Icon';
import { useAuthStore } from '../../stores/useAuthStore';
import { useMediaQuery } from '../../layouts/hooks/useMediaQuery';
import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  clearReadNotifications,
  type Notification,
} from '../../api/notifications';

const TYPE_META: Record<string, { icon: string; color: string }> = {
  ticket: { icon: 'assignment_add', color: 'text-primary-container bg-primary-container/10' },
  comment: { icon: 'chat', color: 'text-blue-500 bg-blue-500/10' },
  favorite: { icon: 'star', color: 'text-pink-500 bg-pink-500/10' },
  download: { icon: 'download', color: 'text-purple-500 bg-purple-500/10' },
  success: { icon: 'check_circle', color: 'text-green-500 bg-green-500/10' },
  error: { icon: 'error', color: 'text-red-500 bg-red-500/10' },
  info: { icon: 'notifications', color: 'text-primary-container bg-primary-container/10' },
  model_conversion: { icon: 'view_in_ar', color: 'text-cyan-500 bg-cyan-500/10' },
  inquiry: { icon: 'request_quote', color: 'text-amber-500 bg-amber-500/10' },
};

function getTypeMeta(type: string) {
  return TYPE_META[type] || TYPE_META.info;
}

// Resolve route from notification type + relatedId
function getNotificationRoute(n: Notification, isAdmin: boolean): string | null {
  if (!n.relatedId) return null;
  if (n.type === 'ticket') return isAdmin ? `/admin/tickets/${n.relatedId}` : `/my-tickets/${n.relatedId}`;
  if (n.type === 'comment') return `/model/${n.relatedId}`;
  if (n.type === 'favorite') return `/model/${n.relatedId}`;
  if (n.type === 'download') return `/model/${n.relatedId}`;
  if (n.type === 'success') return `/model/${n.relatedId}`;
  if (n.type === 'error') return `/model/${n.relatedId}`;
  if (n.type === 'model_conversion') return `/model/${n.relatedId}`;
  if (n.type === 'inquiry') return isAdmin ? `/admin/inquiries/${n.relatedId}` : `/my-inquiries/${n.relatedId}`;
  return null;
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

function NotificationItem({
  n,
  isAdmin,
  onRead,
  onDelete,
  onNavigate,
}: {
  n: Notification;
  isAdmin: boolean;
  onRead: (id: string) => void;
  onDelete: (id: string) => void;
  onNavigate: (route: string) => void;
}) {
  const meta = getTypeMeta(n.type);
  const route = getNotificationRoute(n, isAdmin);

  const handleClick = () => {
    if (!n.read) onRead(n.id);
    if (route) onNavigate(route);
  };

  return (
    <div
      onClick={handleClick}
      className={`group relative flex items-start gap-3 border-b border-outline-variant/5 px-3 py-3 transition-colors sm:px-4 ${
        route
          ? 'cursor-pointer hover:bg-surface-container-highest/50 active:bg-surface-container-highest'
          : 'cursor-default'
      } ${n.read ? 'opacity-70' : ''}`}
    >
      <span className={`shrink-0 mt-0.5 w-7 h-7 rounded-full flex items-center justify-center ${meta.color}`}>
        <Icon name={meta.icon} size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-xs text-on-surface line-clamp-1 break-words ${!n.read ? 'font-medium' : ''}`}>{n.title}</p>
        <p className="text-[11px] text-on-surface-variant line-clamp-2 break-words mt-0.5">{n.message}</p>
        <p className="text-[10px] text-on-surface-variant/40 mt-1">{formatTime(n.createdAt)}</p>
      </div>
      <div className="shrink-0 flex items-center gap-1.5 mt-0.5">
        {!n.read && <span className="w-2 h-2 rounded-full bg-primary-container" />}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(n.id);
          }}
          className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant/70 opacity-70 transition hover:bg-error-container/15 hover:text-error hover:opacity-100 sm:h-6 sm:w-6 sm:opacity-0 sm:group-hover:opacity-70"
          title="删除"
          aria-label="删除通知"
        >
          <Icon name="close" size={12} />
        </button>
      </div>
    </div>
  );
}

export default function NotificationPanel({ compact = false }: { compact?: boolean }) {
  const { isAuthenticated, user } = useAuthStore();
  const isAdmin = user?.role === 'ADMIN';
  const isMobile = useMediaQuery('(max-width: 767px)');
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const iconSize = compact ? 20 : 24;
  const safeNotifications = Array.isArray(notifications) ? notifications : [];

  // Poll unread count
  useEffect(() => {
    if (!isAuthenticated) return;
    let timer: ReturnType<typeof setInterval>;
    let stopped = false;

    async function fetchCount() {
      if (stopped) return;
      try {
        const count = await getUnreadCount();
        if (!stopped) setUnreadCount(count);
      } catch {
        // Polling failures are ignored; the next interval retries automatically.
      }
    }

    const timeout = setTimeout(() => {
      fetchCount();
      timer = setInterval(fetchCount, 60000);
    }, 2000);

    return () => {
      stopped = true;
      clearTimeout(timeout);
      clearInterval(timer);
    };
  }, [isAuthenticated]);

  // Fetch notifications when panel opens
  useEffect(() => {
    if (!open || !isAuthenticated) return;
    let cancelled = false;
    async function fetchList() {
      setLoading(true);
      setLoadError('');
      try {
        const res = await getNotifications(1, 30);
        if (!cancelled) setNotifications(Array.isArray(res.data) ? res.data : []);
      } catch {
        if (!cancelled) setLoadError('通知加载失败，请稍后重试');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchList();
    return () => {
      cancelled = true;
    };
  }, [open, isAuthenticated]);

  // Close on outside click (desktop only — mobile uses backdrop overlay)
  useEffect(() => {
    if (!open || isMobile) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, isMobile]);

  const handleMarkRead = useCallback(async (id: string) => {
    try {
      await markAsRead(id);
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch {
      // Global error handling already reports request failures.
    }
  }, []);

  const handleMarkAllRead = useCallback(async () => {
    try {
      await markAllAsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch {
      // Global error handling already reports request failures.
    }
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await deleteNotification(id);
        setNotifications((prev) => prev.filter((n) => n.id !== id));
        const deleted = notifications.find((n) => n.id === id);
        if (deleted && !deleted.read) setUnreadCount((c) => Math.max(0, c - 1));
      } catch {
        // Global error handling already reports request failures.
      }
    },
    [notifications],
  );

  const handleClearRead = useCallback(async () => {
    try {
      await clearReadNotifications();
      setNotifications((prev) => prev.filter((n) => !n.read));
    } catch {
      // Global error handling already reports request failures.
    }
  }, []);

  const handleNavigate = useCallback(
    (route: string) => {
      setOpen(false);
      navigate(route);
    },
    [navigate],
  );

  if (!isAuthenticated) return null;

  const mobilePanelStyle = isMobile
    ? {
        top: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)',
      }
    : undefined;

  // Panel content shared between mobile drawer and desktop popup
  const panelContent = (
    <div className={isMobile ? 'flex h-full min-h-0 flex-col' : ''}>
      {/* Header */}
      <div className="shrink-0 border-b border-outline-variant/15 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <span className="text-sm font-headline font-bold text-on-surface">{isAdmin ? '管理通知' : '通知'}</span>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1">
            {unreadCount > 0 && (
              <button onClick={handleMarkAllRead} className="text-[11px] text-primary-container hover:underline">
                全部已读
              </button>
            )}
            {safeNotifications.some((n) => n.read) && (
              <button
                onClick={handleClearRead}
                className="text-[11px] text-on-surface-variant hover:text-on-surface transition-colors"
              >
                清除已读
              </button>
            )}
            {isMobile && (
              <button
                onClick={() => setOpen(false)}
                className="ml-0.5 flex h-7 w-7 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface"
                aria-label="关闭通知"
              >
                <Icon name="close" size={14} />
              </button>
            )}
          </div>
        </div>
        {loadError && (
          <div className="mt-2 rounded-md border border-error/20 bg-error-container/10 px-2.5 py-2 text-[11px] text-error">
            {loadError}
          </div>
        )}
      </div>

      {/* List */}
      <div
        className={`scrollbar-hidden overflow-y-auto ${isMobile ? 'min-h-0 flex-1 overscroll-contain pb-3' : 'max-h-96'}`}
      >
        {loading && (
          <div className="flex items-center justify-center py-10">
            <Icon name="autorenew" size={24} className="text-on-surface-variant/30 animate-spin" />
          </div>
        )}

        {!loading && safeNotifications.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 gap-2">
            <Icon name="notifications" size={32} className="text-on-surface-variant/20" />
            <p className="text-xs text-on-surface-variant">{isAdmin ? '暂无管理通知' : '暂无通知'}</p>
          </div>
        )}

        {!loading &&
          safeNotifications.map((n) => (
            <NotificationItem
              key={n.id}
              n={n}
              isAdmin={isAdmin}
              onRead={handleMarkRead}
              onDelete={handleDelete}
              onNavigate={handleNavigate}
            />
          ))}
      </div>
    </div>
  );

  // Mobile: bounded notification drawer
  if (isMobile && open) {
    return (
      <>
        <div className="relative" ref={ref}>
          <button
            onClick={() => setOpen(!open)}
            className="p-2 text-on-surface-variant hover:text-on-surface transition-colors relative"
            aria-label="通知"
            data-tooltip="通知"
            data-tooltip-side="bottom"
          >
            <Icon name="notifications" size={iconSize} />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 min-w-[16px] h-4 bg-error text-on-error text-[9px] font-bold rounded-full flex items-center justify-center leading-none px-0.5">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
        </div>
        <AnimatePresence>
          <motion.div
            key="notification-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-black/50"
            onClick={() => setOpen(false)}
          />
          <motion.div
            key="notification-panel"
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            style={mobilePanelStyle}
            className="fixed left-3 right-3 z-[201] flex min-h-0 flex-col overflow-hidden rounded-2xl border border-outline-variant/20 bg-surface-container-high shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {panelContent}
          </motion.div>
        </AnimatePresence>
      </>
    );
  }

  // Desktop: dropdown popup
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="p-2 text-on-surface-variant hover:text-on-surface transition-colors relative rounded-sm hover:bg-surface-container-high"
        aria-label="通知"
        data-tooltip="通知"
        data-tooltip-side="bottom"
      >
        <Icon name="notifications" size={iconSize} />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 min-w-[16px] h-4 bg-error text-on-error text-[9px] font-bold rounded-full flex items-center justify-center leading-none px-0.5">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-2 w-80 bg-surface-container-high border border-outline-variant/20 rounded-lg shadow-lg z-[100] overflow-hidden"
          >
            {panelContent}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
