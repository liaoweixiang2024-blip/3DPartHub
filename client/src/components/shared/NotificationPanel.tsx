import { useState, useEffect, useRef, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import Icon from "./Icon";
import { useAuthStore } from "../../stores/useAuthStore";
import { useMediaQuery } from "../../layouts/hooks/useMediaQuery";
import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  clearReadNotifications,
  type Notification,
} from "../../api/notifications";

const TYPE_META: Record<string, { icon: string; color: string }> = {
  ticket: { icon: "assignment_add", color: "text-primary-container bg-primary-container/10" },
  comment: { icon: "chat", color: "text-blue-500 bg-blue-500/10" },
  favorite: { icon: "star", color: "text-pink-500 bg-pink-500/10" },
  download: { icon: "download", color: "text-purple-500 bg-purple-500/10" },
  success: { icon: "check_circle", color: "text-green-500 bg-green-500/10" },
  error: { icon: "error", color: "text-red-500 bg-red-500/10" },
  info: { icon: "notifications", color: "text-primary-container bg-primary-container/10" },
  model_conversion: { icon: "view_in_ar", color: "text-cyan-500 bg-cyan-500/10" },
  inquiry: { icon: "request_quote", color: "text-amber-500 bg-amber-500/10" },
};

function getTypeMeta(type: string) {
  return TYPE_META[type] || TYPE_META.info;
}

