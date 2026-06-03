import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ModelPreviewMeta } from '../../api/models';
import Icon from '../shared/Icon';
import type { ModelBoundsDetail, ModelPartItem } from './viewerEvents';

interface ModelPropertiesPanelProps {
  variant: 'desktop' | 'mobile';
  modelName?: string;
  modelFormat?: string;
  modelFileSize?: string;
  modelCreatedAt?: string;
  previewMeta?: ModelPreviewMeta | null;
  bounds?: ModelBoundsDetail | null;
  parts: ModelPartItem[];
  selectedPartId?: string | null;
  onClose: () => void;
}

function formatCount(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

function formatNumber(value?: number | null, digits = 2, locale = 'zh-CN') {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return value.toLocaleString(locale, {
    maximumFractionDigits: digits,
    minimumFractionDigits: value === Math.round(value) ? 0 : Math.min(2, digits),
  });
}

function formatSize(
  size?: [number, number, number] | { x: number; y: number; z: number } | null,
  unit?: string,
  locale = 'zh-CN',
) {
  if (!size) return '-';
  const values = Array.isArray(size) ? size : [size.x, size.y, size.z];
  const suffix = unit && unit !== 'unknown' ? ` ${unit}` : '';
  return `${formatNumber(values[0], 2, locale)} x ${formatNumber(values[1], 2, locale)} x ${formatNumber(values[2], 2, locale)}${suffix}`;
}

function PropertyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-outline-variant/10 py-2 last:border-b-0">
      <span className="shrink-0 text-[11px] text-on-surface-variant">{label}</span>
      <span className="min-w-0 truncate text-right font-mono text-xs text-on-surface" title={value}>
        {value}
      </span>
    </div>
  );
}

export default function ModelPropertiesPanel({
  variant,
  modelName,
  modelFormat,
  modelFileSize,
  modelCreatedAt,
  previewMeta,
  bounds,
  parts,
  selectedPartId,
  onClose,
}: ModelPropertiesPanelProps) {
  const { i18n, t } = useTranslation();
  const selectedPart = useMemo(() => parts.find((part) => part.id === selectedPartId) || null, [parts, selectedPartId]);

  const fallbackVertexCount = useMemo(() => parts.reduce((sum, part) => sum + part.vertexCount, 0), [parts]);
  const fallbackFaceCount = useMemo(() => parts.reduce((sum, part) => sum + part.triangleCount, 0), [parts]);

  const totals = previewMeta?.totals;
  const unit = previewMeta?.unit || '';
  const generatedAt = previewMeta?.diagnostics?.generatedAt
    ? new Date(previewMeta.diagnostics.generatedAt).toLocaleString(i18n.language)
    : '';

  const panelClass =
    variant === 'mobile'
      ? 'absolute left-3 right-12 top-14 bottom-4 z-40'
      : 'absolute left-4 top-20 bottom-4 z-30 w-80';

  return (
    <div
      className={`${panelClass} micro-glass rounded-md border border-outline-variant/20 bg-surface/92 shadow-xl backdrop-blur-xl flex flex-col overflow-hidden`}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-3 border-b border-outline-variant/15 px-3 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon name="description" size={16} className="text-primary" />
            <h3 className="text-sm font-semibold text-on-surface">{t('viewer.properties.title')}</h3>
          </div>
          <p
            className="mt-1 truncate text-[11px] text-on-surface-variant"
            title={modelName || previewMeta?.sourceName || ''}
          >
            {modelName || previewMeta?.sourceName || t('viewer.properties.currentModel')}
          </p>
        </div>
        <button
          type="button"
          aria-label={t('viewer.properties.close')}
          onClick={onClose}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
        >
          <Icon name="close" size={16} />
        </button>
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-sm bg-surface-container-low p-2">
            <span className="block text-[10px] text-on-surface-variant">{t('viewer.properties.parts')}</span>
            <span className="font-mono text-sm text-on-surface">{formatCount(totals?.partCount ?? parts.length)}</span>
          </div>
          <div className="rounded-sm bg-surface-container-low p-2">
            <span className="block text-[10px] text-on-surface-variant">{t('viewer.properties.vertices')}</span>
            <span className="font-mono text-sm text-on-surface">
              {formatCount(totals?.vertexCount ?? fallbackVertexCount)}
            </span>
          </div>
          <div className="rounded-sm bg-surface-container-low p-2">
            <span className="block text-[10px] text-on-surface-variant">{t('viewer.properties.triangles')}</span>
            <span className="font-mono text-sm text-on-surface">
              {formatCount(totals?.faceCount ?? fallbackFaceCount)}
            </span>
          </div>
        </div>

        <div className="mt-3 rounded-sm bg-surface-container-lowest px-3">
          <PropertyRow label={t('viewer.properties.name')} value={modelName || previewMeta?.sourceName || '-'} />
          <PropertyRow label={t('viewer.properties.format')} value={modelFormat || previewMeta?.sourceFormat || '-'} />
          <PropertyRow label={t('viewer.properties.fileSize')} value={modelFileSize || '-'} />
          <PropertyRow label={t('viewer.properties.uploadedAt')} value={modelCreatedAt || '-'} />
          <PropertyRow
            label={t('viewer.properties.bounds')}
            value={formatSize(previewMeta?.bounds?.size || bounds?.size, unit, i18n.language)}
          />
          <PropertyRow label={t('viewer.properties.converter')} value={previewMeta?.diagnostics?.converter || '-'} />
          <PropertyRow label={t('viewer.properties.generatedAt')} value={generatedAt || '-'} />
        </div>

        {selectedPart && (
          <div className="mt-3 rounded-sm border border-primary/20 bg-primary-container/10 px-3 py-2">
            <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-primary">
              <Icon name="locate_fixed" size={14} />
              {t('viewer.properties.selectedPart')}
            </div>
            <PropertyRow label={t('viewer.properties.partName')} value={selectedPart.name} />
            <PropertyRow label={t('viewer.properties.path')} value={selectedPart.path || '-'} />
            <PropertyRow label={t('viewer.properties.vertices')} value={formatCount(selectedPart.vertexCount)} />
            <PropertyRow label={t('viewer.properties.triangles')} value={formatCount(selectedPart.triangleCount)} />
          </div>
        )}
      </div>
    </div>
  );
}
