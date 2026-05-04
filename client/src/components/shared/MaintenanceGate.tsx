import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import type { MaintenanceStatus } from '../../api/settings';
import { useAuthStore } from '../../stores/useAuthStore';
import BrandMark from './BrandMark';
import Icon from './Icon';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');
const DEFAULT_STATUS: MaintenanceStatus = {
  enabled: false,
  manual: false,
  automatic: false,
  pending: 0,
  threshold: 50,
  title: '系统维护中',
  message: '系统正在进行维护、数据恢复或资源重建，部分页面可能暂时不可用。请稍后再访问。',
};
const LEGACY_MAINTENANCE_TITLE = '模型库维护中';
const LEGACY_MAINTENANCE_MESSAGE = '模型预览资源正在重建，部分模型数量和缩略图可能暂时不完整。请稍后再访问。';

function normalizeMaintenanceStatus(status: MaintenanceStatus): MaintenanceStatus {
  return {
    ...status,
    title: status.title === LEGACY_MAINTENANCE_TITLE ? DEFAULT_STATUS.title : status.title,
    message: status.message === LEGACY_MAINTENANCE_MESSAGE ? DEFAULT_STATUS.message : status.message,
  };
}

async function fetchMaintenanceStatus(): Promise<MaintenanceStatus> {
  const res = await fetch(`${API_BASE}/settings/maintenance-status`, { cache: 'no-store' });
  if (!res.ok) throw new Error('maintenance status unavailable');
  const body = await res.json();
  const data = body && typeof body === 'object' && 'data' in body ? body.data : body;
  return normalizeMaintenanceStatus({ ...DEFAULT_STATUS, ...data });
}

function isBypassedPath(pathname: string) {
  return pathname === '/login' || pathname.startsWith('/admin') || pathname.startsWith('/legal');
}

export default function MaintenanceGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const [status, setStatus] = useState<MaintenanceStatus>(DEFAULT_STATUS);
  const [checking, setChecking] = useState(false);

  const bypassed = useMemo(
    () => user?.role === 'ADMIN' || isBypassedPath(location.pathname),
    [location.pathname, user?.role],
  );

  const refresh = useCallback(async () => {
    if (bypassed) {
      setStatus(DEFAULT_STATUS);
      return;
    }
    setChecking(true);
    try {
      setStatus(await fetchMaintenanceStatus());
    } catch {
      setStatus(DEFAULT_STATUS);
    } finally {
      setChecking(false);
    }
  }, [bypassed]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 20_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  if (bypassed || !status.enabled) return <>{children}</>;

  return (
    <main className="min-h-dvh bg-surface text-on-surface flex items-center justify-center px-5 py-10">
      <section className="w-full max-w-lg rounded-xl border border-outline-variant/20 bg-surface-container-low shadow-sm px-6 py-7 sm:px-8 sm:py-8 text-center">
        <BrandMark size="nav" centered className="mx-auto mb-5 max-w-full" />
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary-container/10 text-primary-container">
          <Icon name="build" size={28} />
        </div>
        <h1 className="text-2xl font-headline font-bold text-on-surface">{status.title || DEFAULT_STATUS.title}</h1>
        <p className="mt-3 text-sm leading-6 text-on-surface-variant">{status.message || DEFAULT_STATUS.message}</p>
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={refresh}
            disabled={checking}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-primary-container px-4 text-sm font-medium text-on-primary-container transition hover:opacity-90 disabled:opacity-60"
          >
            <Icon
              name={checking ? 'progress_activity' : 'refresh'}
              size={16}
              className={checking ? 'animate-spin' : ''}
            />
            {checking ? '检查中' : '重新检查'}
          </button>
        </div>
      </section>
    </main>
  );
}
