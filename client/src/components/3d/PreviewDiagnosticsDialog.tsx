import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import type { ModelPreviewMeta } from '../../api/models';
import Icon from '../shared/Icon';

interface PreviewDiagnosticsDialogProps {
  open: boolean;
  meta?: ModelPreviewMeta | null;
  regenerating?: boolean;
  onClose: () => void;
  onRegenerate?: () => void;
}

function formatCompactNumber(value?: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return new Intl.NumberFormat('zh-CN').format(value);
}

function formatBytes(value?: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '-';
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

function formatPreviewSize(meta?: ModelPreviewMeta | null): string {
  const size = meta?.bounds?.size;
  if (!size) return '-';
  return `${size.map((value) => value.toFixed(value >= 100 ? 0 : 1)).join(' x ')} ${meta?.unit || 'mm'}`;
}

function getPreviewHealth(
  t: (key: string) => string,
  meta?: ModelPreviewMeta | null,
): { label: string; className: string; hint: string } {
  if (!meta) {
    return {
      label: t('modelAdminComp.filterMissing'),
      className: 'bg-amber-500/10 text-amber-500',
      hint: t('modelAdminComp.healthMissingHint'),
    };
  }
  const totals = meta.totals;
  const warnings = meta.diagnostics?.warnings || [];
  const skipped = meta.diagnostics?.skippedMeshCount || 0;
  if (!totals?.faceCount || !totals?.vertexCount) {
    return {
      label: t('modelAdminComp.filterInvalid'),
      className: 'bg-error/10 text-error',
      hint: t('modelAdminComp.healthInvalidHint'),
    };
  }
  if (warnings.length > 0 || skipped > 0) {
    return {
      label: t('modelAdminComp.filterWarning'),
      className: 'bg-amber-500/10 text-amber-500',
      hint: t('modelAdminComp.healthWarningHint'),
    };
  }
  return {
    label: t('modelAdminComp.filterOk'),
    className: 'bg-primary-container/10 text-primary',
    hint: t('modelAdminComp.healthOkHint'),
  };
}

export default function PreviewDiagnosticsDialog({
  open,
  meta,
  regenerating,
  onClose,
  onRegenerate,
}: PreviewDiagnosticsDialogProps) {
  const { t } = useTranslation();
  const health = getPreviewHealth(t, meta);
  const warnings = meta?.diagnostics?.warnings || [];
  const performanceHints = [
    ...(meta?.diagnostics?.precheck?.hints || []),
    ...(meta?.diagnostics?.performance?.hints || []),
  ];
  const conversionMs = meta?.diagnostics?.conversionMs;
  const asset = meta?.diagnostics?.asset;
  const optimization = meta?.diagnostics?.optimization;
  const precheck = meta?.diagnostics?.precheck;
  const ratio =
    typeof asset?.compressionRatio === 'number' && Number.isFinite(asset.compressionRatio)
      ? `${(asset.compressionRatio * 100).toFixed(1)}%`
      : '-';
  const optimizationText = optimization
    ? t('modelAdminComp.optimizationText', {
        saved: formatBytes(optimization.indexBytesSaved),
        u16: formatCompactNumber(optimization.indexComponentTypes?.uint16),
        materials: formatCompactNumber(optimization.duplicateMaterialsMerged),
      })
    : '-';

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[180] flex items-end sm:items-center justify-center bg-black/55 backdrop-blur-sm p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] sm:p-4"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-lg overflow-hidden rounded-t-lg sm:rounded-lg border border-outline-variant/20 bg-surface-container-low shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-outline-variant/15 px-4 py-4 sm:px-5">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Icon name="data_usage" size={18} className="text-primary" />
                  <h2 className="text-base font-semibold text-on-surface">{t('modelAdminComp.previewDiagnostics')}</h2>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">{health.hint}</p>
              </div>
              <button
                onClick={onClose}
                className="shrink-0 rounded-sm p-1 text-on-surface-variant hover:text-on-surface"
                aria-label={t('common.close')}
              >
                <Icon name="close" size={18} />
              </button>
            </div>

            <div className="max-h-[70dvh] overflow-y-auto p-4 sm:p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <span className={`rounded-sm px-2.5 py-1 text-xs font-medium ${health.className}`}>{health.label}</span>
                <span className="text-[11px] text-on-surface-variant">
                  {meta?.diagnostics?.generatedAt
                    ? new Date(meta.diagnostics.generatedAt).toLocaleString('zh-CN')
                    : t('modelAdminComp.notGenerated')}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-sm bg-surface-container-lowest p-3">
                  <span className="block text-[10px] text-on-surface-variant">{t('modelAdminComp.partsLabel')}</span>
                  <span className="font-mono text-sm text-on-surface">
                    {formatCompactNumber(meta?.totals?.partCount)}
                  </span>
                </div>
                <div className="rounded-sm bg-surface-container-lowest p-3">
                  <span className="block text-[10px] text-on-surface-variant">{t('modelAdminComp.facesLabel')}</span>
                  <span className="font-mono text-sm text-on-surface">
                    {formatCompactNumber(meta?.totals?.faceCount)}
                  </span>
                </div>
                <div className="rounded-sm bg-surface-container-lowest p-3">
                  <span className="block text-[10px] text-on-surface-variant">{t('modelAdminComp.verticesLabel')}</span>
                  <span className="font-mono text-sm text-on-surface">
                    {formatCompactNumber(meta?.totals?.vertexCount)}
                  </span>
                </div>
                <div className="rounded-sm bg-surface-container-lowest p-3">
                  <span className="block text-[10px] text-on-surface-variant">
                    {t('modelAdminComp.skippedMeshLabel')}
                  </span>
                  <span className="font-mono text-sm text-on-surface">
                    {formatCompactNumber(meta?.diagnostics?.skippedMeshCount)}
                  </span>
                </div>
              </div>

              <div className="mt-4 rounded-sm bg-surface-container-lowest p-3 text-xs text-on-surface-variant">
                <div className="flex items-center justify-between gap-3 py-1">
                  <span>{t('modelAdminComp.boundingBoxLabel')}</span>
                  <span className="text-right font-mono text-on-surface">{formatPreviewSize(meta)}</span>
                </div>
                <div className="flex items-center justify-between gap-3 py-1">
                  <span>{t('modelAdminComp.conversionTimeLabel')}</span>
                  <span className="font-mono text-on-surface">
                    {typeof conversionMs === 'number' ? `${(conversionMs / 1000).toFixed(2)}s` : '-'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 py-1">
                  <span>{t('modelAdminComp.converterLabel')}</span>
                  <span className="font-mono text-on-surface">{meta?.diagnostics?.converter || '-'}</span>
                </div>
                <div className="flex items-center justify-between gap-3 py-1">
                  <span>{t('modelAdminComp.glbSizeLabel')}</span>
                  <span className="font-mono text-on-surface">{formatBytes(asset?.gltfSize)}</span>
                </div>
                <div className="flex items-center justify-between gap-3 py-1">
                  <span>{t('modelAdminComp.originalSizeLabel')}</span>
                  <span className="font-mono text-on-surface">{formatBytes(asset?.originalSize)}</span>
                </div>
                <div className="flex items-center justify-between gap-3 py-1">
                  <span>{t('modelAdminComp.volumeRatioLabel')}</span>
                  <span className="font-mono text-on-surface">{ratio}</span>
                </div>
                <div className="flex items-center justify-between gap-3 py-1">
                  <span>{t('modelAdminComp.indexOptimizationLabel')}</span>
                  <span className="text-right font-mono text-on-surface">{optimizationText}</span>
                </div>
                <div className="flex items-center justify-between gap-3 py-1">
                  <span>{t('modelAdminComp.precheckLabel')}</span>
                  <span className="text-right font-mono text-on-surface">
                    {precheck
                      ? `${precheck.sourceLevel || '-'} / ${formatCompactNumber(precheck.estimatedPeakMemoryMb)} MB`
                      : '-'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 py-1">
                  <span>{t('modelAdminComp.cacheVersionLabel')}</span>
                  <span
                    className="max-w-[12rem] truncate text-right font-mono text-on-surface"
                    title={asset?.cacheVersion || ''}
                  >
                    {asset?.cacheVersion || '-'}
                  </span>
                </div>
              </div>

              {warnings.length > 0 && (
                <div className="mt-4 rounded-sm bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
                  {warnings.map((warning, index) => (
                    <div key={`${warning || 'warning'}-${index}`} className="py-0.5">
                      {warning}
                    </div>
                  ))}
                </div>
              )}

              {performanceHints.length > 0 && (
                <div className="mt-4 rounded-sm bg-primary-container/10 px-3 py-2 text-xs text-primary">
                  {performanceHints.map((hint, index) => (
                    <div key={`${hint || 'hint'}-${index}`} className="py-0.5">
                      {hint}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-outline-variant/15 px-4 py-3 sm:px-5">
              <button
                onClick={onClose}
                className="rounded-sm px-3 py-2 text-xs text-on-surface-variant hover:text-on-surface"
              >
                {t('common.close')}
              </button>
              {onRegenerate && (
                <button
                  onClick={onRegenerate}
                  disabled={regenerating}
                  className="flex items-center gap-1.5 rounded-sm bg-primary-container px-3 py-2 text-xs font-medium text-on-primary hover:bg-primary disabled:opacity-50"
                >
                  <Icon name="refresh" size={14} />
                  {regenerating ? t('modelAdminComp.generating') : t('modelAdminComp.regenGlb')}
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
