import { useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import { modelApi, type ModelPreviewDiagnosticItem, type PreviewDiagnosticFilter } from '../../api/models';
import Icon from '../../components/shared/Icon';
import ModelThumbnail from '../../components/shared/ModelThumbnail';
import { PageRefreshIndicator } from '../../components/shared/PageRefreshFallback';
import { useToast } from '../../components/shared/Toast';
import {
  DIAGNOSTIC_FILTERS,
  formatBoundsSize,
  formatCount,
  getDiagnosticTone,
  previewOpsActionRowClass,
  previewOpsButtonClass,
  previewOpsFilterButtonClass,
  previewOpsFilterRowClass,
} from './shared';

// ── Loading states ─────────────────────────────────────────────────────────

function PreviewDiagnosticsListLoadingState({ compact }: { compact: boolean }) {
  return (
    <div className={`flex flex-1 ${compact ? 'min-h-[224px]' : 'min-h-[280px]'}`}>
      <PageRefreshIndicator label="预览诊断刷新中" />
    </div>
  );
}

// ── Badges ──────────────────────────────────────────────────────────────────

function DiagnosticStatusBadge({ item }: { item: ModelPreviewDiagnosticItem }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-sm border px-2 py-0.5 text-[10px] font-medium ${getDiagnosticTone(item.preview_status)}`}
    >
      {item.preview_label}
    </span>
  );
}

function PerformanceBadge({ level }: { level?: ModelPreviewDiagnosticItem['performance_level'] }) {
  if (!level || level === 'normal') return null;
  const label = level === 'huge' ? '超大模型' : '大模型';
  const className =
    level === 'huge' ? 'border-error/20 bg-error/10 text-error' : 'border-amber-500/20 bg-amber-500/10 text-amber-600';
  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-sm border px-2 py-0.5 text-[10px] font-medium ${className}`}
    >
      {label}
    </span>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export default function PreviewDiagnosticsPanel({
  compact = false,
  embedded = false,
}: {
  compact?: boolean;
  embedded?: boolean;
}) {
  const { toast } = useToast();
  const [status, setStatus] = useState<PreviewDiagnosticFilter>('problem');
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildingAll, setRebuildingAll] = useState(false);
  const { data, isLoading, mutate } = useSWR(['/models/preview-diagnostics', status, compact], () =>
    modelApi.previewDiagnostics({ status, page: 1, pageSize: compact ? 4 : 6 }),
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
    const ok = window.confirm(
      `将把当前筛选的前 ${Math.min(limit, data.total)} 个模型加入预览重建队列，生成新的 GLB 与缩略图。是否继续？`,
    );
    if (!ok) return;
    setRebuilding(true);
    try {
      const result = await modelApi.rebuildPreviewDiagnostics({ status, limit });
      toast(
        `已加入队列 ${result.queued} 个${result.skipped ? `，跳过 ${result.skipped} 个` : ''}`,
        result.failed ? 'error' : 'success',
      );
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
    const ok = window.confirm(
      `将把全部 ${total} 个模型加入预览重建队列，重新生成 GLB 与缩略图。任务会按后台队列慢慢执行，耗时可能较长。是否继续？`,
    );
    if (!ok) return;
    setRebuildingAll(true);
    try {
      const result = await modelApi.rebuildPreviewDiagnostics({ all: true, status: 'all', limit: total });
      toast(
        `已加入队列 ${result.queued} 个${result.skipped ? `，跳过 ${result.skipped} 个` : ''}`,
        result.failed ? 'error' : 'success',
      );
      mutate();
    } catch {
      toast('一键重建全部失败', 'error');
    } finally {
      setRebuildingAll(false);
    }
  };

  return (
    <section
      className={
        embedded
          ? 'flex h-full min-w-0 flex-col'
          : 'flex h-full min-w-0 flex-col rounded-lg border border-outline-variant/10 bg-surface-container-low p-4'
      }
    >
      <div
        className={
          embedded
            ? 'flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'
            : 'flex min-h-[72px] flex-col gap-3 lg:flex-row lg:items-start lg:justify-between'
        }
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon name="data_usage" size={17} className="text-primary" />
            <h3 className="text-sm font-semibold text-on-surface">预览诊断</h3>
            {summary && <span className="text-[10px] text-on-surface-variant">{summary.total} 个模型</span>}
          </div>
          {!embedded && (
            <p className="mt-1 text-xs text-on-surface-variant">
              扫描现有 GLB/glTF 诊断，快速定位缩略图异常、面片为空或包围盒异常的模型。
            </p>
          )}
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
          {data && (
            <span className="text-[10px] text-on-surface-variant">
              显示 {visibleItems.length} / {data.total}
            </span>
          )}
        </div>
        {isLoading ? (
          <PreviewDiagnosticsListLoadingState compact={compact} />
        ) : visibleItems.length > 0 ? (
          <div
            className={`grid flex-1 content-start gap-2 overflow-y-auto pr-1 ${compact ? 'min-h-[224px] max-h-[224px]' : 'min-h-[280px] max-h-[280px]'}`}
          >
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
          <div
            className={`flex flex-1 items-center justify-center rounded-sm border border-outline-variant/10 bg-surface-container-lowest px-3 py-4 text-center text-xs text-on-surface-variant ${compact ? 'min-h-[224px]' : 'min-h-[280px]'}`}
          >
            {status === 'ok' ? '暂时没有正常诊断记录' : '当前没有需要处理的预览异常'}
          </div>
        )}
      </div>
    </section>
  );
}
