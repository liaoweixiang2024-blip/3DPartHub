/**
 * Shared constants and helpers used by model-admin sub-components.
 * Pure extraction — no logic changes.
 */

import type { ConversionQueueState, PreviewDiagnosticFilter } from '../../api/models';
import { i18n } from '../../i18n';

// ── Constants ──────────────────────────────────────────────────────────────

export const MODEL_SOURCE_FORMATS = ['step', 'stp', 'iges', 'igs'];
export const MODEL_SOURCE_ACCEPT = MODEL_SOURCE_FORMATS.map((item) => `.${item}`).join(',');
export const MODEL_SOURCE_LABEL = 'STEP/IGES';

// label 存 i18n key，渲染处用 t() 取文案
export const DIAGNOSTIC_FILTERS: Array<{ key: PreviewDiagnosticFilter; label: string; icon: string }> = [
  { key: 'all', label: 'modelAdminComp.filterAll', icon: 'inventory_2' },
  { key: 'problem', label: 'modelAdminComp.filterProblem', icon: 'warning' },
  { key: 'missing', label: 'modelAdminComp.filterMissing', icon: 'data_usage' },
  { key: 'invalid', label: 'modelAdminComp.filterInvalid', icon: 'error' },
  { key: 'warning', label: 'modelAdminComp.filterWarning', icon: 'checklist' },
  { key: 'ok', label: 'modelAdminComp.filterOk', icon: 'check_circle' },
];

export const QUEUE_STATUS_CARDS: Array<{
  key: 'waiting' | 'active' | 'delayed' | 'completed' | 'failed';
  label: string;
  icon: string;
}> = [
  { key: 'waiting', label: 'modelAdminComp.queueWaiting', icon: 'hourglass_top' },
  { key: 'active', label: 'modelAdminComp.queueActive', icon: 'play_circle' },
  { key: 'delayed', label: 'modelAdminComp.queueDelayed', icon: 'schedule' },
  { key: 'completed', label: 'modelAdminComp.queueCompleted', icon: 'check_circle' },
  { key: 'failed', label: 'modelAdminComp.queueFailed', icon: 'error' },
];

// ── Format helpers ─────────────────────────────────────────────────────────

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatModelDateTime(value?: string | null) {
  if (!value) return i18n.t('modelAdminComp.notRecorded');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return i18n.t('modelAdminComp.notRecorded');
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
      return i18n.t('modelAdminComp.queueActive');
    case 'waiting':
      return i18n.t('modelAdminComp.queueWaiting');
    case 'delayed':
      return i18n.t('modelAdminComp.queueDelayed');
    case 'prioritized':
      return i18n.t('modelAdminComp.queuePrioritized');
    case 'waiting-children':
      return i18n.t('modelAdminComp.queueWaitingChildren');
    case 'completed':
      return i18n.t('modelAdminComp.queueCompleted');
    case 'failed':
      return i18n.t('modelAdminComp.queueFailed');
    case 'paused':
      return i18n.t('modelAdminComp.queuePaused');
    default:
      return i18n.t('modelAdminComp.queueUnknown');
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
  if (minutes < 1) return i18n.t('modelAdminComp.durationLt1');
  if (minutes < 60) return i18n.t('modelAdminComp.durationMinutes', { count: minutes });
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0
    ? i18n.t('modelAdminComp.durationHoursMinutes', { hours, minutes: rest })
    : i18n.t('modelAdminComp.durationHours', { hours });
}

export function formatQueueFailureReason(reason?: string | null) {
  if (!reason) return null;
  if (reason.includes('job started more than allowable limit')) {
    return i18n.t('modelAdminComp.failureReasonStartLimit');
  }
  if (reason.includes('job stalled more than allowable limit')) {
    return i18n.t('modelAdminComp.failureReasonStalled');
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
