import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import { modelApi, type ConversionQueueJob, type ConversionQueueState } from '../../api/models';
import ConfirmDialog from '../../components/shared/ConfirmDialog';
import Icon from '../../components/shared/Icon';
import { PageRefreshIndicator } from '../../components/shared/PageRefreshFallback';
import { useToast } from '../../components/shared/Toast';
import {
  QUEUE_STATUS_CARDS,
  formatCount,
  formatQueueDuration,
  formatQueueFailureReason,
  formatQueueTime,
  getQueueStateLabel,
  getQueueStateTone,
  previewOpsActionRowClass,
  previewOpsButtonClass,
  previewOpsFilterButtonClass,
  previewOpsFilterRowClass,
} from './shared';

// ── Loading states ─────────────────────────────────────────────────────────

function ConversionQueueListLoadingState({ compact }: { compact: boolean }) {
  return (
    <div className={`flex flex-1 ${compact ? 'min-h-[224px]' : 'min-h-[280px]'}`}>
      <PageRefreshIndicator label="转换队列刷新中" />
    </div>
  );
}

function ConversionQueueDetailLoadingState() {
  return (
    <div className="flex min-h-[220px]">
      <PageRefreshIndicator label="转换任务详情刷新中" />
    </div>
  );
}

// ── Badges ──────────────────────────────────────────────────────────────────

