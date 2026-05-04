import { useMemo } from 'react';
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

function formatNumber(value?: number | null, digits = 2) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return value.toLocaleString('zh-CN', {
    maximumFractionDigits: digits,
    minimumFractionDigits: value === Math.round(value) ? 0 : Math.min(2, digits),
  });
}

function formatSize(size?: [number, number, number] | { x: number; y: number; z: number } | null, unit?: string) {
  if (!size) return '-';
  const values = Array.isArray(size) ? size : [size.x, size.y, size.z];
  const suffix = unit && unit !== 'unknown' ? ` ${unit}` : '';
  return `${formatNumber(values[0])} x ${formatNumber(values[1])} x ${formatNumber(values[2])}${suffix}`;
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
  const selectedPart = useMemo(() => parts.find((part) => part.id === selectedPartId) || null, [parts, selectedPartId]);

  const fallbackVertexCount = useMemo(() => parts.reduce((sum, part) => sum + part.vertexCount, 0), [parts]);
  const fallbackFaceCount = useMemo(() => parts.reduce((sum, part) => sum + part.triangleCount, 0), [parts]);

  const totals = previewMeta?.totals;
  const unit = previewMeta?.unit || '';
  const generatedAt = previewMeta?.diagnostics?.generatedAt
    ? new Date(previewMeta.diagnostics.generatedAt).toLocaleString('zh-CN')
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
            <h3 className="text-sm font-semibold text-on-surface">模型属性</h3>
          </div>
          <p
            className="mt-1 truncate text-[11px] text-on-surface-variant"
            title={modelName || previewMeta?.sourceName || ''}
          >
            {modelName || previewMeta?.sourceName || '当前模型'}
          </p>
        </div>
        <button
          type="button"
          aria-label="关闭模型属性"
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
            <span className="block text-[10px] text-on-surface-variant">零件</span>
            <span className="font-mono text-sm text-on-surface">{formatCount(totals?.partCount ?? parts.length)}</span>
          </div>
          <div className="rounded-sm bg-surface-container-low p-2">
            <span className="block text-[10px] text-on-surface-variant">顶点</span>
            <span className="font-mono text-sm text-on-surface">
              {formatCount(totals?.vertexCount ?? fallbackVertexCount)}
            </span>
          </div>
          <div className="rounded-sm bg-surface-container-low p-2">
            <span className="block text-[10px] text-on-surface-variant">面</span>
            <span className="font-mono text-sm text-on-surface">
              {formatCount(totals?.faceCount ?? fallbackFaceCount)}
            </span>
          </div>
        </div>

        <div className="mt-3 rounded-sm bg-surface-container-lowest px-3">
          <PropertyRow label="名称" value={modelName || previewMeta?.sourceName || '-'} />
          <PropertyRow label="格式" value={modelFormat || previewMeta?.sourceFormat || '-'} />
          <PropertyRow label="文件大小" value={modelFileSize || '-'} />
          <PropertyRow label="上传时间" value={modelCreatedAt || '-'} />
          <PropertyRow label="包围盒" value={formatSize(previewMeta?.bounds?.size || bounds?.size, unit)} />
          <PropertyRow label="转换器" value={previewMeta?.diagnostics?.converter || '-'} />
          <PropertyRow label="生成时间" value={generatedAt || '-'} />
        </div>

        {selectedPart && (
          <div className="mt-3 rounded-sm border border-primary/20 bg-primary-container/10 px-3 py-2">
            <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-primary">
              <Icon name="locate_fixed" size={14} />
              当前选中零件
            </div>
            <PropertyRow label="零件名称" value={selectedPart.name} />
            <PropertyRow label="路径" value={selectedPart.path || '-'} />
            <PropertyRow label="顶点" value={formatCount(selectedPart.vertexCount)} />
            <PropertyRow label="面" value={formatCount(selectedPart.triangleCount)} />
          </div>
        )}
      </div>
    </div>
  );
}