// Resolve route from notification type + relatedId
function getNotificationRoute(n: Notification, isAdmin: boolean): string | null {
  if (!n.relatedId) return null;
  if (n.type === "ticket") return isAdmin ? `/admin/tickets/${n.relatedId}` : `/my-tickets/${n.relatedId}`;
  if (n.type === "comment") return `/model/${n.relatedId}`;
  if (n.type === "favorite") return `/model/${n.relatedId}`;
  if (n.type === "model_conversion") return `/model/${n.relatedId}`;
  if (n.type === "inquiry") return isAdmin ? `/admin/inquiries/${n.relatedId}` : `/my-inquiries/${n.relatedId}`;
  return null;
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;
  return d.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
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
  onNavigate: () => void;
}) {
  const meta = getTypeMeta(n.type);
  const route = getNotificationRoute(n, isAdmin);

  const handleClick = () => {
    if (!n.read) onRead(n.id);
    if (route) onNavigate();
  };

  return (
    <div
      onClick={handleClick}
      className={`group relative flex items-start gap-3 px-3 sm:px-4 py-3 border-b border-outline-variant/5 transition-colors cursor-pointer ${
        n.read ? "opacity-60" : "hover:bg-surface-container-highest/50"
      }`}
    >
      <span className={`shrink-0 mt-0.5 w-7 h-7 rounded-full flex items-center justify-center ${meta.color}`}>
        <Icon name={meta.icon} size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-xs text-on-surface line-clamp-1 break-words ${!n.read ? "font-medium" : ""}`}>{n.title}</p>
        <p className="text-[11px] text-on-surface-variant line-clamp-2 break-words mt-0.5">{n.message}</p>
        <p className="text-[10px] text-on-surface-variant/40 mt-1">{formatTime(n.createdAt)}</p>
      </div>
      <div className="shrink-0 flex items-center gap-1.5 mt-0.5">
        {!n.read && <span className="w-2 h-2 rounded-full bg-primary-container" />}
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(n.id); }}
          className="opacity-0 group-hover:opacity-60 hover:!opacity-100 p-0.5 text-on-surface-variant hover:text-error transition-opacity"
          title="删除"
        >
          <Icon name="close" size={12} />
        </button>
      </div>
    </div>
  );
}

export default function NotificationPanel({ compact = false }: { compact?: boolean }) {
  const { isAuthenticated, user } = useAuthStore();
  const isAdmin = user?.role === "ADMIN";
  const isMobile = useMediaQuery("(max-width: 767px)");
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const iconSize = compact ? 20 : 24;

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
      } catch {}
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
      try {
        const res = await getNotifications(1, 30);
        if (!cancelled) setNotifications(res.data);
      } catch {}
      finally { if (!cancelled) setLoading(false); }
    }
    fetchList();
    return () => { cancelled = true; };
  }, [open, isAuthenticated]);

  // Close on outside click (desktop only — mobile uses backdrop overlay)
  useEffect(() => {
    if (!open || isMobile) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, isMobile]);

  const handleMarkRead = useCallback(async (id: string) => {
    try {
      await markAsRead(id);
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch {}
  }, []);

  const handleMarkAllRead = useCallback(async () => {
    try {
      await markAllAsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch {}
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteNotification(id);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      const deleted = notifications.find((n) => n.id === id);
      if (deleted && !deleted.read) setUnreadCount((c) => Math.max(0, c - 1));
    } catch {}
  }, [notifications]);

  const handleClearRead = useCallback(async () => {
    try {
      await clearReadNotifications();
      setNotifications((prev) => prev.filter((n) => !n.read));
    } catch {}
  }, []);

  const handleNavigate = useCallback((route: string) => {
    setOpen(false);
    navigate(route);
  }, [navigate]);

  if (!isAuthenticated) return null;

  // Panel content shared between mobile drawer and desktop popup
  const panelContent = (
    <>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-outline-variant/15">
        <span className="text-sm font-headline font-bold text-on-surface">
          {isAdmin ? "管理通知" : "通知"}
        </span>
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          {unreadCount > 0 && (
            <button onClick={handleMarkAllRead} className="text-[11px] text-primary-container hover:underline">
              全部已读
            </button>
          )}
          {notifications.some((n) => n.read) && (
            <button onClick={handleClearRead} className="text-[11px] text-on-surface-variant hover:text-on-surface transition-colors">
              清除已读
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div className={`overflow-y-auto scrollbar-hidden ${isMobile ? 'max-h-[calc(100dvh-9rem)] pb-[env(safe-area-inset-bottom)]' : 'max-h-96'}`}>
        {loading && (
          <div className="flex items-center justify-center py-8">
            <Icon name="autorenew" size={24} className="text-on-surface-variant/30 animate-spin" />
          </div>
        )}

        {!loading && notifications.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 gap-2">
            <Icon name="notifications" size={32} className="text-on-surface-variant/20" />
            <p className="text-xs text-on-surface-variant">{isAdmin ? "暂无管理通知" : "暂无通知"}</p>
          </div>
        )}

        {!loading && notifications.map((n) => (
          <NotificationItem
            key={n.id}
            n={n}
            isAdmin={isAdmin}
            onRead={handleMarkRead}
            onDelete={handleDelete}
            onNavigate={() => {
              const route = getNotificationRoute(n, isAdmin);
              if (route) handleNavigate(route);
            }}
          />
        ))}
      </div>
    </>
  );

  // Mobile: full-screen drawer
  if (isMobile && open) {
    return (
      <>
        <div className="relative" ref={ref}>
          <button
            onClick={() => setOpen(!open)}
            className="p-2 text-on-surface-variant hover:text-on-surface transition-colors relative"
          >
            <Icon name="notifications" size={iconSize} />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 min-w-[16px] h-4 bg-error text-on-error text-[9px] font-bold rounded-full flex items-center justify-center leading-none px-0.5">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>
        </div>
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-black/50"
            onClick={() => setOpen(false)}
          />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-[201] bg-surface-container-high border-t border-outline-variant/20 rounded-t-2xl shadow-2xl max-h-[calc(100dvh-1rem)] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 rounded-full bg-outline-variant/30 mx-auto mt-2" />
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
      >
        <Icon name="notifications" size={iconSize} />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 min-w-[16px] h-4 bg-error text-on-error text-[9px] font-bold rounded-full flex items-center justify-center leading-none px-0.5">
            {unreadCount > 9 ? "9+" : unreadCount}
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