function QueueStateBadge({ state }: { state: ConversionQueueState }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-sm border px-2 py-0.5 text-[10px] font-medium ${getQueueStateTone(state)}`}
    >
      {getQueueStateLabel(state)}
    </span>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export default function ConversionQueuePanel({
  compact = false,
  embedded = false,
}: {
  compact?: boolean;
  embedded?: boolean;
}) {
  const { toast } = useToast();
  const [queueAction, setQueueAction] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<
    'retry' | 'cancel-rebuilds' | 'clean-completed' | 'clean-failed' | null
  >(null);
  const [detailJobId, setDetailJobId] = useState<string | null>(null);
  const [selectedQueueState, setSelectedQueueState] = useState<ConversionQueueState | 'all'>('all');
  const queueListLimit = selectedQueueState === 'all' ? (compact ? 4 : 6) : compact ? 8 : 12;
  const { data, isLoading, mutate } = useSWR(
    ['/tasks/conversion-queue', compact, selectedQueueState, queueListLimit],
    () => modelApi.conversionQueue({ limit: queueListLimit, state: selectedQueueState }),
    { refreshInterval: 2000 },
  );
  const { data: detail, isLoading: detailLoading } = useSWR(
    detailJobId ? ['/tasks/conversion-queue/detail', detailJobId] : null,
    () => modelApi.conversionQueueJob(detailJobId!),
  );
  const items = data?.items || [];
  const visibleQueueItems = items.slice(0, queueListLimit);
  const queueCounts = data?.queue_counts || data?.counts;
  const queueDisplayTotal = selectedQueueState === 'all' ? items.length : (data?.total ?? items.length);
  const activeCount = data?.counts.active || 0;
  const running = (data?.counts.active || 0) + (data?.counts.waiting || 0) + (data?.counts.delayed || 0);
  const failedCount = data?.counts.failed || 0;
  const completedQueueCount = queueCounts?.completed || 0;
  const selectedQueueLabel =
    selectedQueueState === 'all'
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
    setConfirmAction('retry');
  };

  const confirmRetryFailed = async () => {
    if (failedCount <= 0) return;
    setConfirmAction(null);
    setQueueAction('retry');
    try {
      const result = await modelApi.retryFailedConversionJobs({ limit: 25 });
      toast(
        `已重试 ${result.retried || 0} 个失败任务${result.skipped ? `，跳过 ${result.skipped} 个` : ''}`,
        result.failed ? 'error' : 'success',
      );
      mutate();
    } catch {
      toast('重试失败任务失败', 'error');
    } finally {
      setQueueAction(null);
    }
  };

  const handleCancelPreviewRebuilds = async () => {
    if (running <= 0) return;
    setConfirmAction('cancel-rebuilds');
  };

  const confirmCancelPreviewRebuilds = async () => {
    if (running <= 0) return;
    setConfirmAction(null);
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
    setConfirmAction(type === 'completed' ? 'clean-completed' : 'clean-failed');
  };

  const confirmCleanQueue = async (type: 'completed' | 'failed') => {
    const count = type === 'completed' ? completedQueueCount : failedCount;
    if (count <= 0) return;
    setConfirmAction(null);
    const label = type === 'completed' ? '已完成' : '失败';
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

  const confirmDialogCopy = (() => {
    if (confirmAction === 'retry') {
      return {
        title: '确认重试失败任务',
        description: `将重试最多 ${Math.min(failedCount, 25)} 个失败的转换任务，并把关联模型重新标记为排队中。`,
        confirmLabel: '确认重试',
        onConfirm: () => void confirmRetryFailed(),
      };
    }
    if (confirmAction === 'cancel-rebuilds') {
      return {
        title: '确认停止重建',
        description:
          '将取消等待中/延迟中的预览重建任务。正在处理的当前模型不会强制中断，会完成后停止继续执行后续重建。',
        confirmLabel: '停止重建',
        onConfirm: () => void confirmCancelPreviewRebuilds(),
      };
    }
    if (confirmAction === 'clean-completed') {
      return {
        title: '确认清理完成任务',
        description: '将清理最多 100 条已完成转换任务记录。只删除队列记录，不会删除模型文件。',
        confirmLabel: '确认清理',
        onConfirm: () => void confirmCleanQueue('completed'),
      };
    }
    if (confirmAction === 'clean-failed') {
      return {
        title: '确认清理失败任务',
        description: '将清理最多 100 条失败转换任务记录。只删除队列记录，不会删除模型文件。',
        confirmLabel: '确认清理',
        onConfirm: () => void confirmCleanQueue('failed'),
      };
    }
    return null;
  })();

  const renderJob = (job: ConversionQueueJob) => {
    const content = (
      <>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-xs font-medium text-on-surface">
              {job.model_name || job.original_name || job.id}
            </p>
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
            >
              <Icon name="open_in_new" size={14} />
            </Link>
          )}
        </div>
      </>
    );

    return (
      <div
        key={job.id}
        className="flex items-start gap-3 rounded-sm border border-outline-variant/10 bg-surface-container-lowest px-3 py-2 hover:bg-surface-container-high"
      >
        {content}
      </div>
    );
  };

  return (
    <>
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
          <div className="min-w-0 shrink-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Icon name="hourglass_top" size={17} className="text-primary" />
              <h3 className="shrink-0 text-sm font-semibold text-on-surface">转换队列</h3>
              <span
                className={`inline-flex max-w-full shrink-0 whitespace-nowrap rounded-sm px-1.5 py-0.5 text-[10px] leading-none ${running > 0 ? 'bg-primary/10 text-primary' : 'bg-surface-container-high text-on-surface-variant'}`}
              >
                {running > 0 ? `${formatCount(running)} 个待完成` : '空闲'}
              </span>
            </div>
            {!embedded && (
              <p className="mt-1 text-xs text-on-surface-variant">实时查看上传、重建和缩略图生成任务状态。</p>
            )}
          </div>
          <div className={previewOpsActionRowClass(compact)}>
            <button
              onClick={() => mutate()}
              disabled={isLoading}
              className={`${previewOpsButtonClass(compact)} border border-outline-variant/20 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface`}
            >
              <Icon name="refresh" size={15} className={isLoading ? 'animate-spin' : ''} />
              <span>刷新</span>
            </button>
            <button
              onClick={handleRetryFailed}
              disabled={isLoading || !!queueAction || failedCount <= 0}
              className={`${previewOpsButtonClass(compact)} border border-outline-variant/20 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface`}
            >
              <Icon name="replay" size={14} className={queueAction === 'retry' ? 'animate-spin' : ''} />
              <span>重试</span>
            </button>
            <button
              onClick={handleCancelPreviewRebuilds}
              disabled={isLoading || !!queueAction || running <= 0}
              className={`${previewOpsButtonClass(compact)} border border-error/20 text-error hover:bg-error/10`}
            >
              <Icon name="close" size={14} className={queueAction === 'cancel-rebuilds' ? 'animate-spin' : ''} />
              <span>停止重建</span>
            </button>
            <button
              onClick={() => handleCleanQueue('completed')}
              disabled={isLoading || !!queueAction || completedQueueCount <= 0}
              className={`${previewOpsButtonClass(compact)} border border-outline-variant/20 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface`}
            >
              <Icon
                name="cleaning_services"
                size={14}
                className={queueAction === 'clean-completed' ? 'animate-spin' : ''}
              />
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
                  onClick={() => setSelectedQueueState((current) => (current === item.key ? 'all' : item.key))}
                  className={previewOpsFilterButtonClass(compact, active)}
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
                  onClick={() => setSelectedQueueState((current) => (current === item.key ? 'all' : item.key))}
                  className={`min-h-[68px] rounded-sm border px-3 py-2 text-left transition ${active ? 'border-primary bg-primary-container/20 text-primary ring-1 ring-primary/30' : getQueueStateTone(item.key)} hover:-translate-y-0.5 hover:shadow-sm`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium">{item.label}</span>
                    <Icon name={item.icon} size={16} className="shrink-0 opacity-80" />
                  </div>
                  <span className="mt-1 block font-mono text-lg font-semibold">
                    {formatCount(data?.counts[item.key])}
                  </span>
                  <span className="mt-0.5 block text-[10px] opacity-75">
                    {item.key === 'completed'
                      ? `保留 ${formatCount(queueCounts?.completed)}`
                      : active
                        ? '正在筛选'
                        : '点击筛选'}
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
              <span>
                显示 {visibleQueueItems.length} / {queueDisplayTotal} 条
              </span>
              {data?.generated_at && (
                <span>
                  {new Date(data.generated_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
          </div>
          {isLoading ? (
            <ConversionQueueListLoadingState compact={compact} />
          ) : visibleQueueItems.length > 0 ? (
            <div
              className={`grid flex-1 content-start gap-2 overflow-y-auto pr-1 ${compact ? 'min-h-[224px] max-h-[224px]' : 'min-h-[280px] max-h-[280px]'}`}
            >
              {visibleQueueItems.map(renderJob)}
            </div>
          ) : (
            <div
              className={`flex flex-1 items-center justify-center rounded-sm border border-outline-variant/10 bg-surface-container-lowest px-3 py-4 text-center text-xs text-on-surface-variant ${compact ? 'min-h-[224px]' : 'min-h-[280px]'}`}
            >
              暂无转换任务
            </div>
          )}
        </div>
      </section>
      <ConfirmDialog
        open={Boolean(confirmDialogCopy)}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => confirmDialogCopy?.onConfirm()}
        icon={confirmAction === 'retry' ? 'replay' : confirmAction === 'cancel-rebuilds' ? 'close' : 'delete_sweep'}
        title={confirmDialogCopy?.title || ''}
        description={confirmDialogCopy?.description || ''}
        confirmLabel={confirmDialogCopy?.confirmLabel || '确认'}
        confirmDisabled={Boolean(queueAction)}
      />
      {detailJobId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-surface-dim/70 px-4 py-6 backdrop-blur-sm"
          onClick={() => setDetailJobId(null)}
        >
          <div
            className="max-h-[88vh] w-full max-w-3xl overflow-hidden rounded-lg border border-outline-variant/20 bg-surface-container-low shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-outline-variant/10 px-5 py-4">
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-on-surface">转换任务详情</h3>
                <p className="mt-1 truncate text-xs text-on-surface-variant">{detailJobId}</p>
              </div>
              <button
                onClick={() => setDetailJobId(null)}
                className="rounded-sm border border-outline-variant/20 p-1.5 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <div className="max-h-[calc(88vh-72px)] overflow-y-auto p-5">
              {detailLoading ? (
                <ConversionQueueDetailLoadingState />
              ) : detail ? (
                <div className="space-y-4">
                  <div className="grid gap-2 text-xs sm:grid-cols-2">
                    <div className="rounded-sm bg-surface-container-lowest p-3">
                      <span className="block text-[10px] text-on-surface-variant">状态</span>
                      <span className="mt-1 inline-flex">
                        <QueueStateBadge state={detail.state} />
                      </span>
                    </div>
                    <div className="rounded-sm bg-surface-container-lowest p-3">
                      <span className="block text-[10px] text-on-surface-variant">进度 / 尝试次数</span>
                      <span className="mt-1 block font-mono text-on-surface">
                        {detail.progress}% / {detail.attempts_made}
                      </span>
                      {detail.state === 'active' && (
                        <span
                          className={
                            detail.is_stale
                              ? 'mt-1 block text-[10px] text-error'
                              : 'mt-1 block text-[10px] text-on-surface-variant'
                          }
                        >
                          已处理 {formatQueueDuration(detail.active_ms)}
                          {detail.is_stale ? '，可能卡住' : ''}
                        </span>
                      )}
                    </div>
                    <div className="rounded-sm bg-surface-container-lowest p-3">
                      <span className="block text-[10px] text-on-surface-variant">模型</span>
                      <span className="mt-1 block truncate text-on-surface">
                        {detail.model?.name || detail.data?.original_name || detail.model_id || '-'}
                      </span>
                    </div>
                    <div className="rounded-sm bg-surface-container-lowest p-3">
                      <span className="block text-[10px] text-on-surface-variant">格式 / 重建原因</span>
                      <span className="mt-1 block font-mono text-on-surface">
                        {detail.data?.ext?.toUpperCase() || '-'} / {detail.data?.rebuild_reason || '-'}
                      </span>
                    </div>
                    <div className="rounded-sm bg-surface-container-lowest p-3 sm:col-span-2">
                      <span className="block text-[10px] text-on-surface-variant">源文件</span>
                      <span className="mt-1 block break-all font-mono text-on-surface">
                        {detail.data?.source_path || detail.data?.source_name || '-'}
                      </span>
                      <span
                        className={`mt-1 inline-block rounded-sm px-1.5 py-0.5 text-[10px] ${detail.data?.source_exists === false ? 'bg-error/10 text-error' : 'bg-primary/10 text-primary'}`}
                      >
                        {detail.data?.source_exists === null || detail.data?.source_exists === undefined
                          ? '未知'
                          : detail.data.source_exists
                            ? '文件存在'
                            : '文件不存在'}
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
                      <span className="font-mono text-[10px] text-on-surface-variant">
                        {(detail.logs || []).length} / {detail.log_count || 0}
                      </span>
                    </div>
                    {(detail.logs || []).length > 0 ? (
                      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-surface-container-high p-3 text-[11px] leading-relaxed text-on-surface">
                        {(detail.logs || []).join('\n')}
                      </pre>
                    ) : (
                      <div className="rounded-sm bg-surface-container-high px-3 py-4 text-center text-xs text-on-surface-variant">
                        暂无日志
                      </div>
                    )}
                  </div>

                  {(detail.stacktrace || []).length > 0 && (
                    <div className="rounded-sm border border-outline-variant/10 bg-surface-container-lowest p-3">
                      <div className="mb-2 text-[11px] font-medium text-on-surface-variant">错误栈</div>
                      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-surface-container-high p-3 text-[11px] leading-relaxed text-error">
                        {(detail.stacktrace || []).join('\n')}
                      </pre>
                    </div>
                  )}

                  <div className="flex justify-end gap-2">
                    {detail.model_id && (
                      <Link
                        to={`/model/${detail.model_id}`}
                        target="_blank"
                        className="inline-flex items-center gap-1.5 rounded-sm border border-outline-variant/20 px-3 py-1.5 text-xs text-on-surface-variant hover:bg-surface-container-high hover:text-primary"
                      >
                        <Icon name="open_in_new" size={14} />
                        打开模型
                      </Link>
                    )}
                    <button
                      onClick={() => setDetailJobId(null)}
                      className="rounded-sm bg-primary-container px-3 py-1.5 text-xs font-medium text-on-primary hover:bg-primary"
                    >
                      关闭
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-sm bg-surface-container-high px-3 py-8 text-center text-xs text-on-surface-variant">
                  任务详情加载失败
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
