import { conversionQueue } from "./queue.js";
import { getAllSettings } from "./settings.js";

export type MaintenanceStatus = {
  enabled: boolean;
  manual: boolean;
  automatic: boolean;
  pending: number;
  threshold: number;
  title: string;
  message: string;
};

let maintenanceStatusCache: { value: MaintenanceStatus; expiresAt: number } | null = null;

function numberSetting(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function fallbackMaintenanceStatus(): MaintenanceStatus {
  return {
    enabled: false,
    manual: false,
    automatic: false,
    pending: 0,
    threshold: 50,
    title: "系统维护中",
    message: "系统正在进行维护、数据恢复或资源重建，部分页面可能暂时不可用。请稍后再访问。",
  };
}

export async function getMaintenanceStatus(): Promise<MaintenanceStatus> {
  const now = Date.now();
  if (maintenanceStatusCache && maintenanceStatusCache.expiresAt > now) {
    return maintenanceStatusCache.value;
  }

  try {
    const all = await getAllSettings();
    const manual = Boolean(all.maintenance_enabled ?? false);
    const autoEnabled = Boolean(all.maintenance_auto_enabled ?? true);
    const threshold = numberSetting(all.maintenance_auto_queue_threshold, 50, 1, 100_000);
    const counts = await conversionQueue.getJobCounts("waiting", "active", "delayed");
    const pending = (counts.waiting || 0) + (counts.active || 0) + (counts.delayed || 0);
    const automatic = autoEnabled && pending >= threshold;
    const title = typeof all.maintenance_title === "string" ? all.maintenance_title : "系统维护中";
    const message = typeof all.maintenance_message === "string"
      ? all.maintenance_message
      : "系统正在进行维护、数据恢复或资源重建，部分页面可能暂时不可用。请稍后再访问。";

    const result: MaintenanceStatus = {
      enabled: manual || automatic,
      manual,
      automatic,
      pending,
      threshold,
      title,
      message,
    };
    maintenanceStatusCache = { value: result, expiresAt: now + 5000 };
    return result;
  } catch {
    const result = fallbackMaintenanceStatus();
    maintenanceStatusCache = { value: result, expiresAt: now + 5000 };
    return result;
  }
}
