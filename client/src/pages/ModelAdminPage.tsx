import { startTransition, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useMediaQuery } from '../layouts/hooks/useMediaQuery';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useVisibleItems } from '../hooks/useVisibleItems';
import { SkeletonList } from '../components/shared/Skeleton';
import Icon from '../components/shared/Icon';
import ModelThumbnail from '../components/shared/ModelThumbnail';
import InfiniteLoadTrigger from '../components/shared/InfiniteLoadTrigger';
import { AdminPageShell } from "../components/shared/AdminPageShell";
import { AdminManagementPage } from "../components/shared/AdminManagementPage";
import { useToast } from '../components/shared/Toast';
import { modelApi, type ConversionQueueJob, type ConversionQueueState, type ModelGroupItem, type ModelPreviewDiagnosticItem, type PreviewDiagnosticFilter, type ServerModelListItem } from '../api/models';
import { openModelDrawing } from '../api/downloads';
import { categoriesApi, type CategoryItem } from '../api/categories';
import { getSettings, updateSettings } from '../api/settings';
import CategorySelect from '../components/shared/CategorySelect';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
import { getCachedPublicSettings } from '../lib/publicSettings';
import { getBusinessConfig } from '../lib/businessConfig';

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatModelDateTime(value?: string | null) {
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

const MODEL_SOURCE_FORMATS = ['step', 'stp', 'iges', 'igs', 'xt', 'x_t'];
const MODEL_SOURCE_ACCEPT = MODEL_SOURCE_FORMATS.map((item) => `.${item}`).join(',');
const MODEL_SOURCE_LABEL = 'STEP/IGES/XT';
const MODEL_ADMIN_PAGE_SIZE = 60;
const MODEL_ADMIN_VISIBLE_BATCH_SIZE = 80;
const MOBILE_MODEL_VISIBLE_BATCH_SIZE = 40;
const MERGE_SUGGESTION_PAGE_SIZE = 40;
const MODEL_ADMIN_PANEL_CLASS = "rounded-lg border border-outline-variant/10 bg-surface-container-low overflow-auto min-h-[calc(100vh-220px)] max-h-[calc(100vh-220px)]";

const DIAGNOSTIC_FILTERS: Array<{ key: PreviewDiagnosticFilter; label: string; icon: string }> = [
  { key: 'all', label: '全部', icon: 'inventory_2' },
  { key: 'problem', label: '待处理', icon: 'warning' },
  { key: 'missing', label: '缺少诊断', icon: 'data_usage' },
  { key: 'invalid', label: '转换异常', icon: 'error' },
  { key: 'warning', label: '需复核', icon: 'checklist' },
  { key: 'ok', label: '正常', icon: 'check_circle' },
];

const QUEUE_STATUS_CARDS: Array<{ key: 'waiting' | 'active' | 'delayed' | 'completed' | 'failed'; label: string; icon: string }> = [
  { key: 'waiting', label: '等待', icon: 'hourglass_top' },
  { key: 'active', label: '处理中', icon: 'play_circle' },
  { key: 'delayed', label: '延迟', icon: 'schedule' },
  { key: 'completed', label: '完成', icon: 'check_circle' },
  { key: 'failed', label: '失败', icon: 'error' },
];

function useDebouncedValue<T>(value: T, delay = 300) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);

  return debouncedValue;
}

function useModelAdminList(search: string) {
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const getKey = useCallback(
    (pageIndex: number, previousPageData: Awaited<ReturnType<typeof modelApi.list>> | null) => {
      if (previousPageData && previousPageData.page >= previousPageData.totalPages) return null;
      return ['/admin/models', debouncedSearch, pageIndex + 1] as const;
    },
    [debouncedSearch]
  );

  const { data, error, isLoading, isValidating, mutate, setSize, size } = useSWRInfinite(
    getKey,
    ([, query, page]) => modelApi.list({
      search: query || undefined,
      page,
      pageSize: MODEL_ADMIN_PAGE_SIZE,
      grouped: false,
    }),
    { revalidateFirstPage: false }
  );

  useEffect(() => {
    setSize(1);
  }, [debouncedSearch, setSize]);

  const pages = data || [];
  const items = pages.flatMap((page) => page.items);
  const firstPage = pages[0];
  const lastPage = pages[pages.length - 1];
  const hasMore = Boolean(lastPage && lastPage.page < lastPage.totalPages);
  const isLoadingMore = Boolean(size > 0 && !data?.[size - 1] && !error);

  const loadMore = useCallback(() => {
    if (!hasMore || isLoadingMore) return;
    setSize((current) => current + 1);
  }, [hasMore, isLoadingMore, setSize]);

  return {
    items,
    total: firstPage?.total || 0,
    isLoadingInitial: isLoading && pages.length === 0,
    isLoadingMore,
    isValidating,
    hasMore,
    loadMore,
    mutate,
  };
}

function useMergeSuggestionPages(enabled: boolean) {
  const getKey = useCallback(
    (pageIndex: number, previousPageData: Awaited<ReturnType<typeof modelApi.getMergeSuggestions>> | null) => {
      if (!enabled) return null;
      if (previousPageData && pageIndex * MERGE_SUGGESTION_PAGE_SIZE >= previousPageData.total) return null;
      return ['/model-groups/suggestions', pageIndex + 1] as const;
    },
    [enabled]
  );

  const { data, error, isLoading, mutate, setSize, size } = useSWRInfinite(
    getKey,
    ([, page]) => modelApi.getMergeSuggestions({ page, pageSize: MERGE_SUGGESTION_PAGE_SIZE }),
    { revalidateFirstPage: false }
  );

  const pages = data || [];
  const groups = pages.flatMap((page) => page.data);
  const total = pages[0]?.total ?? 0;
  const hasMore = groups.length < total;
  const isLoadingMore = Boolean(size > 0 && !data?.[size - 1] && !error);
  const loadMore = useCallback(() => {
    if (!hasMore || isLoadingMore) return;
    setSize((current) => current + 1);
  }, [hasMore, isLoadingMore, setSize]);

  return {
    groups,
    total,
    isLoading: isLoading && pages.length === 0,
    isLoadingMore,
    hasMore,
    loadMore,
    mutate,
  };
}

function formatCount(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return new Intl.NumberFormat('zh-CN').format(value);
}

function formatBoundsSize(size?: [number, number, number] | null) {
  if (!size) return '-';
  return `${size.map((value) => value.toFixed(value >= 100 ? 0 : 1)).join(' x ')} mm`;
}

function getDiagnosticTone(status: PreviewDiagnosticFilter, active = false) {
  if (active) return 'border-primary bg-primary-container text-on-primary';
  if (status === 'ok') return 'border-primary/20 bg-primary/5 text-primary';
  if (status === 'invalid') return 'border-error/20 bg-error/10 text-error';
  if (status === 'warning' || status === 'missing' || status === 'problem') return 'border-amber-500/20 bg-amber-500/10 text-amber-600';
  return 'border-outline-variant/20 bg-surface-container-low text-on-surface-variant';
}

function getQueueStateLabel(state: ConversionQueueState) {
  switch (state) {
    case 'active': return '处理中';
    case 'waiting': return '等待';
    case 'delayed': return '延迟';
    case 'prioritized': return '优先';
    case 'waiting-children': return '等待子任务';
    case 'completed': return '完成';
    case 'failed': return '失败';
    case 'paused': return '暂停';
    default: return '未知';
  }
}

function getQueueStateTone(state: ConversionQueueState) {
  if (state === 'active') return 'border-primary/25 bg-primary/10 text-primary';
  if (state === 'completed') return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600';
  if (state === 'failed') return 'border-error/20 bg-error/10 text-error';
  if (state === 'waiting' || state === 'delayed' || state === 'prioritized' || state === 'waiting-children') return 'border-amber-500/20 bg-amber-500/10 text-amber-600';
  return 'border-outline-variant/20 bg-surface-container-high text-on-surface-variant';
}

function formatQueueTime(value?: number | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatQueueDuration(ms?: number | null) {
  if (!ms || ms <= 0) return '-';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return '不到 1 分钟';
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}

function formatQueueFailureReason(reason?: string | null) {
  if (!reason) return null;
  if (reason.includes('job started more than allowable limit')) {
    return '任务启动次数超限：通常是转换服务重启、热更新或队列锁过早失效导致的队列保护失败，不代表 STEP 文件一定损坏。可重试该任务。';
  }
  if (reason.includes('job stalled more than allowable limit')) {
    return '任务多次被判定卡住：通常是转换进程退出、服务重启或长时间无响应导致。可查看日志后重试。';
  }
  return reason;
}

function DiagnosticStatusBadge({ item }: { item: ModelPreviewDiagnosticItem }) {
  return (
    <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-sm border px-2 py-0.5 text-[10px] font-medium ${getDiagnosticTone(item.preview_status)}`}>
      {item.preview_label}
    </span>
  );
}

function PerformanceBadge({ level }: { level?: ModelPreviewDiagnosticItem['performance_level'] }) {
  if (!level || level === 'normal') return null;
  const label = level === 'huge' ? '超大模型' : '大模型';
  const className = level === 'huge'
    ? 'border-error/20 bg-error/10 text-error'
    : 'border-amber-500/20 bg-amber-500/10 text-amber-600';
  return (
    <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-sm border px-2 py-0.5 text-[10px] font-medium ${className}`}>
      {label}
    </span>
  );
}

