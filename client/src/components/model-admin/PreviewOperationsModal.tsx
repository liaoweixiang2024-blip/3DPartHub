import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { modelApi } from '../../api/models';
import { getSettings, updateSettings } from '../../api/settings';
import Icon from '../../components/shared/Icon';
import { useToast } from '../../components/shared/Toast';
import ConversionQueuePanel from './ConversionQueuePanel';
import PreviewDiagnosticsPanel from './PreviewDiagnosticsPanel';
import { formatCount } from './shared';

// ── Metric card ────────────────────────────────────────────────────────────

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

// ── Concurrency control ────────────────────────────────────────────────────

function ConversionConcurrencyControl({ compact = false }: { compact?: boolean }) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [localValue, setLocalValue] = useState(1);
  const { data: settings, mutate: mutateSettings } = useSWR('/settings/conversion-worker-concurrency', getSettings, {
    revalidateOnFocus: false,
  });
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
    <div
      className={`mt-3 rounded-sm border border-outline-variant/10 bg-surface-container-lowest ${compact ? 'p-2' : 'px-3 py-2.5'}`}
    >
      <div className={`flex gap-2 ${compact ? 'flex-col' : 'flex-col md:flex-row md:items-center md:justify-between'}`}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Icon name="tune" size={15} className="text-primary" />
            <span className="text-xs font-medium text-on-surface">转换并发数</span>
            <span className="rounded-sm bg-surface-container-high px-1.5 py-0.5 text-[10px] text-on-surface-variant">
              当前 {savedValue}
            </span>
            {!compact && (
              <span className="text-[10px] text-on-surface-variant">建议先设为 2，大模型较多时不要过高。</span>
            )}
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

// ── Preview operations panel (inner content) ───────────────────────────────

export function PreviewOperationsPanel({ compact = false }: { compact?: boolean }) {
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
    { refreshInterval: 5000 },
  );
  const diagnosticsSummary = opsData?.diagnostics.summary;
  const queueCounts = opsData?.queue.queue_counts || opsData?.queue.counts;
  const pendingQueueCount = (queueCounts?.waiting || 0) + (queueCounts?.active || 0) + (queueCounts?.delayed || 0);
  const failedQueueCount = queueCounts?.failed || 0;

  return (
    <section
      className={`rounded-lg border border-outline-variant/10 bg-surface-container-low ${compact ? 'p-3' : 'p-4'}`}
    >
      {!compact && (
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
      )}

      <div className={`grid gap-2 ${compact ? 'grid-cols-2' : 'grid-cols-2 pt-3 lg:grid-cols-4'}`}>
        <PreviewOpsMetricCard label="全部模型" value={diagnosticsSummary?.total} loading={opsLoading} />
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

// ── Modal wrapper ──────────────────────────────────────────────────────────

export default function PreviewOperationsModal({
  open,
  onClose,
  compact = false,
}: {
  open: boolean;
  onClose: () => void;
  compact?: boolean;
}) {
  const backdropClassName = compact
    ? 'fixed inset-0 z-[500] flex items-stretch justify-center bg-surface-dim/75 backdrop-blur-sm'
    : 'fixed inset-0 z-[500] flex items-end justify-center bg-surface-dim/70 px-3 py-4 backdrop-blur-sm sm:items-center sm:px-5';
  const panelClassName = compact
    ? 'relative flex h-dvh max-h-dvh w-full flex-col overflow-hidden bg-surface-container-low shadow-xl'
    : 'relative max-h-[92dvh] w-full max-w-[100rem] overflow-y-auto rounded-lg border border-outline-variant/20 bg-surface-container-low shadow-xl';

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className={backdropClassName}
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            className={panelClassName}
            onClick={(event) => event.stopPropagation()}
          >
            {compact ? (
              <>
                <div className="sticky top-0 z-20 flex shrink-0 items-center justify-between gap-3 border-b border-outline-variant/10 bg-surface-container-low/95 px-4 py-3 backdrop-blur">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold text-on-surface">预览运维工作台</h2>
                    <p className="mt-0.5 truncate text-xs text-on-surface-variant">诊断、重建、转换队列</p>
                  </div>
                  <button
                    onClick={onClose}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-outline-variant/20 bg-surface-container-lowest text-on-surface-variant shadow-sm"
                    data-tooltip-ignore
                    aria-label="关闭预览运维工作台"
                  >
                    <Icon name="close" size={17} />
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 pb-[calc(1rem+env(safe-area-inset-bottom))] scrollbar-hidden">
                  <PreviewOperationsPanel compact />
                </div>
              </>
            ) : (
              <>
                <button
                  onClick={onClose}
                  className="absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-sm border border-outline-variant/20 bg-surface-container-lowest text-on-surface-variant shadow-sm hover:bg-surface-container-high hover:text-on-surface"
                  data-tooltip-ignore
                  aria-label="关闭预览运维工作台"
                >
                  <Icon name="close" size={16} />
                </button>
                <div className="p-3">
                  <PreviewOperationsPanel />
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
