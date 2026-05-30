import { AnimatePresence, motion } from 'framer-motion';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  clearReadNotifications,
  type Notification,
} from '../../api/notifications';
import { useMediaQuery } from '../../layouts/hooks/useMediaQuery';
import { bottomSheetMotion, overlayMotion, popoverMotion } from '../../lib/motion';
import { useAuthStore } from '../../stores/useAuthStore';
import Icon from './Icon';

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
  backup: { icon: 'database', color: 'text-orange-500 bg-orange-500/10' },
};

const NOTIFICATION_LIST_STALE_MS = 30_000;
const NOTIFICATION_COUNT_POLL_MS = 15_000;

function getTypeMeta(type: string) {
  return TYPE_META[type] || TYPE_META.info;
}

// Resolve route from notification type + relatedId
function getNotificationRoute(n: Notification, isAdmin: boolean): string | null {
  if (n.actionPath) return n.actionPath;
  if (n.type === 'backup') return isAdmin ? '/admin/settings#backup' : null;
  if (!n.relatedId) return null;
  if (n.type === 'ticket')
    return isAdmin ? `/admin/tickets/${n.relatedId}#messages` : `/my-tickets/${n.relatedId}#messages`;
  if (n.type === 'comment') return `/model/${n.relatedId}`;
  if (n.type === 'favorite') return `/model/${n.relatedId}`;
  if (n.type === 'download') return `/model/${n.relatedId}`;
  if (n.type === 'success') return `/model/${n.relatedId}`;
  if (n.type === 'error') return `/model/${n.relatedId}`;
  if (n.type === 'model_conversion') return `/model/${n.relatedId}`;
  if (n.type === 'inquiry') {
    return isAdmin ? `/admin/inquiries/${n.relatedId}#messages` : `/my-inquiries/${n.relatedId}#messages`;
  }
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
      onKeyDown={(event) => {
        if (!route) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleClick();
        }
      }}
      role={route ? 'button' : undefined}
      tabIndex={route ? 0 : undefined}
      aria-label={route ? `${n.title}，打开详情` : n.title}
      className={`group relative flex items-start gap-3 border-b border-outline-variant/5 px-3 py-3 transition-colors sm:px-4 ${
        route
          ? 'cursor-pointer outline-none hover:bg-surface-container-highest/50 focus-visible:bg-surface-container-highest/50 focus-visible:ring-2 focus-visible:ring-primary/30 active:bg-surface-container-highest'
          : 'cursor-default'
      } ${n.read ? 'opacity-70' : ''}`}
    >
      <span className={`shrink-0 mt-0.5 w-7 h-7 rounded-full flex items-center justify-center ${meta.color}`}>
        <Icon name={meta.icon} size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-xs text-on-surface line-clamp-1 break-words ${!n.read ? 'font-medium' : ''}`}>{n.title}</p>
        <p className="text-[11px] text-on-surface-variant line-clamp-2 break-words mt-0.5">{n.message}</p>
        <div className="mt-1 flex min-w-0 items-center gap-2">
          <p className="shrink-0 text-[10px] text-on-surface-variant/40">{formatTime(n.createdAt)}</p>
          {route && (
            <span className="inline-flex min-w-0 items-center gap-0.5 text-[10px] font-medium text-primary-container opacity-80 transition-opacity group-hover:opacity-100">
              <span>打开详情</span>
              <Icon name="chevron_right" size={11} />
            </span>
          )}
        </div>
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

export default function NotificationPanel({
  compact = false,
  onLoginClick,
  showTooltip = true,
}: {
  compact?: boolean;
  onLoginClick?: () => void;
  showTooltip?: boolean;
}) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'ADMIN';
  const isMobile = useMediaQuery('(max-width: 767px)');
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const listFetchedAtRef = useRef(0);
  const listInflightRef = useRef<Promise<void> | null>(null);

  const iconSize = 20;
  const safeNotifications = Array.isArray(notifications) ? notifications : [];

  const refreshUnreadCount = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      setUnreadCount(await getUnreadCount());
    } catch {
      // Polling failures are ignored; the next interval retries automatically.
    }
  }, [isAuthenticated]);

  const fetchNotifications = useCallback(
    async ({ preload = false, force = false }: { preload?: boolean; force?: boolean } = {}) => {
      if (!isAuthenticated) return;

      const now = Date.now();
      if (!force && listFetchedAtRef.current && now - listFetchedAtRef.current < NOTIFICATION_LIST_STALE_MS) {
        return;
      }

      if (!preload) {
        setLoading(true);
        setLoadError('');
      }

      if (!listInflightRef.current) {
        listInflightRef.current = getNotifications(1, 30)
          .then((res) => {
            setNotifications(Array.isArray(res.data) ? res.data : []);
            listFetchedAtRef.current = Date.now();
          })
          .finally(() => {
            listInflightRef.current = null;
          });
      }

      try {
        await listInflightRef.current;
      } catch {
        if (!preload) setLoadError('通知加载失败，请稍后重试');
      } finally {
        if (!preload) setLoading(false);
      }
    },
    [isAuthenticated],
  );

  const handleNotificationIntent = useCallback(() => {
    void fetchNotifications({ preload: true });
  }, [fetchNotifications]);

  // Fetch notifications when panel opens
  useEffect(() => {
    if (!open || !isAuthenticated) return;
    void fetchNotifications({ force: true });
    void refreshUnreadCount();
  }, [fetchNotifications, isAuthenticated, open, refreshUnreadCount]);

  // Poll unread count. New notifications may be created by another browser or user,
  // so the bell must refresh independently of local actions.
  useEffect(() => {
    if (!isAuthenticated) return;
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      void refreshUnreadCount();
      if (open) void fetchNotifications({ force: true, preload: true });
    };
    tick();
    const timer = setInterval(tick, NOTIFICATION_COUNT_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [fetchNotifications, isAuthenticated, open, refreshUnreadCount]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const refreshVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void refreshUnreadCount();
      if (open) void fetchNotifications({ force: true });
    };
    document.addEventListener('visibilitychange', refreshVisible);
    window.addEventListener('focus', refreshVisible);
    return () => {
      document.removeEventListener('visibilitychange', refreshVisible);
      window.removeEventListener('focus', refreshVisible);
    };
  }, [fetchNotifications, isAuthenticated, open, refreshUnreadCount]);

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

  // Always render the bell icon so it's visible in PWA standalone mode
  // where session restoration may be slow. If not authenticated, tapping
  // it triggers the login flow via UserMenu's onLoginRequired.
  if (!isAuthenticated) {
    if (compact) {
      return (
        <button
          onClick={() => {
            if (onLoginClick) {
              onLoginClick();
            } else {
              window.location.href = '/login';
            }
          }}
          className="p-2 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors"
          aria-label="通知"
          title={showTooltip ? '登录后查看通知' : undefined}
        >
          <Icon name="notifications" size={20} />
        </button>
      );
    }
    return null;
  }

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
            onPointerEnter={handleNotificationIntent}
            onPointerDown={handleNotificationIntent}
            onFocus={handleNotificationIntent}
            className="p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-lg transition-colors relative"
            aria-label="通知"
            data-tooltip={showTooltip ? '通知' : undefined}
            data-tooltip-side={showTooltip ? 'bottom' : undefined}
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
            variants={overlayMotion}
            initial="initial"
            animate="animate"
            exit="exit"
            className="fixed inset-0 z-[200] bg-black/50"
            onClick={() => setOpen(false)}
          />
          <motion.div
            key="notification-panel"
            variants={bottomSheetMotion}
            initial="initial"
            animate="animate"
            exit="exit"
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
        onPointerEnter={handleNotificationIntent}
        onPointerDown={handleNotificationIntent}
        onFocus={handleNotificationIntent}
        className="p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-lg transition-colors relative"
        aria-label="通知"
        data-tooltip={showTooltip ? '通知' : undefined}
        data-tooltip-side={showTooltip ? 'bottom' : undefined}
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
            variants={popoverMotion}
            initial="initial"
            animate="animate"
            exit="exit"
            className="absolute right-0 top-full mt-2 w-80 bg-surface-container-high border border-outline-variant/20 rounded-lg shadow-lg z-[100] overflow-hidden"
          >
            {panelContent}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