function QueueStateBadge({ state }: { state: ConversionQueueState }) {
  return (
    <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-sm border px-2 py-0.5 text-[10px] font-medium ${getQueueStateTone(state)}`}>
      {getQueueStateLabel(state)}
    </span>
  );
}

const PREVIEW_OPS_BUTTON_BASE = 'inline-flex h-8 w-[92px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-sm px-2 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';
const PREVIEW_OPS_ACTION_ROW = 'flex w-full max-w-full min-w-0 items-center gap-1.5 overflow-x-auto pb-1 sm:w-auto sm:shrink-0 sm:justify-end scrollbar-hidden';

function previewOpsButtonClass(compact: boolean) {
  return compact
    ? 'inline-flex h-7 min-w-0 items-center justify-center gap-1 rounded-sm px-1 text-[10px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50'
    : PREVIEW_OPS_BUTTON_BASE;
}

function previewOpsActionRowClass(compact: boolean) {
  return compact
    ? 'grid w-full grid-cols-3 gap-1'
    : PREVIEW_OPS_ACTION_ROW;
}

function previewOpsFilterRowClass(compact: boolean) {
  return compact
    ? 'mt-3 grid grid-cols-3 gap-1'
    : 'mt-3 flex gap-1.5 overflow-x-auto pb-1';
}

function previewOpsFilterButtonClass(compact: boolean, active: boolean) {
  return `inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-sm border transition-colors ${
    compact ? 'px-1 text-[10px]' : 'shrink-0 px-2.5 text-[11px]'
  } ${
    active
      ? 'border-primary bg-primary-container/20 text-primary'
      : 'border-outline-variant/15 bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
  }`;
}

function PreviewDiagnosticsPanel({ compact = false, embedded = false }: { compact?: boolean; embedded?: boolean }) {
  const { toast } = useToast();
  const [status, setStatus] = useState<PreviewDiagnosticFilter>('problem');
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildingAll, setRebuildingAll] = useState(false);
  const { data, isLoading, mutate } = useSWR(
    ['/models/preview-diagnostics', status, compact],
    () => modelApi.previewDiagnostics({ status, page: 1, pageSize: compact ? 4 : 6 })
  );
  const summary = data?.summary;
  const visibleItems = data?.items || [];

  const getValue = (key: PreviewDiagnosticFilter) => {
    if (!summary) return undefined;
    if (key === 'all') return summary.total;
    return summary[key];
  };

  const handleRebuild = async () => {
    if (!data || data.total === 0 || status === 'ok') return;
    const limit = compact ? 20 : 50;
    const ok = window.confirm(`将把当前筛选的前 ${Math.min(limit, data.total)} 个模型加入预览重建队列，生成新的 GLB 与缩略图。是否继续？`);
    if (!ok) return;
    setRebuilding(true);
    try {
      const result = await modelApi.rebuildPreviewDiagnostics({ status, limit });
      toast(`已加入队列 ${result.queued} 个${result.skipped ? `，跳过 ${result.skipped} 个` : ''}`, result.failed ? 'error' : 'success');
      mutate();
    } catch {
      toast('加入重建队列失败', 'error');
    } finally {
      setRebuilding(false);
    }
  };

  const handleRebuildAll = async () => {
    const total = summary?.total || 0;
    if (total <= 0) return;
    const ok = window.confirm(`将把全部 ${total} 个模型加入预览重建队列，重新生成 GLB 与缩略图。任务会按后台队列慢慢执行，耗时可能较长。是否继续？`);
    if (!ok) return;
    setRebuildingAll(true);
    try {
      const result = await modelApi.rebuildPreviewDiagnostics({ all: true, status: 'all', limit: total });
      toast(`已加入队列 ${result.queued} 个${result.skipped ? `，跳过 ${result.skipped} 个` : ''}`, result.failed ? 'error' : 'success');
      mutate();
    } catch {
      toast('一键重建全部失败', 'error');
    } finally {
      setRebuildingAll(false);
    }
  };

  return (
    <section className={embedded ? 'flex h-full min-w-0 flex-col' : 'flex h-full min-w-0 flex-col rounded-lg border border-outline-variant/10 bg-surface-container-low p-4'}>
      <div className={embedded ? 'flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between' : 'flex min-h-[72px] flex-col gap-3 lg:flex-row lg:items-start lg:justify-between'}>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon name="data_usage" size={17} className="text-primary" />
            <h3 className="text-sm font-semibold text-on-surface">预览诊断</h3>
            {summary && <span className="text-[10px] text-on-surface-variant">{summary.total} 个模型</span>}
          </div>
          {!embedded && <p className="mt-1 text-xs text-on-surface-variant">扫描现有 GLB/glTF 诊断，快速定位缩略图异常、面片为空或包围盒异常的模型。</p>}
        </div>
        <div className={previewOpsActionRowClass(compact)}>
          <button
            onClick={() => mutate()}
            disabled={isLoading}
            className={`${previewOpsButtonClass(compact)} border border-outline-variant/20 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface`}
          >
            <Icon name="refresh" size={14} className={isLoading ? 'animate-spin' : ''} />
            {embedded ? '扫描' : '重新扫描'}
          </button>
          <button
            onClick={handleRebuild}
            disabled={isLoading || rebuilding || rebuildingAll || status === 'ok' || !data || data.total === 0}
            className={`${previewOpsButtonClass(compact)} bg-primary-container text-on-primary hover:bg-primary`}
          >
            <Icon name="autorenew" size={14} className={rebuilding ? 'animate-spin' : ''} />
            {rebuilding ? '加入中...' : embedded ? '重建当前' : compact ? '重建异常' : '加入重建队列'}
          </button>
          <button
            onClick={handleRebuildAll}
            disabled={isLoading || rebuilding || rebuildingAll || !summary?.total}
            className={`${previewOpsButtonClass(compact)} border border-primary/25 bg-primary/10 text-primary hover:bg-primary-container hover:text-on-primary`}
          >
            <Icon name="sync" size={14} className={rebuildingAll ? 'animate-spin' : ''} />
            {rebuildingAll ? '加入中...' : embedded ? '全部重建' : compact ? '一键全部' : '一键重建全部'}
          </button>
        </div>
      </div>

      {embedded ? (
        <div className={previewOpsFilterRowClass(compact)}>
          {DIAGNOSTIC_FILTERS.map((item) => {
            const active = status === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setStatus(item.key)}
                className={previewOpsFilterButtonClass(compact, active)}
              >
                <span>{item.label}</span>
                <span className="font-mono font-semibold">{formatCount(getValue(item.key))}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className={`mt-4 grid gap-2 ${compact ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-5'}`}>
          {DIAGNOSTIC_FILTERS.map((item) => (
            <button
              key={item.key}
              onClick={() => setStatus(item.key)}
              className={`flex min-h-[68px] items-center justify-between rounded-sm border px-3 py-2 text-left transition-colors ${getDiagnosticTone(item.key, status === item.key)}`}
            >
              <span className="min-w-0">
                <span className="block text-[11px] font-medium">{item.label}</span>
                <span className="mt-1 block font-mono text-lg font-semibold">{formatCount(getValue(item.key))}</span>
              </span>
              <Icon name={item.icon} size={18} className="shrink-0 opacity-80" />
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 flex min-h-0 flex-1 flex-col border-t border-outline-variant/10 pt-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-[11px] uppercase tracking-wider text-on-surface-variant font-medium">
            {status === 'ok' ? '正常模型' : '异常模型'}
          </span>
          {data && <span className="text-[10px] text-on-surface-variant">显示 {visibleItems.length} / {data.total}</span>}
        </div>
        {isLoading ? (
          <div className={`grid flex-1 gap-2 overflow-y-auto pr-1 ${compact ? 'min-h-[224px] max-h-[224px]' : 'min-h-[280px] max-h-[280px]'}`}>
            {[0, 1, 2].slice(0, compact ? 2 : 3).map((item) => (
              <div key={item} className="h-14 animate-pulse rounded-sm bg-surface-container-high" />
            ))}
          </div>
        ) : visibleItems.length > 0 ? (
          <div className={`grid flex-1 content-start gap-2 overflow-y-auto pr-1 ${compact ? 'min-h-[224px] max-h-[224px]' : 'min-h-[280px] max-h-[280px]'}`}>
            {visibleItems.map((item) => (
              <Link
                key={item.model_id}
                to={`/model/${item.model_id}`}
                target="_blank"
                className="flex items-center gap-3 rounded-sm border border-outline-variant/10 bg-surface-container-lowest px-3 py-2 hover:bg-surface-container-high"
              >
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded-sm bg-surface-container-highest">
                  <ModelThumbnail src={item.thumbnail_url} alt="" className="h-full w-full object-cover" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-xs font-medium text-on-surface">{item.name}</p>
                    <DiagnosticStatusBadge item={item} />
                    <PerformanceBadge level={item.performance_level} />
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-on-surface-variant">
                    <span className="font-mono">{item.format?.toUpperCase() || '-'}</span>
                    <span>面片 {formatCount(item.face_count)}</span>
                    <span>顶点 {formatCount(item.vertex_count)}</span>
                    <span>跳过 {formatCount(item.skipped_mesh_count)}</span>
                    {!!item.estimated_peak_memory_mb && item.estimated_peak_memory_mb >= 512 && (
                      <span>预估内存 {formatCount(item.estimated_peak_memory_mb)} MB</span>
                    )}
                    {!compact && <span>包围盒 {formatBoundsSize(item.bounds_size)}</span>}
                  </div>
                </div>
                {!compact && (
                  <span className="hidden max-w-[180px] shrink-0 text-right text-[10px] text-on-surface-variant xl:block">
                    {item.preview_reason}
                  </span>
                )}
                <Icon name="open_in_new" size={14} className="shrink-0 text-on-surface-variant" />
              </Link>
            ))}
          </div>
        ) : (
          <div className={`flex flex-1 items-center justify-center rounded-sm border border-outline-variant/10 bg-surface-container-lowest px-3 py-4 text-center text-xs text-on-surface-variant ${compact ? 'min-h-[224px]' : 'min-h-[280px]'}`}>
            {status === 'ok' ? '暂时没有正常诊断记录' : '当前没有需要处理的预览异常'}
          </div>
        )}
      </div>
    </section>
  );
}

function ConversionQueuePanel({ compact = false, embedded = false }: { compact?: boolean; embedded?: boolean }) {
  const { toast } = useToast();
  const [queueAction, setQueueAction] = useState<string | null>(null);
  const [detailJobId, setDetailJobId] = useState<string | null>(null);
  const [selectedQueueState, setSelectedQueueState] = useState<ConversionQueueState | 'all'>('all');
  const queueListLimit = selectedQueueState === 'all' ? (compact ? 4 : 6) : (compact ? 8 : 12);
  const { data, isLoading, mutate } = useSWR(
    ['/tasks/conversion-queue', compact, selectedQueueState, queueListLimit],
    () => modelApi.conversionQueue({ limit: queueListLimit, state: selectedQueueState }),
    { refreshInterval: 2000 }
  );
  const { data: detail, isLoading: detailLoading } = useSWR(
    detailJobId ? ['/tasks/conversion-queue/detail', detailJobId] : null,
    () => modelApi.conversionQueueJob(detailJobId!)
  );
  const items = data?.items || [];
  const visibleQueueItems = items.slice(0, queueListLimit);
  const queueCounts = data?.queue_counts || data?.counts;
  const queueDisplayTotal = selectedQueueState === 'all' ? items.length : data?.total ?? items.length;
  const activeCount = data?.counts.active || 0;
  const running = (data?.counts.active || 0) + (data?.counts.waiting || 0) + (data?.counts.delayed || 0);
  const failedCount = data?.counts.failed || 0;
  const completedQueueCount = queueCounts?.completed || 0;
  const selectedQueueLabel = selectedQueueState === 'all'
    ? '最近任务'
    : `${QUEUE_STATUS_CARDS.find((item) => item.key === selectedQueueState)?.label || getQueueStateLabel(selectedQueueState)}任务`;
  const [queueNow, setQueueNow] = useState(() => Date.now());
  const queueGeneratedAt = data?.generated_at ? Date.parse(data.generated_at) : queueNow;

  useEffect(() => {
    if (activeCount <= 0) return;
    const timer = window.setInterval(() => setQueueNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeCount]);

  const getLiveActiveMs = (job: ConversionQueueJob) => {
    if (job.state !== 'active') return job.active_ms || 0;
    const fetchedMs = job.active_ms || 0;
    const localElapsed = Number.isFinite(queueGeneratedAt) ? Math.max(0, queueNow - queueGeneratedAt) : 0;
    return fetchedMs + localElapsed;
  };

  const getVisualProgress = (job: ConversionQueueJob) => {
    if (job.state === 'active') {
      const activeMs = getLiveActiveMs(job);
      const estimated = 20 + 74 * (1 - Math.exp(-activeMs / 180000));
      return Math.min(job.is_stale ? 98 : 94, Math.max(job.progress, estimated, 8));
    }
    if (job.state === 'waiting' || job.state === 'delayed') return 4;
    return Math.max(job.progress, 0);
  };

  const handleRetryFailed = async () => {
    if (failedCount <= 0) return;
    const ok = window.confirm(`将重试最多 ${Math.min(failedCount, 25)} 个失败的转换任务，并把关联模型重新标记为排队中。是否继续？`);
    if (!ok) return;
    setQueueAction('retry');
    try {
      const result = await modelApi.retryFailedConversionJobs({ limit: 25 });
      toast(`已重试 ${result.retried || 0} 个失败任务${result.skipped ? `，跳过 ${result.skipped} 个` : ''}`, result.failed ? 'error' : 'success');
      mutate();
    } catch {
      toast('重试失败任务失败', 'error');
    } finally {
      setQueueAction(null);
    }
  };

  const handleCancelPreviewRebuilds = async () => {
    if (running <= 0) return;
    const ok = window.confirm('将停止预览重建：取消等待中/延迟中的重建任务。正在处理的当前模型不会强制中断，会完成后停止继续执行后续重建。是否继续？');
    if (!ok) return;
    setQueueAction('cancel-rebuilds');
    try {
      const result = await modelApi.cancelPreviewRebuildJobs({ limit: 10000 });
      const activeText = result.active ? `，${result.active} 个正在处理会自然完成` : '';
      toast(`已取消 ${result.cancelled || 0} 个重建任务${activeText}`, result.failed ? 'error' : 'success');
      mutate();
    } catch {
      toast('取消预览重建任务失败', 'error');
    } finally {
      setQueueAction(null);
    }
  };

  const handleCleanQueue = async (type: 'completed' | 'failed') => {
    const count = type === 'completed' ? completedQueueCount : failedCount;
    if (count <= 0) return;
    const label = type === 'completed' ? '已完成' : '失败';
    const ok = window.confirm(`将清理最多 100 条${label}转换任务记录。只删除队列记录，不会删除模型文件。是否继续？`);
    if (!ok) return;
    setQueueAction(`clean-${type}`);
    try {
      const result = await modelApi.cleanConversionQueue({ type, limit: 100, graceMs: 0 });
      toast(`已清理 ${result.cleaned || 0} 条${label}任务记录`, 'success');
      mutate();
    } catch {
      toast('清理转换队列失败', 'error');
    } finally {
      setQueueAction(null);
    }
  };

  const renderJob = (job: ConversionQueueJob) => {
    const content = (
      <>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-xs font-medium text-on-surface">{job.model_name || job.original_name || job.id}</p>
            <QueueStateBadge state={job.state} />
            {job.is_stale && (
              <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-sm border border-error/20 bg-error/10 px-1.5 py-0.5 text-[10px] font-medium text-error">
                可能卡住
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-on-surface-variant">
            <span className="font-mono">#{job.id}</span>
            {job.ext && <span>{job.ext.toUpperCase()}</span>}
            {job.rebuild_reason && <span>重建 {job.rebuild_reason}</span>}
            <span>{formatQueueTime(job.processed_on || job.timestamp)}</span>
            {job.state === 'active' && <span>已处理 {formatQueueDuration(getLiveActiveMs(job))}</span>}
            {job.state === 'active' && <span>估算 {Math.round(getVisualProgress(job))}%</span>}
          </div>
          {(job.state === 'active' || job.state === 'waiting' || job.state === 'delayed') && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-sm bg-surface-container-highest">
              <div
                className={`h-full rounded-sm transition-all duration-700 ${job.state === 'active' ? 'animate-pulse bg-primary' : 'bg-primary-container'}`}
                style={{ width: `${getVisualProgress(job)}%` }}
              />
            </div>
          )}
          {job.failed_reason && (
            <p className="mt-1 line-clamp-1 text-[10px] text-error">{formatQueueFailureReason(job.failed_reason)}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={() => setDetailJobId(job.id)}
            className="inline-flex items-center justify-center rounded-sm border border-outline-variant/20 px-2 py-1 text-[10px] text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
          >
            详情
          </button>
          {job.model_id && (
            <Link
              to={`/model/${job.model_id}`}
              target="_blank"
              className="inline-flex items-center justify-center rounded-sm border border-outline-variant/20 p-1 text-on-surface-variant hover:bg-surface-container-high hover:text-primary"
              title="打开模型"
            >
              <Icon name="open_in_new" size={14} />
            </Link>
          )}
        </div>
      </>
    );

    return (
      <div key={job.id} className="flex items-start gap-3 rounded-sm border border-outline-variant/10 bg-surface-container-lowest px-3 py-2 hover:bg-surface-container-high">
        {content}
      </div>
    );
  };

  return (
    <>
    <section className={embedded ? 'flex h-full min-w-0 flex-col' : 'flex h-full min-w-0 flex-col rounded-lg border border-outline-variant/10 bg-surface-container-low p-4'}>
      <div className={embedded ? 'flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between' : 'flex min-h-[72px] flex-col gap-3 lg:flex-row lg:items-start lg:justify-between'}>
        <div className="min-w-0 shrink-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Icon name="hourglass_top" size={17} className="text-primary" />
            <h3 className="shrink-0 text-sm font-semibold text-on-surface">转换队列</h3>
            <span className={`inline-flex max-w-full shrink-0 whitespace-nowrap rounded-sm px-1.5 py-0.5 text-[10px] leading-none ${running > 0 ? 'bg-primary/10 text-primary' : 'bg-surface-container-high text-on-surface-variant'}`}>
              {running > 0 ? `${formatCount(running)} 个待完成` : '空闲'}
            </span>
          </div>
          {!embedded && <p className="mt-1 text-xs text-on-surface-variant">实时查看上传、重建和缩略图生成任务状态。</p>}
        </div>
        <div className={previewOpsActionRowClass(compact)}>
          <button
            onClick={() => mutate()}
            disabled={isLoading}
            className={`${previewOpsButtonClass(compact)} border border-outline-variant/20 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface`}
            title="刷新队列"
          >
            <Icon name="refresh" size={15} className={isLoading ? 'animate-spin' : ''} />
            <span>刷新</span>
          </button>
          <button
            onClick={handleRetryFailed}
            disabled={isLoading || !!queueAction || failedCount <= 0}
            className={`${previewOpsButtonClass(compact)} border border-outline-variant/20 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface`}
            title="重试失败任务"
          >
            <Icon name="replay" size={14} className={queueAction === 'retry' ? 'animate-spin' : ''} />
            <span>重试</span>
          </button>
          <button
            onClick={handleCancelPreviewRebuilds}
            disabled={isLoading || !!queueAction || running <= 0}
            className={`${previewOpsButtonClass(compact)} border border-error/20 text-error hover:bg-error/10`}
            title="取消等待中的预览重建任务"
          >
            <Icon name="close" size={14} className={queueAction === 'cancel-rebuilds' ? 'animate-spin' : ''} />
            <span>停止重建</span>
          </button>
          <button
            onClick={() => handleCleanQueue('completed')}
            disabled={isLoading || !!queueAction || completedQueueCount <= 0}
            className={`${previewOpsButtonClass(compact)} border border-outline-variant/20 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface`}
            title={`清理 BullMQ 保留的完成记录：${formatCount(completedQueueCount)} 条`}
          >
            <Icon name="cleaning_services" size={14} className={queueAction === 'clean-completed' ? 'animate-spin' : ''} />
            清理完成
          </button>
          <button
            onClick={() => handleCleanQueue('failed')}
            disabled={isLoading || !!queueAction || failedCount <= 0}
            className={`${previewOpsButtonClass(compact)} border border-outline-variant/20 text-on-surface-variant hover:bg-error/10 hover:text-error`}
          >
            <Icon name="delete_sweep" size={14} className={queueAction === 'clean-failed' ? 'animate-spin' : ''} />
            清理失败
          </button>
        </div>
      </div>

      {embedded ? (
        <div className={previewOpsFilterRowClass(compact)}>
          {QUEUE_STATUS_CARDS.map((item) => {
            const active = selectedQueueState === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setSelectedQueueState((current) => current === item.key ? 'all' : item.key)}
                className={previewOpsFilterButtonClass(compact, active)}
                title={item.key === 'completed' ? '完成数按模型库实际完成数量统计，点击查看队列保留的完成记录' : `点击筛选${item.label}任务`}
              >
                <span>{item.label}</span>
                <span className="font-mono font-semibold">{formatCount(data?.counts[item.key])}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className={`mt-4 grid gap-2 ${compact ? 'grid-cols-2' : 'grid-cols-3 xl:grid-cols-5'}`}>
          {QUEUE_STATUS_CARDS.map((item) => {
            const active = selectedQueueState === item.key;
            return (
            <button
              key={item.key}
              type="button"
              onClick={() => setSelectedQueueState((current) => current === item.key ? 'all' : item.key)}
              className={`min-h-[68px] rounded-sm border px-3 py-2 text-left transition ${active ? 'border-primary bg-primary-container/20 text-primary ring-1 ring-primary/30' : getQueueStateTone(item.key)} hover:-translate-y-0.5 hover:shadow-sm`}
              title={item.key === 'completed' ? '完成数按模型库实际完成数量统计，点击查看队列保留的完成记录' : `点击筛选${item.label}任务`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium">{item.label}</span>
                <Icon name={item.icon} size={16} className="shrink-0 opacity-80" />
              </div>
              <span className="mt-1 block font-mono text-lg font-semibold">{formatCount(data?.counts[item.key])}</span>
              <span className="mt-0.5 block text-[10px] opacity-75">
                {item.key === 'completed' ? `保留 ${formatCount(queueCounts?.completed)}` : active ? '正在筛选' : '点击筛选'}
              </span>
            </button>
            );
          })}
        </div>
      )}

      <div className="mt-3 flex min-h-0 flex-1 flex-col border-t border-outline-variant/10 pt-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-[11px] font-medium text-on-surface-variant">{selectedQueueLabel}</span>
          <div className="flex items-center gap-2 text-[10px] text-on-surface-variant">
            <span>显示 {visibleQueueItems.length} / {queueDisplayTotal} 条</span>
            {data?.generated_at && <span>{new Date(data.generated_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>}
          </div>
        </div>
        {isLoading ? (
          <div className={`grid flex-1 gap-2 overflow-y-auto pr-1 ${compact ? 'min-h-[224px] max-h-[224px]' : 'min-h-[280px] max-h-[280px]'}`}>
            {[0, 1, 2].slice(0, compact ? 2 : 3).map((item) => (
              <div key={item} className="h-14 animate-pulse rounded-sm bg-surface-container-high" />
            ))}
          </div>
        ) : visibleQueueItems.length > 0 ? (
          <div className={`grid flex-1 content-start gap-2 overflow-y-auto pr-1 ${compact ? 'min-h-[224px] max-h-[224px]' : 'min-h-[280px] max-h-[280px]'}`}>
            {visibleQueueItems.map(renderJob)}
          </div>
        ) : (
          <div className={`flex flex-1 items-center justify-center rounded-sm border border-outline-variant/10 bg-surface-container-lowest px-3 py-4 text-center text-xs text-on-surface-variant ${compact ? 'min-h-[224px]' : 'min-h-[280px]'}`}>
            暂无转换任务
          </div>
        )}
      </div>
    </section>
    {detailJobId && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-dim/70 px-4 py-6 backdrop-blur-sm" onClick={() => setDetailJobId(null)}>
        <div className="max-h-[88vh] w-full max-w-3xl overflow-hidden rounded-lg border border-outline-variant/20 bg-surface-container-low shadow-xl" onClick={(event) => event.stopPropagation()}>
          <div className="flex items-center justify-between gap-3 border-b border-outline-variant/10 px-5 py-4">
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-on-surface">转换任务详情</h3>
              <p className="mt-1 truncate text-xs text-on-surface-variant">{detailJobId}</p>
            </div>
            <button onClick={() => setDetailJobId(null)} className="rounded-sm border border-outline-variant/20 p-1.5 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface">
              <Icon name="close" size={16} />
            </button>
          </div>
          <div className="max-h-[calc(88vh-72px)] overflow-y-auto p-5">
            {detailLoading ? (
              <div className="space-y-3">
                <div className="h-16 animate-pulse rounded-sm bg-surface-container-high" />
                <div className="h-36 animate-pulse rounded-sm bg-surface-container-high" />
              </div>
            ) : detail ? (
              <div className="space-y-4">
                <div className="grid gap-2 text-xs sm:grid-cols-2">
                  <div className="rounded-sm bg-surface-container-lowest p-3">
                    <span className="block text-[10px] text-on-surface-variant">状态</span>
                    <span className="mt-1 inline-flex"><QueueStateBadge state={detail.state} /></span>
                  </div>
                  <div className="rounded-sm bg-surface-container-lowest p-3">
                    <span className="block text-[10px] text-on-surface-variant">进度 / 尝试次数</span>
                    <span className="mt-1 block font-mono text-on-surface">{detail.progress}% / {detail.attempts_made}</span>
                    {detail.state === 'active' && (
                      <span className={detail.is_stale ? 'mt-1 block text-[10px] text-error' : 'mt-1 block text-[10px] text-on-surface-variant'}>
                        已处理 {formatQueueDuration(detail.active_ms)}{detail.is_stale ? '，可能卡住' : ''}
                      </span>
                    )}
                  </div>
                  <div className="rounded-sm bg-surface-container-lowest p-3">
                    <span className="block text-[10px] text-on-surface-variant">模型</span>
                    <span className="mt-1 block truncate text-on-surface">{detail.model?.name || detail.data?.original_name || detail.model_id || '-'}</span>
                  </div>
                  <div className="rounded-sm bg-surface-container-lowest p-3">
                    <span className="block text-[10px] text-on-surface-variant">格式 / 重建原因</span>
                    <span className="mt-1 block font-mono text-on-surface">{detail.data?.ext?.toUpperCase() || '-'} / {detail.data?.rebuild_reason || '-'}</span>
                  </div>
                  <div className="rounded-sm bg-surface-container-lowest p-3 sm:col-span-2">
                    <span className="block text-[10px] text-on-surface-variant">源文件</span>
                    <span className="mt-1 block break-all font-mono text-on-surface">{detail.data?.source_path || detail.data?.source_name || '-'}</span>
                    <span className={`mt-1 inline-block rounded-sm px-1.5 py-0.5 text-[10px] ${detail.data?.source_exists === false ? 'bg-error/10 text-error' : 'bg-primary/10 text-primary'}`}>
                      {detail.data?.source_exists === null || detail.data?.source_exists === undefined ? '未知' : detail.data.source_exists ? '文件存在' : '文件不存在'}
                    </span>
                  </div>
                </div>

                {detail.failed_reason && (
                  <div className="rounded-sm border border-error/20 bg-error/10 p-3">
                    <div className="mb-1 text-[11px] font-medium text-error">失败原因</div>
                    <p className="break-words text-xs text-error">{formatQueueFailureReason(detail.failed_reason)}</p>
                  </div>
                )}

                <div className="rounded-sm border border-outline-variant/10 bg-surface-container-lowest p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[11px] font-medium text-on-surface-variant">任务日志</span>
                    <span className="font-mono text-[10px] text-on-surface-variant">{(detail.logs || []).length} / {detail.log_count || 0}</span>
                  </div>
                  {(detail.logs || []).length > 0 ? (
                    <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-surface-container-high p-3 text-[11px] leading-relaxed text-on-surface">{(detail.logs || []).join('\n')}</pre>
                  ) : (
                    <div className="rounded-sm bg-surface-container-high px-3 py-4 text-center text-xs text-on-surface-variant">暂无日志</div>
                  )}
                </div>

                {(detail.stacktrace || []).length > 0 && (
                  <div className="rounded-sm border border-outline-variant/10 bg-surface-container-lowest p-3">
                    <div className="mb-2 text-[11px] font-medium text-on-surface-variant">错误栈</div>
                    <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-surface-container-high p-3 text-[11px] leading-relaxed text-error">{(detail.stacktrace || []).join('\n')}</pre>
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  {detail.model_id && (
                    <Link to={`/model/${detail.model_id}`} target="_blank" className="inline-flex items-center gap-1.5 rounded-sm border border-outline-variant/20 px-3 py-1.5 text-xs text-on-surface-variant hover:bg-surface-container-high hover:text-primary">
                      <Icon name="open_in_new" size={14} />
                      打开模型
                    </Link>
                  )}
                  <button onClick={() => setDetailJobId(null)} className="rounded-sm bg-primary-container px-3 py-1.5 text-xs font-medium text-on-primary hover:bg-primary">关闭</button>
                </div>
              </div>
            ) : (
              <div className="rounded-sm bg-surface-container-high px-3 py-8 text-center text-xs text-on-surface-variant">任务详情加载失败</div>
            )}
          </div>
        </div>
      </div>
    )}
    </>
  );
}

function PreviewOpsMetricCard({
  label,
  value,
  tone = 'neutral',
  loading = false,
}: {
  label: string;
  value?: number | null;
  tone?: 'neutral' | 'primary' | 'warning' | 'error';
  loading?: boolean;
}) {
  const toneClass = {
    neutral: 'text-on-surface',
    primary: 'text-primary',
    warning: 'text-amber-600',
    error: 'text-error',
  }[tone];

  return (
    <div className="flex min-h-[42px] items-center justify-between gap-3 rounded-sm border border-outline-variant/10 bg-surface-container-lowest px-2.5 py-1.5">
      <span className="truncate text-[10px] text-on-surface-variant">{label}</span>
      <span className={`shrink-0 font-mono text-base font-semibold ${toneClass}`}>
        {loading ? '-' : formatCount(value)}
      </span>
    </div>
  );
}

function ConversionConcurrencyControl({ compact = false }: { compact?: boolean }) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [localValue, setLocalValue] = useState(1);
  const { data: settings, mutate: mutateSettings } = useSWR(
    '/settings/conversion-worker-concurrency',
    getSettings,
    { revalidateOnFocus: false }
  );
  const savedValue = Math.min(8, Math.max(1, Number(settings?.conversion_worker_concurrency) || 1));
  const changed = localValue !== savedValue;

  useEffect(() => {
    setLocalValue(savedValue);
  }, [savedValue]);

  const saveConcurrency = async () => {
    const nextValue = Math.min(8, Math.max(1, Math.floor(localValue || 1)));
    setSaving(true);
    try {
      const nextSettings = await updateSettings({ conversion_worker_concurrency: nextValue });
      await mutateSettings(nextSettings, false);
      setLocalValue(nextValue);
      toast(`转换并发数已设为 ${nextValue}，Worker 会在约 15 秒内生效`, 'success');
    } catch {
      toast('保存转换并发数失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`mt-3 rounded-sm border border-outline-variant/10 bg-surface-container-lowest ${compact ? 'p-2' : 'px-3 py-2.5'}`}>
      <div className={`flex gap-2 ${compact ? 'flex-col' : 'flex-col md:flex-row md:items-center md:justify-between'}`}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Icon name="tune" size={15} className="text-primary" />
            <span className="text-xs font-medium text-on-surface">转换并发数</span>
            <span className="rounded-sm bg-surface-container-high px-1.5 py-0.5 text-[10px] text-on-surface-variant">当前 {savedValue}</span>
            {!compact && <span className="text-[10px] text-on-surface-variant">建议先设为 2，大模型较多时不要过高。</span>}
          </div>
        </div>
        <div className={`flex items-center gap-2 ${compact ? 'w-full' : 'shrink-0'}`}>
          <input
            type="range"
            min={1}
            max={8}
            step={1}
            value={localValue}
            onChange={(event) => setLocalValue(Number(event.target.value))}
            className={`${compact ? 'min-w-0 flex-1' : 'w-36'} accent-[var(--color-primary)]`}
            aria-label="转换并发数"
          />
          <input
            type="number"
            min={1}
            max={8}
            value={localValue}
            onChange={(event) => setLocalValue(Math.min(8, Math.max(1, Number(event.target.value) || 1)))}
            className="h-8 w-14 rounded-sm border border-outline-variant/20 bg-surface-container-low px-2 text-center text-xs text-on-surface outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={saveConcurrency}
            disabled={saving || !changed}
            className="inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-sm bg-primary-container px-2.5 text-[11px] font-medium text-on-primary transition-colors hover:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Icon name="save" size={13} className={saving ? 'animate-pulse' : ''} />
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

function PreviewOperationsPanel({ compact = false }: { compact?: boolean }) {
  const [compactPanel, setCompactPanel] = useState<'diagnostics' | 'queue'>('diagnostics');
  const { data: opsData, isLoading: opsLoading } = useSWR(
    ['/models/preview-operations-dashboard', compact],
    async () => {
      const [diagnostics, queue] = await Promise.all([
        modelApi.previewDiagnostics({ status: 'problem', page: 1, pageSize: 1 }),
        modelApi.conversionQueue({ limit: 1, state: 'all' }),
      ]);
      return { diagnostics, queue };
    },
    { refreshInterval: 5000 }
  );
  const diagnosticsSummary = opsData?.diagnostics.summary;
  const queueCounts = opsData?.queue.queue_counts || opsData?.queue.counts;
  const pendingQueueCount = (queueCounts?.waiting || 0) + (queueCounts?.active || 0) + (queueCounts?.delayed || 0);
  const failedQueueCount = queueCounts?.failed || 0;

  return (
    <section className={`rounded-lg border border-outline-variant/10 bg-surface-container-low ${compact ? 'p-3' : 'p-4'}`}>
      <div className="flex items-center justify-between gap-3 border-b border-outline-variant/10 pb-3 pr-10">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-sm bg-primary-container/10 text-primary">
              <Icon name="view_in_ar" size={16} />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-on-surface">预览运维工作台</h3>
              <p className="mt-0.5 text-[11px] text-on-surface-variant">诊断、重建、队列状态</p>
            </div>
          </div>
        </div>
      </div>

      <div className={`grid gap-2 pt-3 ${compact ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-4'}`}>
        <PreviewOpsMetricCard
          label="全部模型"
          value={diagnosticsSummary?.total}
          loading={opsLoading}
        />
        <PreviewOpsMetricCard
          label="待处理"
          value={diagnosticsSummary?.problem}
          tone={(diagnosticsSummary?.problem || 0) > 0 ? 'warning' : 'primary'}
          loading={opsLoading}
        />
        <PreviewOpsMetricCard
          label="队列"
          value={pendingQueueCount}
          tone={pendingQueueCount > 0 ? 'primary' : 'neutral'}
          loading={opsLoading}
        />
        <PreviewOpsMetricCard
          label="失败"
          value={failedQueueCount}
          tone={failedQueueCount > 0 ? 'error' : 'neutral'}
          loading={opsLoading}
        />
      </div>

      <ConversionConcurrencyControl compact={compact} />

      {compact ? (
        <>
          <div className="mt-3 grid grid-cols-2 gap-1 rounded-sm bg-surface-container-high p-1">
            <button
              type="button"
              onClick={() => setCompactPanel('diagnostics')}
              className={`flex h-9 items-center justify-center gap-1.5 rounded-sm text-xs font-medium transition-colors ${
                compactPanel === 'diagnostics'
                  ? 'bg-surface-container-lowest text-on-surface shadow-sm'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <Icon name="data_usage" size={14} />
              预览诊断
            </button>
            <button
              type="button"
              onClick={() => setCompactPanel('queue')}
              className={`flex h-9 items-center justify-center gap-1.5 rounded-sm text-xs font-medium transition-colors ${
                compactPanel === 'queue'
                  ? 'bg-surface-container-lowest text-on-surface shadow-sm'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <Icon name="hourglass_top" size={14} />
              转换队列
            </button>
          </div>
          <div className="mt-3 min-w-0">
            {compactPanel === 'diagnostics' ? (
              <PreviewDiagnosticsPanel compact embedded />
            ) : (
              <ConversionQueuePanel compact embedded />
            )}
          </div>
        </>
      ) : (
        <div className="mt-4 grid items-stretch gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="h-full min-w-0">
            <PreviewDiagnosticsPanel embedded />
          </div>
          <div className="h-full min-w-0 lg:border-l lg:border-outline-variant/10 lg:pl-5">
            <ConversionQueuePanel embedded />
          </div>
        </div>
      )}
    </section>
  );
}

function PreviewOperationsModal({ open, onClose, compact = false }: { open: boolean; onClose: () => void; compact?: boolean }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[90] flex items-end justify-center bg-surface-dim/70 px-3 py-4 backdrop-blur-sm sm:items-center sm:px-5"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            className={`relative w-full max-w-[100rem] overflow-y-auto rounded-lg border border-outline-variant/20 bg-surface-container-low shadow-xl ${
              compact ? 'h-[calc(100dvh-24px)] max-h-[calc(100dvh-24px)]' : 'max-h-[92dvh]'
            }`}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              onClick={onClose}
              className="absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-sm border border-outline-variant/20 bg-surface-container-lowest text-on-surface-variant shadow-sm hover:bg-surface-container-high hover:text-on-surface"
              aria-label="关闭预览运维工作台"
            >
              <Icon name="close" size={16} />
            </button>
            <div className={compact ? 'p-2' : 'p-3'}>
              <PreviewOperationsPanel compact={compact} />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function EditDialog({ open, model, categories, onClose, onSaved }: {
  open: boolean; model: ServerModelListItem | null; categories: CategoryItem[]; onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [thumbnailUploading, setThumbnailUploading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [drawingUploading, setDrawingUploading] = useState(false);
  const [drawingUrl, setDrawingUrl] = useState<string | null>(null);
  const [fileReplacing, setFileReplacing] = useState(false);

  useEffect(() => {
    if (model) {
      setName(model.name || '');
      setDescription('');
      setCategoryId(model.category_id || '');
      setThumbnailUrl(model.thumbnail_url);
      setDrawingUrl(model.drawing_url || null);
    }
  }, [model]);

  if (!open || !model) return null;

  const handleSave = async () => {
    if (!name.trim()) { toast('名称不能为空', 'error'); return; }
    setSaving(true);
    let ok = false;
    try {
      await modelApi.update(model.model_id, { name: name.trim(), description: description.trim() || undefined, categoryId: categoryId || null });
      toast('保存成功', 'success');
      ok = true;
    } catch { toast('保存失败', 'error'); } finally { setSaving(false); }
    if (ok) { onSaved(); onClose(); }
  };

  const handleThumbnailUpload = async (file: File) => {
    setThumbnailUploading(true);
    let ok = false;
    try {
      const result = await modelApi.uploadThumbnail(model.model_id, file);
      setThumbnailUrl(result.thumbnail_url);
      toast('预览图已更新', 'success');
      ok = true;
    } catch { toast('上传预览图失败', 'error'); } finally { setThumbnailUploading(false); }
    if (ok) onSaved();
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    let ok = false;
    try {
      const result = await modelApi.reconvert(model.model_id);
      setThumbnailUrl(result.thumbnail_url);
      toast('预览图已重新生成', 'success');
      ok = true;
    } catch { toast('重新生成失败', 'error'); } finally { setRegenerating(false); }
    if (ok) onSaved();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-surface-dim/70 backdrop-blur-sm sm:p-4" onClick={onClose}>
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} onClick={(e) => e.stopPropagation()} className="bg-surface-container-low rounded-t-2xl sm:rounded-lg shadow-xl border border-outline-variant/20 w-full max-w-md p-4 sm:p-6 max-h-[calc(100dvh-1rem)] sm:max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-headline text-lg font-semibold text-on-surface">编辑模型</h3>
              <button onClick={onClose} className="p-1 text-on-surface-variant hover:text-on-surface transition-colors"><Icon name="close" size={20} /></button>
            </div>
            <div className="space-y-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs uppercase tracking-wider text-on-surface-variant">预览图</label>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="w-16 h-16 rounded-sm bg-surface-container-highest shrink-0 overflow-hidden">
                    <ModelThumbnail src={thumbnailUrl} alt="" className="w-full h-full object-cover" />
                  </div>
                  <div className="flex flex-col gap-1.5 w-full sm:w-auto">
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" id="thumb-upload" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleThumbnailUpload(f); e.target.value = ''; }} />
                    <button onClick={() => document.getElementById('thumb-upload')?.click()} disabled={thumbnailUploading} className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-sm transition-colors border border-outline-variant/20 disabled:opacity-50"><Icon name="upload" size={14} />{thumbnailUploading ? '上传中...' : '上传图片'}</button>
                    <button onClick={handleRegenerate} disabled={regenerating} className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-sm transition-colors border border-outline-variant/20 disabled:opacity-50"><Icon name="refresh" size={14} />{regenerating ? '生成中...' : '从模型重新生成'}</button>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs uppercase tracking-wider text-on-surface-variant">名称</label>
                <input value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-surface-container-lowest text-on-surface border border-outline-variant/30 focus:border-primary px-3 py-2 text-sm rounded-sm outline-none" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs uppercase tracking-wider text-on-surface-variant">描述</label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="w-full bg-surface-container-lowest text-on-surface border border-outline-variant/30 focus:border-primary px-3 py-2 text-sm rounded-sm outline-none resize-none" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs uppercase tracking-wider text-on-surface-variant">分类</label>
                <CategorySelect categories={categories} value={categoryId} onChange={setCategoryId} placeholder="选择分类" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs uppercase tracking-wider text-on-surface-variant">产品图纸 (PDF)</label>
                <div className="flex items-center gap-3 min-w-0">
                  {drawingUrl ? (
                    <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
                      <Icon name="description" size={20} className="text-primary shrink-0" />
                      <span className="text-sm text-on-surface truncate flex-1">已上传</span>
                      <button type="button" onClick={() => void openModelDrawing(model.model_id).catch(() => toast('打开图纸失败', 'error'))} className="text-xs text-primary hover:underline">查看</button>
                      <button onClick={async () => { let ok = false; try { await modelApi.deleteDrawing(model.model_id); setDrawingUrl(null); toast('图纸已删除', 'success'); ok = true; } catch { toast('删除失败', 'error'); } if (ok) onSaved(); }} className="text-xs text-error hover:underline">删除</button>
                    </div>
                  ) : (
                    <>
                      <input type="file" accept="application/pdf" className="hidden" id="drawing-upload" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; if (f.type !== 'application/pdf') { toast('仅支持 PDF 格式', 'error'); return; } setDrawingUploading(true); let ok = false; try { const r = await modelApi.uploadDrawing(model.model_id, f); setDrawingUrl(r.drawing_url); toast('图纸上传成功', 'success'); ok = true; } catch { toast('上传失败', 'error'); } finally { setDrawingUploading(false); } if (ok) onSaved(); e.target.value = ''; }} />
                      <button onClick={() => document.getElementById('drawing-upload')?.click()} disabled={drawingUploading} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-sm transition-colors border border-outline-variant/20 disabled:opacity-50 w-full justify-center">
                        <Icon name="upload_file" size={14} />{drawingUploading ? '上传中...' : '上传 PDF 图纸'}
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="border-t border-outline-variant/20 pt-4 mt-1">
                <label className="text-xs uppercase tracking-wider text-on-surface-variant">替换模型文件</label>
                <p className="text-[10px] text-on-surface-variant/60 mt-1 mb-2">替换后将重新转换，预计耗时 30 秒</p>
                <input type="file" accept={MODEL_SOURCE_ACCEPT} className="hidden" id="replace-file-upload" onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const ext = f.name.split('.').pop()?.toLowerCase() || '';
                  if (!MODEL_SOURCE_FORMATS.includes(ext)) { toast(`仅支持 ${MODEL_SOURCE_LABEL} 格式`, 'error'); return; }
                  setFileReplacing(true);
                  let ok = false;
                  try {
                    const result = await modelApi.replaceFile(model.model_id, f);
                    toast(result.status === 'completed' ? '文件已更新' : '文件已上传，正在转换中...', 'success');
                    ok = true;
                  } catch { toast('替换文件失败', 'error'); }
                  finally { setFileReplacing(false); }
                  if (ok) { onSaved(); onClose(); }
                  e.target.value = '';
                }} />
                <button onClick={() => document.getElementById('replace-file-upload')?.click()} disabled={fileReplacing} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-sm transition-colors border border-outline-variant/20 disabled:opacity-50 w-full justify-center">
                  <Icon name="swap_horiz" size={14} />{fileReplacing ? '上传中...' : '选择新模型文件'}
                </button>
              </div>
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3 pt-2">
                <button onClick={onClose} className="px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface transition-colors">取消</button>
                <button onClick={handleSave} disabled={saving} className="px-6 py-2 bg-primary-container text-on-primary rounded-sm text-sm hover:bg-primary transition-colors disabled:opacity-50">{saving ? '保存中...' : '保存'}</button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function DesktopContent() {
  const { toast } = useToast();
  const { data: settings } = useSWR("publicSettings", () => getCachedPublicSettings());
  const { uploadPolicy } = getBusinessConfig(settings);
  const [search, setSearch] = useState('');
  const [editModel, setEditModel] = useState<ServerModelListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ServerModelListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [queueingModelId, setQueueingModelId] = useState<string | null>(null);
  const [previewOpsOpen, setPreviewOpsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'models' | 'suggestions' | 'groups'>('models');

  const {
    items: models,
    total: modelTotal,
    isLoadingInitial,
    isLoadingMore,
    hasMore,
    loadMore,
    mutate,
  } = useModelAdminList(search);
  const {
    visibleItems: visibleModels,
    hasMore: hasMoreVisibleModels,
    loadMore: loadMoreVisibleModels,
  } = useVisibleItems(models, MODEL_ADMIN_VISIBLE_BATCH_SIZE, search.trim());
  const { data: catData } = useSWR('/categories', () => categoriesApi.tree());
  const categories = catData?.items || [];

  // Merge suggestions
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupNameDraft, setGroupNameDraft] = useState('');
  const [groupAction, setGroupAction] = useState<string | null>(null);
  const {
    groups: suggestionGroups,
    total: activeSuggestionCount,
    isLoading: sugLoading,
    isLoadingMore: suggestionsLoadingMore,
    hasMore: suggestionsHasMore,
    loadMore: loadMoreSuggestions,
    mutate: sugMutate,
  } = useMergeSuggestionPages(activeTab === 'suggestions');
  const { data: suggestionCountData, mutate: suggestionCountMutate } = useSWR(
    '/model-groups/suggestions/count',
    () => modelApi.getMergeSuggestions({ page: 1, pageSize: 1 })
  );
  const { data: groupData, isLoading: groupsLoading, mutate: groupMutate } = useSWR(
    activeTab === 'groups' ? '/model-groups' : null,
    () => modelApi.listModelGroups()
  );
  const suggestionNames = suggestionGroups.map((group) => group.name);
  const selectedSuggestionCount = suggestionNames.filter((name) => selectedNames.has(name)).length;
  const allSuggestionsSelected = suggestionNames.length > 0 && selectedSuggestionCount === suggestionNames.length;
  const suggestionCount = activeTab === 'suggestions' ? activeSuggestionCount : suggestionCountData?.total ?? 0;
  const mergedGroupCount = groupData?.length;
  const headerButtonBase = "inline-flex h-9 w-[122px] items-center justify-center gap-1.5 rounded-sm px-3 text-sm font-medium transition-colors";
  const modelTabButton = (active: boolean) => `relative inline-flex h-9 shrink-0 items-center justify-center gap-1.5 px-4 text-sm font-medium leading-none transition-colors ${
    active
      ? "text-primary-container after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary-container"
      : "text-on-surface-variant hover:text-on-surface"
  }`;

  useEffect(() => {
    setSelectedNames(new Set());
  }, [activeTab]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try { await modelApi.delete(deleteTarget.model_id); toast('已删除', 'success'); mutate(); setDeleteTarget(null); } catch { toast('删除失败', 'error'); } finally { setDeleting(false); }
  };

  const handleQueueModelRebuild = async (model: ServerModelListItem) => {
    const ok = window.confirm(`将把「${model.name}」加入预览重建队列，重新生成 GLB 和缩略图。是否继续？`);
    if (!ok) return;
    setQueueingModelId(model.model_id);
    try {
      const result = await modelApi.rebuildPreviewDiagnostics({ status: 'all', modelIds: [model.model_id], limit: 1 });
      const first = result.items?.[0];
      if (result.queued > 0) {
        toast('已加入预览重建队列', 'success');
        mutate();
      } else {
        toast(first?.reason || '未能加入预览重建队列', 'error');
      }
    } catch {
      toast('加入预览重建队列失败', 'error');
    } finally {
      setQueueingModelId(null);
    }
  };

  const handleUpload = async (files: FileList) => {
    const formats = uploadPolicy.modelFormats.map((f) => f.toLowerCase());
    const accepted = Array.from(files).filter(f => { const ext = f.name.split('.').pop()?.toLowerCase() || ''; return formats.includes(ext) && f.size <= uploadPolicy.modelMaxSizeMb * 1024 * 1024; });
    if (accepted.length === 0) { toast(`请选择 ${uploadPolicy.modelFormats.map((f) => f.toUpperCase()).join('/')} 格式且小于 ${uploadPolicy.modelMaxSizeMb}MB 的文件`, 'error'); return; }
    setUploading(true);
    let ok = 0, fail = 0;
    // Upload with limited concurrency (3 at a time)
    const CONCURRENCY = 3;
    for (let i = 0; i < accepted.length; i += CONCURRENCY) {
      const batch = accepted.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(batch.map(f => modelApi.upload(f)));
      for (const r of results) { if (r.status === "fulfilled") ok++; else fail++; }
    }
    setUploading(false);
    toast(`上传完成: ${ok} 成功${fail > 0 ? `, ${fail} 失败` : ''}`, fail > 0 ? 'error' : 'success');
    mutate();
  };

  const handleTabChange = (tab: 'models' | 'suggestions' | 'groups') => {
    startTransition(() => setActiveTab(tab));
  };

  const toggleSelect = (name: string) => {
    setSelectedNames(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const toggleSelectPage = () => {
    setSelectedNames(prev => {
      const next = new Set(prev);
      if (allSuggestionsSelected) {
        suggestionNames.forEach((name) => next.delete(name));
      } else {
        suggestionNames.forEach((name) => next.add(name));
      }
      return next;
    });
  };

  const handleMerge = async () => {
    if (selectedSuggestionCount === 0) return;
    setMerging(true);
    try {
      const items = suggestionGroups.filter(s => selectedNames.has(s.name)).map(s => ({
        name: s.name,
        modelIds: s.models.map(m => m.id),
      }));
      const result = await modelApi.batchMerge(items);
      toast(`已合并 ${result.merged} 组`, 'success');
      setSelectedNames(new Set());
      sugMutate();
      suggestionCountMutate();
      groupMutate();
    } catch { toast('合并失败', 'error'); }
    finally { setMerging(false); }
  };

  const beginEditGroup = (group: ModelGroupItem) => {
    setEditingGroupId(group.id);
    setGroupNameDraft(group.name);
  };

  const handleSaveGroup = async (group: ModelGroupItem) => {
    const name = groupNameDraft.trim();
    if (!name) {
      toast('分组名称不能为空', 'error');
      return;
    }
    setGroupAction(`rename:${group.id}`);
    try {
      await modelApi.updateModelGroup(group.id, { name });
      toast('分组已更新', 'success');
      setEditingGroupId(null);
      groupMutate();
      mutate();
    } catch {
      toast('更新分组失败', 'error');
    } finally {
      setGroupAction(null);
    }
  };

  const handleSetPrimary = async (group: ModelGroupItem, modelId: string) => {
    setGroupAction(`primary:${group.id}:${modelId}`);
    try {
      await modelApi.updateModelGroup(group.id, { primaryId: modelId });
      toast('已设置主版本', 'success');
      groupMutate();
      mutate();
    } catch {
      toast('设置主版本失败', 'error');
    } finally {
      setGroupAction(null);
    }
  };

  const handleRemoveFromGroup = async (group: ModelGroupItem, modelId: string) => {
    const ok = window.confirm('确定将该模型移出当前合并分组吗？模型不会被删除。');
    if (!ok) return;
    setGroupAction(`remove:${group.id}:${modelId}`);
    try {
      await modelApi.removeModelFromGroup(group.id, modelId);
      toast('已移出分组', 'success');
      groupMutate();
      sugMutate();
      suggestionCountMutate();
      mutate();
    } catch {
      toast('移出分组失败', 'error');
    } finally {
      setGroupAction(null);
    }
  };

  const handleDeleteGroup = async (group: ModelGroupItem) => {
    const ok = window.confirm(`确定解散「${group.name}」吗？模型文件不会删除，只会取消合并关系。`);
    if (!ok) return;
    setGroupAction(`delete:${group.id}`);
    try {
      await modelApi.deleteModelGroup(group.id);
      toast('分组已解散', 'success');
      groupMutate();
      sugMutate();
      suggestionCountMutate();
      mutate();
    } catch {
      toast('解散分组失败', 'error');
    } finally {
      setGroupAction(null);
    }
  };

  return (
    <>
      <input type="file" multiple accept={uploadPolicy.modelFormats.map((f) => `.${f}`).join(",")} className="hidden" id="admin-file-upload" onChange={(e) => { if (e.target.files?.length) handleUpload(e.target.files); e.target.value = ''; }} />
      <AdminManagementPage
        title="模型管理"
        description="统一维护模型文件、分类归属、预览重建和同名模型合并关系。"
        toolbar={(
          <div className="flex min-h-11 flex-wrap items-center justify-between gap-3">
            <div className="flex h-9 min-w-0 items-center gap-1 overflow-x-auto scrollbar-none">
              <button onClick={() => handleTabChange('models')} className={modelTabButton(activeTab === 'models')}>
                <span className="whitespace-nowrap tabular-nums">全部模型 ({modelTotal})</span>
              </button>
              <button onClick={() => handleTabChange('suggestions')} className={modelTabButton(activeTab === 'suggestions')}>
                <span className="whitespace-nowrap tabular-nums">合并建议 ({suggestionCount})</span>
              </button>
              <button onClick={() => handleTabChange('groups')} className={modelTabButton(activeTab === 'groups')}>
                <span className="whitespace-nowrap tabular-nums">已合并{typeof mergedGroupCount === 'number' ? ` (${mergedGroupCount})` : ''}</span>
              </button>
            </div>
            <div className="ml-auto flex min-h-9 flex-wrap items-center justify-end gap-2">
              <button
                onClick={() => setPreviewOpsOpen(true)}
                className={`${headerButtonBase} border border-outline-variant/25 bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface`}
              >
                <Icon name="view_in_ar" size={18} />
                预览运维
              </button>
              <button onClick={() => document.getElementById('admin-file-upload')?.click()} disabled={uploading} className={`${headerButtonBase} bg-primary-container text-on-primary hover:opacity-90 active:scale-95 disabled:opacity-50`}>
                <Icon name="cloud_upload" size={18} />{uploading ? '上传中...' : '上传模型'}
              </button>
              <div className="flex h-9 items-center rounded-sm border border-outline-variant/30 bg-surface-container-lowest px-3">
                <Icon name="search" size={16} className="text-on-surface-variant mr-2" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索模型..." className="w-48 border-none bg-transparent text-sm text-on-surface outline-none placeholder:text-on-surface-variant/50" />
              </div>
            </div>
          </div>
        )}
      >

      <div className="admin-tab-panel min-h-0">
      {activeTab === 'suggestions' ? (
        sugLoading ? <SkeletonList rows={5} /> : (
          <div className={`${MODEL_ADMIN_PANEL_CLASS} p-3`}>
            {suggestionGroups.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-surface-container-low rounded-sm border border-outline-variant/10">
                <span className="text-sm text-on-surface">
                  已加载 <strong className="text-primary">{suggestionGroups.length}</strong> / 共 <strong className="text-primary">{suggestionCount}</strong> 组建议
                  {selectedSuggestionCount > 0 && <>，已选择 <strong className="text-primary">{selectedSuggestionCount}</strong> 组</>}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={toggleSelectPage}
                    className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-on-surface-variant bg-surface-container-high rounded-sm hover:text-on-surface hover:bg-surface-container-highest transition-colors"
                  >
                    <Icon name="checklist" size={16} />
                    {allSuggestionsSelected ? '取消全选' : '全选已加载'}
                  </button>
                  {selectedSuggestionCount > 0 && (
                    <button
                      onClick={() => setSelectedNames(new Set())}
                      className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-on-surface-variant bg-surface-container-high rounded-sm hover:text-on-surface hover:bg-surface-container-highest transition-colors"
                    >
                      <Icon name="close" size={16} />
                      清空
                    </button>
                  )}
                  <button onClick={handleMerge} disabled={merging || selectedSuggestionCount === 0} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-on-primary bg-primary-container rounded-sm hover:opacity-90 disabled:opacity-50">
                    <Icon name="merge" size={16} />{merging ? '合并中...' : `合并选中 (${selectedSuggestionCount} 组)`}
                  </button>
                </div>
              </div>
            )}
            <div className="space-y-3">
              {suggestionGroups.map((group) => (
                <div key={group.name} className="overflow-hidden rounded-sm border border-outline-variant/10 bg-surface-container-low">
                <div className="flex items-center gap-3 px-4 py-3">
                  <input type="checkbox" checked={selectedNames.has(group.name)} onChange={() => toggleSelect(group.name)} className="w-4 h-4 accent-primary-container rounded" />
                  <span className="text-sm font-medium text-on-surface flex-1">{group.name}</span>
                  <span className="text-[10px] bg-surface-container-highest px-2 py-0.5 rounded-sm text-on-surface-variant font-mono">{group.count} 个同名</span>
                </div>
                <div className="px-4 pb-3 flex gap-2 overflow-x-auto">
                  {group.models.map(m => (
                    <div key={m.id} className="shrink-0 w-16">
                      <div className="w-16 h-16 rounded-sm bg-surface-container-highest overflow-hidden border border-outline-variant/10">
                        <ModelThumbnail src={m.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                      </div>
                      <p className="text-[9px] text-on-surface-variant mt-1 truncate" title={m.originalName}>{m.originalName.replace(/\.[^.]+$/, '')}</p>
                    </div>
                  ))}
                </div>
              </div>
              ))}
            </div>
            {suggestionGroups.length > 0 && (
              <InfiniteLoadTrigger hasMore={suggestionsHasMore} isLoading={suggestionsLoadingMore} onLoadMore={loadMoreSuggestions} />
            )}
            {suggestionGroups.length === 0 && (
              <div className="flex min-h-[320px] flex-col items-center justify-center text-center">
                <Icon name="merge" size={38} className="mb-3 text-on-surface-variant/25" />
                <p className="text-sm font-medium text-on-surface">没有需要合并的同名模型</p>
                <p className="mt-1 text-xs text-on-surface-variant">这里会保持和全部模型一致的内容区块，后续有建议时直接显示列表。</p>
              </div>
            )}
          </div>
        )
      ) : activeTab === 'groups' ? (
        groupsLoading ? <SkeletonList rows={5} /> : (
          <div className={`${MODEL_ADMIN_PANEL_CLASS} p-3`}>
            <div className="space-y-3">
            {groupData?.map((group) => {
              const editing = editingGroupId === group.id;
              const primaryId = group.primary?.id;
              return (
                <div key={group.id} className="bg-surface-container-low rounded-sm border border-outline-variant/10 overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-outline-variant/10">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <Icon name="folder_special" size={18} className="shrink-0 text-primary-container" />
                      {editing ? (
                        <input
                          value={groupNameDraft}
                          onChange={(e) => setGroupNameDraft(e.target.value)}
                          className="min-w-0 flex-1 rounded-sm border border-outline-variant/25 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                          autoFocus
                        />
                      ) : (
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-on-surface">{group.name}</p>
                          <p className="text-[11px] text-on-surface-variant">{group.model_count} 个版本 · 主版本：{group.primary?.name || '未设置'}</p>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {editing ? (
                        <>
                          <button onClick={() => handleSaveGroup(group)} disabled={groupAction === `rename:${group.id}`} className="flex items-center gap-1.5 rounded-sm bg-primary-container px-3 py-2 text-xs font-medium text-on-primary disabled:opacity-50">
                            <Icon name="save" size={14} />保存
                          </button>
                          <button onClick={() => setEditingGroupId(null)} className="rounded-sm border border-outline-variant/20 px-3 py-2 text-xs text-on-surface-variant hover:text-on-surface">
                            取消
                          </button>
                        </>
                      ) : (
                        <button onClick={() => beginEditGroup(group)} className="flex items-center gap-1.5 rounded-sm border border-outline-variant/20 px-3 py-2 text-xs text-on-surface-variant hover:text-on-surface">
                          <Icon name="edit" size={14} />重命名
                        </button>
                      )}
                      <button onClick={() => handleDeleteGroup(group)} disabled={groupAction === `delete:${group.id}`} className="flex items-center gap-1.5 rounded-sm border border-error/20 px-3 py-2 text-xs text-error hover:bg-error/10 disabled:opacity-50">
                        <Icon name="close" size={14} />解散分组
                      </button>
                    </div>
                  </div>
                  <div className="divide-y divide-outline-variant/10">
                    {group.models.map((model) => {
                      const isPrimary = model.id === primaryId;
                      return (
                        <div key={model.id} className="flex items-center gap-3 px-4 py-3">
                          <div className="h-12 w-12 shrink-0 overflow-hidden rounded-sm bg-surface-container-highest">
                            <ModelThumbnail src={model.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-2">
                              <p className="truncate text-sm font-medium text-on-surface">{model.originalName || model.name}</p>
                              {isPrimary && <span className="shrink-0 rounded-sm bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">主版本</span>}
                            </div>
                            <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-on-surface-variant">
                              <span>{formatSize(model.originalSize)}</span>
                              <span>原始时间：{formatModelDateTime(model.fileModifiedAt)}</span>
                              <span>上传时间：{formatModelDateTime(model.createdAt)}</span>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <Link to={`/model/${model.id}`} target="_blank" className="rounded-sm border border-outline-variant/20 px-2.5 py-1.5 text-xs text-on-surface-variant hover:text-primary">
                              查看
                            </Link>
                            {!isPrimary && (
                              <button onClick={() => handleSetPrimary(group, model.id)} disabled={groupAction === `primary:${group.id}:${model.id}`} className="rounded-sm border border-outline-variant/20 px-2.5 py-1.5 text-xs text-on-surface-variant hover:text-primary disabled:opacity-50">
                                设为主版本
                              </button>
                            )}
                            <button
                              onClick={() => handleRemoveFromGroup(group, model.id)}
                              disabled={group.model_count <= 2 || groupAction === `remove:${group.id}:${model.id}`}
                              title={group.model_count <= 2 ? '只有 2 个版本时请使用解散分组' : '移出当前分组'}
                              className="rounded-sm border border-outline-variant/20 px-2.5 py-1.5 text-xs text-on-surface-variant hover:text-error disabled:opacity-40"
                            >
                              移出
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            </div>
            {groupData?.length === 0 && (
              <div className="flex min-h-[320px] flex-col items-center justify-center text-center">
                <Icon name="folder_special" size={38} className="mb-3 text-on-surface-variant/25" />
                <p className="text-sm font-medium text-on-surface">还没有已合并的模型分组</p>
                <p className="mt-1 text-xs text-on-surface-variant">合并完成后会在这里统一维护主版本和分组关系。</p>
              </div>
            )}
          </div>
        )
      ) : (
      isLoadingInitial ? (
        <SkeletonList rows={5} />
      ) : (
        <>
          <div className={MODEL_ADMIN_PANEL_CLASS}>
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-outline-variant/20 bg-surface-container-low">
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-on-surface-variant font-medium">模型</th>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-on-surface-variant font-medium">分类</th>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-on-surface-variant font-medium">格式</th>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-on-surface-variant font-medium">大小</th>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-on-surface-variant font-medium">图纸</th>
                  <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-on-surface-variant font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {visibleModels.map((m) => (
                  <tr key={m.model_id} className="border-b border-outline-variant/10 hover:bg-surface-container-high/50 transition-colors">
                    <td className="px-4 py-3">
                      <Link to={`/model/${m.model_id}`} target="_blank" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
                        <div className="w-10 h-10 rounded-sm bg-surface-container-highest shrink-0 overflow-hidden">
                          <ModelThumbnail src={m.thumbnail_url} alt="" className="w-full h-full object-cover" />
                        </div>
                        <div className="min-w-0">
                          <span className="text-on-surface font-medium truncate max-w-[300px] block">{m.name}</span>
                          {m.group && <span className="text-[10px] text-primary font-medium">{m.group.name} {m.group.is_primary ? '· 主版本' : ''} (共{m.group.variant_count}个)</span>}
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-on-surface-variant">{m.category || '—'}</td>
                    <td className="px-4 py-3"><span className="text-xs font-mono bg-surface-container-highest px-1.5 py-0.5 rounded-sm">{m.format?.toUpperCase()}</span></td>
                    <td className="px-4 py-3 text-on-surface-variant font-mono">{formatSize(m.original_size)}</td>
                    <td className="px-4 py-3">{m.drawing_url ? <span className="text-[10px] bg-primary/15 text-primary px-1.5 py-0.5 rounded-sm font-medium">PDF</span> : <span className="text-[10px] text-on-surface-variant/30">—</span>}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link to={`/model/${m.model_id}`} target="_blank" className="flex items-center gap-1 px-2.5 py-1 text-xs text-on-surface-variant hover:text-primary hover:bg-primary/10 rounded-sm transition-colors border border-outline-variant/20"><Icon name="open_in_new" size={14} />查看</Link>
                        <button onClick={() => handleQueueModelRebuild(m)} disabled={queueingModelId === m.model_id} aria-label={`重建预览 ${m.name}`} title="重建预览" className="flex items-center gap-1 px-2.5 py-1 text-xs text-on-surface-variant hover:text-primary hover:bg-primary/10 rounded-sm transition-colors border border-outline-variant/20 disabled:opacity-50"><Icon name="autorenew" size={14} className={queueingModelId === m.model_id ? 'animate-spin' : ''} />重建</button>
                        <button onClick={() => setEditModel(m)} className="flex items-center gap-1 px-2.5 py-1 text-xs text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-sm transition-colors border border-outline-variant/20"><Icon name="settings" size={14} />编辑</button>
                        <button onClick={() => setDeleteTarget(m)} className="flex items-center gap-1 px-2.5 py-1 text-xs text-on-surface-variant hover:text-error hover:bg-error/10 rounded-sm transition-colors border border-outline-variant/20"><Icon name="close" size={14} />删除</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {models.length > 0 && (
                  <tr>
                    <td colSpan={6}>
                      <InfiniteLoadTrigger
                        hasMore={hasMoreVisibleModels || hasMore}
                        isLoading={isLoadingMore}
                        onLoadMore={hasMoreVisibleModels ? loadMoreVisibleModels : loadMore}
                      />
                    </td>
                  </tr>
                )}
                {models.length === 0 && (<tr><td colSpan={6} className="px-4 py-12 text-center text-on-surface-variant">没有找到模型</td></tr>)}
              </tbody>
            </table>
          </div>
        </>
      )
      )}
      </div>

      <PreviewOperationsModal open={previewOpsOpen} onClose={() => setPreviewOpsOpen(false)} />
      <EditDialog open={!!editModel} model={editModel} categories={categories || []} onClose={() => setEditModel(null)} onSaved={() => mutate()} />
      <AnimatePresence>
        {deleteTarget && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-surface-dim/70 backdrop-blur-sm" onClick={() => setDeleteTarget(null)}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} onClick={(e) => e.stopPropagation()} className="bg-surface-container-low rounded-lg shadow-xl border border-outline-variant/20 w-full max-w-sm mx-4 p-6">
              <h3 className="font-headline text-lg font-semibold text-on-surface mb-2">确认删除</h3>
              <p className="text-sm text-on-surface-variant mb-6">确定要删除「{deleteTarget.name}」吗？此操作不可撤销。</p>
              <div className="flex justify-end gap-3">
                <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface transition-colors">取消</button>
                <button onClick={handleDelete} disabled={deleting} className="px-4 py-2 bg-error text-white rounded-sm text-sm hover:bg-error/90 transition-colors disabled:opacity-50">{deleting ? '删除中...' : '删除'}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      </AdminManagementPage>
    </>
  );
}

function MobileContent() {
  const { toast } = useToast();
  const { data: settings } = useSWR("publicSettings", () => getCachedPublicSettings());
  const { uploadPolicy } = getBusinessConfig(settings);
  const [search, setSearch] = useState('');
  const [editModel, setEditModel] = useState<ServerModelListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ServerModelListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [queueingModelId, setQueueingModelId] = useState<string | null>(null);
  const [previewOpsOpen, setPreviewOpsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'models' | 'suggestions' | 'groups'>('models');

  const {
    items: models,
    total: modelTotal,
    isLoadingInitial,
    isLoadingMore,
    hasMore,
    loadMore,
    mutate,
  } = useModelAdminList(search);
  const {
    visibleItems: visibleModels,
    hasMore: hasMoreVisibleModels,
    loadMore: loadMoreVisibleModels,
  } = useVisibleItems(models, MOBILE_MODEL_VISIBLE_BATCH_SIZE, search.trim());
  const { data: catDataM } = useSWR('/categories-m', () => categoriesApi.tree());
  const categories = catDataM?.items || [];
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupNameDraft, setGroupNameDraft] = useState('');
  const [groupAction, setGroupAction] = useState<string | null>(null);
  const {
    groups: suggestionGroups,
    total: activeSuggestionCount,
    isLoading: sugLoading,
    isLoadingMore: suggestionsLoadingMore,
    hasMore: suggestionsHasMore,
    loadMore: loadMoreSuggestions,
    mutate: sugMutate,
  } = useMergeSuggestionPages(activeTab === 'suggestions');
  const { data: suggestionCountData, mutate: suggestionCountMutate } = useSWR(
    '/model-groups/suggestions/count-mobile',
    () => modelApi.getMergeSuggestions({ page: 1, pageSize: 1 })
  );
  const { data: groupData, isLoading: groupsLoading, mutate: groupMutate } = useSWR(
    activeTab === 'groups' ? '/model-groups-mobile' : null,
    () => modelApi.listModelGroups()
  );
  const suggestionNames = suggestionGroups.map((group) => group.name);
  const selectedSuggestionCount = suggestionNames.filter((name) => selectedNames.has(name)).length;
  const allSuggestionsSelected = suggestionNames.length > 0 && selectedSuggestionCount === suggestionNames.length;
  const suggestionCount = activeTab === 'suggestions' ? activeSuggestionCount : suggestionCountData?.total ?? 0;
  const mergedGroupCount = groupData?.length;
  const mobileTabButton = (active: boolean) => `relative inline-flex h-10 flex-1 items-center justify-center whitespace-nowrap px-2 text-xs font-bold transition-colors focus:outline-none ${
    active
      ? 'text-primary-container after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary-container'
      : 'text-on-surface-variant'
  }`;

  useEffect(() => {
    setSelectedNames(new Set());
  }, [activeTab]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try { await modelApi.delete(deleteTarget.model_id); toast('已删除', 'success'); mutate(); setDeleteTarget(null); } catch { toast('删除失败', 'error'); } finally { setDeleting(false); }
  };

  const handleQueueModelRebuild = async (model: ServerModelListItem) => {
    const ok = window.confirm(`将把「${model.name}」加入预览重建队列，重新生成 GLB 和缩略图。是否继续？`);
    if (!ok) return;
    setQueueingModelId(model.model_id);
    try {
      const result = await modelApi.rebuildPreviewDiagnostics({ status: 'all', modelIds: [model.model_id], limit: 1 });
      const first = result.items?.[0];
      if (result.queued > 0) {
        toast('已加入预览重建队列', 'success');
        mutate();
      } else {
        toast(first?.reason || '未能加入预览重建队列', 'error');
      }
    } catch {
      toast('加入预览重建队列失败', 'error');
    } finally {
      setQueueingModelId(null);
    }
  };

  const handleUpload = async (files: FileList) => {
    const formats = uploadPolicy.modelFormats.map((f) => f.toLowerCase());
    const accepted = Array.from(files).filter(f => { const ext = f.name.split('.').pop()?.toLowerCase() || ''; return formats.includes(ext) && f.size <= uploadPolicy.modelMaxSizeMb * 1024 * 1024; });
    if (accepted.length === 0) { toast(`请选择 ${uploadPolicy.modelFormats.map((f) => f.toUpperCase()).join('/')} 格式且小于 ${uploadPolicy.modelMaxSizeMb}MB 的文件`, 'error'); return; }
    setUploading(true);
    let ok = 0, fail = 0;
    // Upload with limited concurrency (3 at a time)
    const CONCURRENCY = 3;
    for (let i = 0; i < accepted.length; i += CONCURRENCY) {
      const batch = accepted.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(batch.map(f => modelApi.upload(f)));
      for (const r of results) { if (r.status === "fulfilled") ok++; else fail++; }
    }
    setUploading(false);
    toast(`上传完成: ${ok} 成功${fail > 0 ? `, ${fail} 失败` : ''}`, fail > 0 ? 'error' : 'success');
    mutate();
  };

  const toggleSelect = (name: string) => {
    setSelectedNames(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const toggleSelectPage = () => {
    setSelectedNames(prev => {
      const next = new Set(prev);
      if (allSuggestionsSelected) {
        suggestionNames.forEach((name) => next.delete(name));
      } else {
        suggestionNames.forEach((name) => next.add(name));
      }
      return next;
    });
  };

  const handleMerge = async () => {
    if (selectedSuggestionCount === 0) return;
    setMerging(true);
    try {
      const items = suggestionGroups.filter(s => selectedNames.has(s.name)).map(s => ({
        name: s.name,
        modelIds: s.models.map(m => m.id),
      }));
      const result = await modelApi.batchMerge(items);
      toast(`已合并 ${result.merged} 组`, 'success');
      setSelectedNames(new Set());
      sugMutate();
      suggestionCountMutate();
      groupMutate();
    } catch {
      toast('合并失败', 'error');
    } finally {
      setMerging(false);
    }
  };

  const handleMergeSingleSuggestion = async (group: { name: string; models: { id: string }[] }) => {
    if (group.models.length < 2) return;
    setMerging(true);
    try {
      const result = await modelApi.batchMerge([{ name: group.name, modelIds: group.models.map((m) => m.id) }]);
      toast(`已合并 ${result.merged} 组`, 'success');
      setSelectedNames((prev) => {
        const next = new Set(prev);
        next.delete(group.name);
        return next;
      });
      sugMutate();
      suggestionCountMutate();
      groupMutate();
      mutate();
    } catch {
      toast('合并失败', 'error');
    } finally {
      setMerging(false);
    }
  };

  const beginEditGroup = (group: ModelGroupItem) => {
    setEditingGroupId(group.id);
    setGroupNameDraft(group.name);
  };

  const handleSaveGroup = async (group: ModelGroupItem) => {
    const name = groupNameDraft.trim();
    if (!name) {
      toast('分组名称不能为空', 'error');
      return;
    }
    setGroupAction(`rename:${group.id}`);
    try {
      await modelApi.updateModelGroup(group.id, { name });
      toast('分组已更新', 'success');
      setEditingGroupId(null);
      groupMutate();
      mutate();
    } catch {
      toast('更新分组失败', 'error');
    } finally {
      setGroupAction(null);
    }
  };

  const handleSetPrimary = async (group: ModelGroupItem, modelId: string) => {
    setGroupAction(`primary:${group.id}:${modelId}`);
    try {
      await modelApi.updateModelGroup(group.id, { primaryId: modelId });
      toast('已设置主版本', 'success');
      groupMutate();
      mutate();
    } catch {
      toast('设置主版本失败', 'error');
    } finally {
      setGroupAction(null);
    }
  };

  const handleRemoveFromGroup = async (group: ModelGroupItem, modelId: string) => {
    const ok = window.confirm('确定将该模型移出当前合并分组吗？模型不会被删除。');
    if (!ok) return;
    setGroupAction(`remove:${group.id}:${modelId}`);
    try {
      await modelApi.removeModelFromGroup(group.id, modelId);
      toast('已移出分组', 'success');
      groupMutate();
      sugMutate();
      suggestionCountMutate();
      mutate();
    } catch {
      toast('移出分组失败', 'error');
    } finally {
      setGroupAction(null);
    }
  };

  const handleDeleteGroup = async (group: ModelGroupItem) => {
    const ok = window.confirm(`确定解散「${group.name}」吗？模型文件不会删除，只会取消合并关系。`);
    if (!ok) return;
    setGroupAction(`delete:${group.id}`);
    try {
      await modelApi.deleteModelGroup(group.id);
      toast('分组已解散', 'success');
      groupMutate();
      sugMutate();
      suggestionCountMutate();
      mutate();
    } catch {
      toast('解散分组失败', 'error');
    } finally {
      setGroupAction(null);
    }
  };

  return (
    <>
      <input type="file" multiple accept={uploadPolicy.modelFormats.map((f) => `.${f}`).join(",")} className="hidden" id="mobile-admin-upload" onChange={(e) => { if (e.target.files?.length) handleUpload(e.target.files); e.target.value = ''; }} />
      <AdminManagementPage
        title="模型管理"
        meta={`${modelTotal} 个`}
        description="维护模型库文件、合并建议和预览运维"
        contentClassName="gap-3"
        actions={(
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPreviewOpsOpen(true)}
              className="flex items-center gap-1 rounded-sm border border-outline-variant/25 bg-surface-container-high px-2.5 py-1.5 text-xs font-medium text-on-surface-variant active:scale-95"
              aria-label="打开预览运维工作台"
            >
              <Icon name="view_in_ar" size={14} />
              运维
            </button>
            <button onClick={() => document.getElementById('mobile-admin-upload')?.click()} disabled={uploading} className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-on-primary bg-primary-container rounded-sm active:scale-95 disabled:opacity-50">
              <Icon name="cloud_upload" size={14} />{uploading ? '上传中...' : '上传'}
            </button>
          </div>
        )}
      >
        <div className="flex items-center bg-surface-container-high rounded-sm px-3 py-2 border border-outline-variant/30">
          <Icon name="search" size={16} className="text-on-surface-variant mr-2" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索模型..." className="bg-transparent border-none outline-none text-sm text-on-surface placeholder:text-on-surface-variant/50 w-full" />
        </div>
        <div className="flex items-center rounded-lg border border-outline-variant/12 bg-surface-container-low px-1">
          <button onClick={() => startTransition(() => setActiveTab('models'))} className={mobileTabButton(activeTab === 'models')}>
            全部模型 ({modelTotal})
          </button>
          <button onClick={() => startTransition(() => setActiveTab('suggestions'))} className={mobileTabButton(activeTab === 'suggestions')}>
            合并建议 ({suggestionCount})
          </button>
          <button onClick={() => startTransition(() => setActiveTab('groups'))} className={mobileTabButton(activeTab === 'groups')}>
            已合并{typeof mergedGroupCount === 'number' ? ` (${mergedGroupCount})` : ''}
          </button>
        </div>

        {activeTab === 'suggestions' ? (
          sugLoading ? (
            <SkeletonList rows={5} />
          ) : (
            <div className="admin-tab-panel space-y-3">
              {suggestionGroups.length > 0 && (
                <div className="flex items-center justify-between gap-2 rounded-lg bg-surface-container-high px-3 py-2">
                  <div className="min-w-0 text-xs text-on-surface-variant">
                    已加载 <span className="font-bold text-primary-container">{suggestionGroups.length}</span> / {suggestionCount}
                    {selectedSuggestionCount > 0 && <span>，已选 {selectedSuggestionCount}</span>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button onClick={toggleSelectPage} className="rounded-sm border border-outline-variant/20 px-2.5 py-1.5 text-xs text-on-surface-variant">
                      {allSuggestionsSelected ? '取消' : '全选'}
                    </button>
                    <button onClick={handleMerge} disabled={merging || selectedSuggestionCount === 0} className="rounded-sm bg-primary-container px-3 py-1.5 text-xs font-bold text-on-primary disabled:opacity-40">
                      {merging ? '合并中' : '合并'}
                    </button>
                  </div>
                </div>
              )}
              {suggestionGroups.map((group) => (
                <div key={group.name} className="rounded-lg bg-surface-container-high p-3">
                  <div className="flex items-center gap-3">
                    <input type="checkbox" checked={selectedNames.has(group.name)} onChange={() => toggleSelect(group.name)} className="h-4 w-4 accent-primary-container" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-on-surface">{group.name}</p>
                      <p className="text-[11px] text-on-surface-variant">{group.count} 个同名模型</p>
                    </div>
                    <button
                      onClick={() => toggleSelect(group.name)}
                      className="rounded-sm border border-outline-variant/20 px-2.5 py-1.5 text-xs text-on-surface-variant"
                    >
                      {selectedNames.has(group.name) ? '取消' : '选中'}
                    </button>
                  </div>
                  <div className="mt-3 flex gap-2 overflow-x-auto scrollbar-hidden">
                    {group.models.map((m) => (
                      <div key={m.id} className="w-14 shrink-0">
                        <div className="h-14 w-14 overflow-hidden rounded bg-surface-container-highest">
                          <ModelThumbnail src={m.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                        </div>
                        <p className="mt-1 truncate text-[9px] text-on-surface-variant">{m.originalName.replace(/\.[^.]+$/, '')}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-outline-variant/10 pt-3">
                    <span className="text-[11px] text-on-surface-variant">将这 {group.models.length} 个同名模型合并为一组</span>
                    <button
                      onClick={() => handleMergeSingleSuggestion(group)}
                      disabled={merging || group.models.length < 2}
                      className="shrink-0 rounded-sm bg-primary-container px-3 py-1.5 text-xs font-bold text-on-primary disabled:opacity-40"
                    >
                      合并本组
                    </button>
                  </div>
                </div>
              ))}
              {suggestionGroups.length > 0 && (
                <InfiniteLoadTrigger hasMore={suggestionsHasMore} isLoading={suggestionsLoadingMore} onLoadMore={loadMoreSuggestions} />
              )}
              {suggestionGroups.length === 0 && (
                <p className="rounded-lg bg-surface-container-high px-4 py-12 text-center text-sm text-on-surface-variant">没有需要合并的同名模型</p>
              )}
            </div>
          )
        ) : activeTab === 'groups' ? (
          groupsLoading ? (
            <SkeletonList rows={5} />
          ) : (
            <div className="admin-tab-panel space-y-3">
              {groupData?.map((group) => {
                const editing = editingGroupId === group.id;
                const primaryId = group.primary?.id;
                return (
                  <div key={group.id} className="rounded-lg bg-surface-container-high p-3">
                    <div className="flex items-start gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded bg-surface-container-highest text-primary-container">
                        <Icon name="folder_special" size={18} />
                      </span>
                      <div className="min-w-0 flex-1">
                        {editing ? (
                          <input
                            value={groupNameDraft}
                            onChange={(e) => setGroupNameDraft(e.target.value)}
                            className="w-full rounded-sm border border-outline-variant/25 bg-surface-container-lowest px-3 py-2 text-sm font-semibold text-on-surface outline-none focus:border-primary"
                            autoFocus
                          />
                        ) : (
                          <>
                            <p className="truncate text-sm font-bold text-on-surface">{group.name}</p>
                            <p className="mt-0.5 text-[11px] text-on-surface-variant">{group.model_count} 个版本 · 主版本：{group.primary?.name || '未设置'}</p>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {editing ? (
                        <>
                          <button
                            onClick={() => handleSaveGroup(group)}
                            disabled={groupAction === `rename:${group.id}`}
                            className="rounded-sm bg-primary-container px-3 py-1.5 text-xs font-bold text-on-primary disabled:opacity-40"
                          >
                            保存
                          </button>
                          <button onClick={() => setEditingGroupId(null)} className="rounded-sm border border-outline-variant/20 px-3 py-1.5 text-xs text-on-surface-variant">
                            取消
                          </button>
                        </>
                      ) : (
                        <button onClick={() => beginEditGroup(group)} className="rounded-sm border border-outline-variant/20 px-3 py-1.5 text-xs text-on-surface-variant">
                          重命名
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteGroup(group)}
                        disabled={groupAction === `delete:${group.id}`}
                        className="rounded-sm border border-error/20 px-3 py-1.5 text-xs text-error disabled:opacity-40"
                      >
                        解散分组
                      </button>
                    </div>
                    <div className="mt-3 space-y-2">
                      {group.models.map((model) => {
                        const isPrimary = model.id === primaryId;
                        return (
                          <div key={model.id} className="rounded-lg bg-surface-container-low p-2.5">
                            <div className="flex items-start gap-2.5">
                              <Link to={`/model/${model.id}`} target="_blank" className="h-14 w-14 shrink-0 overflow-hidden rounded bg-surface-container-highest">
                                <ModelThumbnail src={model.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                              </Link>
                              <div className="min-w-0 flex-1">
                                <div className="flex min-w-0 items-center gap-1.5">
                                  <p className="truncate text-xs font-semibold text-on-surface">{model.originalName || model.name}</p>
                                  {isPrimary && <span className="shrink-0 rounded-sm bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">主版本</span>}
                                </div>
                                <p className="mt-0.5 text-[10px] text-on-surface-variant">{formatSize(model.originalSize)} · {formatModelDateTime(model.createdAt)}</p>
                              </div>
                            </div>
                            <div className="mt-2 flex flex-wrap justify-end gap-2">
                              <Link to={`/model/${model.id}`} target="_blank" className="rounded-sm border border-outline-variant/20 px-2.5 py-1.5 text-xs text-on-surface-variant">
                                查看
                              </Link>
                              {!isPrimary && (
                                <button
                                  onClick={() => handleSetPrimary(group, model.id)}
                                  disabled={groupAction === `primary:${group.id}:${model.id}`}
                                  className="rounded-sm border border-outline-variant/20 px-2.5 py-1.5 text-xs text-on-surface-variant disabled:opacity-40"
                                >
                                  设为主版本
                                </button>
                              )}
                              <button
                                onClick={() => handleRemoveFromGroup(group, model.id)}
                                disabled={group.model_count <= 2 || groupAction === `remove:${group.id}:${model.id}`}
                                title={group.model_count <= 2 ? '只有 2 个版本时请使用解散分组' : '移出当前分组'}
                                className="rounded-sm border border-outline-variant/20 px-2.5 py-1.5 text-xs text-on-surface-variant disabled:opacity-40"
                              >
                                移出
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {groupData?.length === 0 && (
                <p className="rounded-lg bg-surface-container-high px-4 py-12 text-center text-sm text-on-surface-variant">还没有已合并的模型分组</p>
              )}
            </div>
          )
        ) : isLoadingInitial ? (
          <SkeletonList rows={5} />
        ) : (
          <div className="admin-tab-panel flex flex-col gap-3">
            {visibleModels.map((m) => (
              <Link key={m.model_id} to={`/model/${m.model_id}`} target="_blank" className="flex items-stretch rounded-lg border border-outline-variant/10 bg-surface-container-high shadow-sm transition-colors hover:bg-surface-container-highest">
                <div className="h-20 w-20 shrink-0 overflow-hidden rounded-l-lg bg-surface-container-highest">
                  <ModelThumbnail src={m.thumbnail_url} alt="" className="w-full h-full object-cover" />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-2.5">
                  <p className="line-clamp-2 break-words text-sm font-semibold leading-snug text-on-surface">{m.name}</p>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[10px] font-mono bg-surface-container-highest px-1 py-0.5 rounded-sm">{m.format?.toUpperCase()}</span>
                    <span className="text-[10px] text-on-surface-variant break-words">{m.category || '未分类'}</span>
                    <span className="text-[10px] text-on-surface-variant font-mono">{formatSize(m.original_size)}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5 pr-2.5" onClick={(e) => e.preventDefault()}>
                  <button onClick={() => handleQueueModelRebuild(m)} disabled={queueingModelId === m.model_id} aria-label={`重建预览 ${m.name}`} title="重建预览" className="px-2 py-1.5 text-xs text-on-surface-variant hover:text-primary rounded-sm border border-outline-variant/20 disabled:opacity-50"><Icon name="autorenew" size={14} className={queueingModelId === m.model_id ? 'animate-spin' : ''} /></button>
                  <button onClick={() => setEditModel(m)} className="px-2 py-1.5 text-xs text-on-surface-variant hover:text-on-surface rounded-sm border border-outline-variant/20"><Icon name="settings" size={14} /></button>
                  <button onClick={() => setDeleteTarget(m)} className="px-2 py-1.5 text-xs text-on-surface-variant hover:text-error rounded-sm border border-outline-variant/20"><Icon name="close" size={14} /></button>
                </div>
              </Link>
            ))}
            {models.length > 0 && (
              <InfiniteLoadTrigger
                hasMore={hasMoreVisibleModels || hasMore}
                isLoading={isLoadingMore}
                onLoadMore={hasMoreVisibleModels ? loadMoreVisibleModels : loadMore}
              />
            )}
            {models.length === 0 && <p className="text-center text-on-surface-variant py-12 text-sm">没有找到模型</p>}
          </div>
        )}
      </AdminManagementPage>
      <PreviewOperationsModal open={previewOpsOpen} onClose={() => setPreviewOpsOpen(false)} compact />
      <EditDialog open={!!editModel} model={editModel} categories={categories || []} onClose={() => setEditModel(null)} onSaved={() => mutate()} />
      <AnimatePresence>
        {deleteTarget && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-surface-dim/70 backdrop-blur-sm" onClick={() => setDeleteTarget(null)}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} onClick={(e) => e.stopPropagation()} className="bg-surface-container-low rounded-lg shadow-xl border border-outline-variant/20 w-full max-w-sm mx-4 p-5 sm:p-6">
              <h3 className="font-headline text-base font-semibold text-on-surface mb-2">确认删除</h3>
              <p className="text-sm text-on-surface-variant mb-5 break-words">确定要删除「{deleteTarget.name}」吗？</p>
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
                <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 text-sm text-on-surface-variant">取消</button>
                <button onClick={handleDelete} disabled={deleting} className="px-4 py-2 bg-error text-white rounded-sm text-sm disabled:opacity-50">{deleting ? '删除中...' : '删除'}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export default function ModelAdminPage() {
  useDocumentTitle('模型管理');
  const isDesktop = useMediaQuery('(min-width: 768px)');

  return (
    <AdminPageShell>
      {isDesktop ? <DesktopContent /> : <MobileContent />}
    </AdminPageShell>
  );
}
