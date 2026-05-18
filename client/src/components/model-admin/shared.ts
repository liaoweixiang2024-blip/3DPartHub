/**
 * Shared constants and helpers used by model-admin sub-components.
 * Pure extraction — no logic changes.
 */

import type { ConversionQueueState, PreviewDiagnosticFilter } from '../../api/models';

// ── Constants ──────────────────────────────────────────────────────────────

export const MODEL_SOURCE_FORMATS = ['step', 'stp', 'iges', 'igs', 'xt', 'x_t'];
export const MODEL_SOURCE_ACCEPT = MODEL_SOURCE_FORMATS.map((item) => `.${item}`).join(',');
export const MODEL_SOURCE_LABEL = 'STEP/IGES/XT';

export const DIAGNOSTIC_FILTERS: Array<{ key: PreviewDiagnosticFilter; label: string; icon: string }> = [
  { key: 'all', label: '全部', icon: 'inventory_2' },
  { key: 'problem', label: '待处理', icon: 'warning' },
  { key: 'missing', label: '缺少诊断', icon: 'data_usage' },
  { key: 'invalid', label: '转换异常', icon: 'error' },
  { key: 'warning', label: '需复核', icon: 'checklist' },
  { key: 'ok', label: '正常', icon: 'check_circle' },
];

export const QUEUE_STATUS_CARDS: Array<{
  key: 'waiting' | 'active' | 'delayed' | 'completed' | 'failed';
  label: string;
  icon: string;
}> = [
  { key: 'waiting', label: '等待', icon: 'hourglass_top' },
  { key: 'active', label: '处理中', icon: 'play_circle' },
  { key: 'delayed', label: '延迟', icon: 'schedule' },
  { key: 'completed', label: '完成', icon: 'check_circle' },
  { key: 'failed', label: '失败', icon: 'error' },
];

// ── Format helpers ─────────────────────────────────────────────────────────

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatModelDateTime(value?: string | null) {
  if (!value) return '未记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未记录';
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatCount(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return new Intl.NumberFormat('zh-CN').format(value);
}

export function formatBoundsSize(size?: [number, number, number] | null) {
  if (!size) return '-';
  return `${size.map((value) => value.toFixed(value >= 100 ? 0 : 1)).join(' x ')} mm`;
}

// ── Diagnostic helpers ─────────────────────────────────────────────────────

export function getDiagnosticTone(status: PreviewDiagnosticFilter, active = false) {
  if (active) return 'border-primary bg-primary-container text-on-primary';
  if (status === 'ok') return 'border-primary/20 bg-primary/5 text-primary';
  if (status === 'invalid') return 'border-error/20 bg-error/10 text-error';
  if (status === 'warning' || status === 'missing' || status === 'problem')
    return 'border-amber-500/20 bg-amber-500/10 text-amber-600';
  return 'border-outline-variant/20 bg-surface-container-low text-on-surface-variant';
}

// ── Conversion queue helpers ───────────────────────────────────────────────

export function getQueueStateLabel(state: ConversionQueueState) {
  switch (state) {
    case 'active':
      return '处理中';
    case 'waiting':
      return '等待';
    case 'delayed':
      return '延迟';
    case 'prioritized':
      return '优先';
    case 'waiting-children':
      return '等待子任务';
    case 'completed':
      return '完成';
    case 'failed':
      return '失败';
    case 'paused':
      return '暂停';
    default:
      return '未知';
  }
}

export function getQueueStateTone(state: ConversionQueueState) {
  if (state === 'active') return 'border-primary/25 bg-primary/10 text-primary';
  if (state === 'completed') return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600';
  if (state === 'failed') return 'border-error/20 bg-error/10 text-error';
  if (state === 'waiting' || state === 'delayed' || state === 'prioritized' || state === 'waiting-children')
    return 'border-amber-500/20 bg-amber-500/10 text-amber-600';
  return 'border-outline-variant/20 bg-surface-container-high text-on-surface-variant';
}

export function formatQueueTime(value?: number | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatQueueDuration(ms?: number | null) {
  if (!ms || ms <= 0) return '-';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return '不到 1 分钟';
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}

export function formatQueueFailureReason(reason?: string | null) {
  if (!reason) return null;
  if (reason.includes('job started more than allowable limit')) {
    return '任务启动次数超限：通常是转换服务重启、热更新或队列锁过早失效导致的队列保护失败，不代表 STEP 文件一定损坏。可重试该任务。';
  }
  if (reason.includes('job stalled more than allowable limit')) {
    return '任务多次被判定卡住：通常是转换进程退出、服务重启或长时间无响应导致。可查看日志后重试。';
  }
  return reason;
}

// ── Preview operations CSS helpers ─────────────────────────────────────────

const PREVIEW_OPS_BUTTON_BASE =
  'inline-flex h-8 w-[92px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-container/60 disabled:cursor-not-allowed disabled:opacity-50';
const PREVIEW_OPS_ACTION_ROW =
  'flex w-full max-w-full min-w-0 items-center gap-1.5 overflow-x-auto pb-1 sm:w-auto sm:shrink-0 sm:justify-end scrollbar-hidden';

export function previewOpsButtonClass(compact: boolean) {
  return compact
    ? 'inline-flex h-8 min-w-0 items-center justify-center gap-1 rounded-md px-1 text-[10px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-container/60 disabled:cursor-not-allowed disabled:opacity-50'
    : PREVIEW_OPS_BUTTON_BASE;
}

export function previewOpsActionRowClass(compact: boolean) {
  return compact ? 'grid w-full grid-cols-3 gap-1' : PREVIEW_OPS_ACTION_ROW;
}

export function previewOpsFilterRowClass(compact: boolean) {
  return compact ? 'mt-3 grid grid-cols-3 gap-1' : 'mt-3 flex gap-1.5 overflow-x-auto pb-1';
}

export function previewOpsFilterButtonClass(compact: boolean, active: boolean) {
  return `inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-sm border transition-colors ${
    compact ? 'px-1 text-[10px]' : 'shrink-0 px-2.5 text-[11px]'
  } ${
    active
      ? 'border-primary bg-primary-container/20 text-primary'
      : 'border-outline-variant/15 bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
  }`;
}
