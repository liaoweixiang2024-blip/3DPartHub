import { useMemo, useState } from 'react';
import Icon from '../shared/Icon';
import type {
  MeasureMode,
  MeasurementPoint,
  MeasurementRecord,
  MeasurementSnapMode,
  ModelBoundsDetail,
} from './viewerEvents';

interface MeasurementPanelProps {
  variant: 'desktop' | 'mobile';
  mode: MeasureMode;
  points: MeasurementPoint[];
  records: MeasurementRecord[];
  snapMode: MeasurementSnapMode;
  bounds: ModelBoundsDetail | null;
  active: boolean;
  defaultUnit?: string;
  recordLimit?: number;
  onModeChange: (mode: MeasureMode) => void;
  onSnapModeChange: (mode: MeasurementSnapMode) => void;
  onClear: () => void;
  onClearRecords: () => void;
  onRemoveRecord: (recordId: string) => void;
  onClose: () => void;
}

type MeasureUnit = 'auto' | 'mm' | 'cm' | 'm';

const UNIT_OPTIONS: Array<{ key: MeasureUnit; label: string }> = [
  { key: 'auto', label: '自动' },
  { key: 'mm', label: 'mm' },
  { key: 'cm', label: 'cm' },
  { key: 'm', label: 'm' },
];

const SNAP_OPTIONS: Array<{ key: MeasurementSnapMode; label: string; description: string }> = [
  { key: 'surface', label: '表面', description: '稳定表面点' },
  { key: 'edge', label: '边', description: '吸附最近边' },
  { key: 'vertex', label: '顶点', description: '吸附最近顶点' },
];

function formatMeasure(value?: number, unit: MeasureUnit = 'auto') {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  if (unit === 'mm') return `${value.toFixed(Math.abs(value) >= 10 ? 2 : 3)} mm`;
  if (unit === 'cm') return `${(value / 10).toFixed(Math.abs(value) >= 100 ? 2 : 3)} cm`;
  if (unit === 'm') return `${(value / 1000).toFixed(4)} m`;
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(3)} m`;
  if (Math.abs(value) >= 10) return `${value.toFixed(2)} mm`;
  return `${value.toFixed(3)} mm`;
}

function snapLabel(point?: MeasurementPoint) {
  if (!point) return '-';
  if (point.snap === 'vertex') return '顶点';
  if (point.snap === 'edge') return '边';
  return '表面';
}

function distance(points: MeasurementPoint[]) {
  if (points.length < 2) return null;
  const [a, b] = points;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function angle(points: MeasurementPoint[]) {
  if (points.length < 3) return null;
  const [a, b, c] = points;
  const ab = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  const cb = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
  const abLen = Math.sqrt(ab.x * ab.x + ab.y * ab.y + ab.z * ab.z);
  const cbLen = Math.sqrt(cb.x * cb.x + cb.y * cb.y + cb.z * cb.z);
  if (abLen <= 0 || cbLen <= 0) return null;
  const dot = ab.x * cb.x + ab.y * cb.y + ab.z * cb.z;
  const cos = Math.min(1, Math.max(-1, dot / (abLen * cbLen)));
  return (Math.acos(cos) * 180) / Math.PI;
}

function circleDiameter(points: MeasurementPoint[]) {
  if (points.length < 3) return null;
  const [a, b, c] = points;
  const ab = distance([a, b]) || 0;
  const bc = distance([b, c]) || 0;
  const ca = distance([c, a]) || 0;
  const s = (ab + bc + ca) / 2;
  const area = Math.sqrt(Math.max(0, s * (s - ab) * (s - bc) * (s - ca)));
  if (area <= 1e-8) return null;
  return (ab * bc * ca) / (2 * area);
}

function getMeasurementText(
  mode: MeasureMode,
  points: MeasurementPoint[],
  unit: MeasureUnit,
  bounds?: ModelBoundsDetail | null,
) {
  if (mode === 'distance') {
    const measuredDistance = distance(points);
    return measuredDistance === null ? '' : `两点距离：${formatMeasure(measuredDistance, unit)}`;
  }
  if (mode === 'angle') {
    const measuredAngle = angle(points);
    return measuredAngle === null ? '' : `三点角度：${measuredAngle.toFixed(2)} deg`;
  }
  if (mode === 'diameter') {
    const measuredDiameter = circleDiameter(points);
    return measuredDiameter === null ? '' : `三点直径：${formatMeasure(measuredDiameter, unit)}`;
  }
  if (!bounds) return '';
  return [
    `包围盒 X：${formatMeasure(bounds.size.x, unit)}`,
    `Y：${formatMeasure(bounds.size.y, unit)}`,
    `Z：${formatMeasure(bounds.size.z, unit)}`,
    `最大边：${formatMeasure(bounds.maxDim, unit)}`,
  ].join(' / ');
}

function getRecordText(record: MeasurementRecord, unit: MeasureUnit) {
  return getMeasurementText(record.mode, record.points, unit);
}

export default function MeasurementPanel({
  variant,
  mode,
  points,
  records,
  snapMode,
  bounds,
  active,
  defaultUnit = 'auto',
  recordLimit = 12,
  onModeChange,
  onSnapModeChange,
  onClear,
  onClearRecords,
  onRemoveRecord,
  onClose,
}: MeasurementPanelProps) {
  const normalizedDefaultUnit: MeasureUnit =
    defaultUnit === 'mm' || defaultUnit === 'cm' || defaultUnit === 'm' ? defaultUnit : 'auto';
  const [unit, setUnit] = useState<MeasureUnit>(normalizedDefaultUnit);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const panelClass =
    variant === 'mobile' ? 'absolute left-3 right-12 bottom-4 z-40' : 'absolute right-20 bottom-4 z-30 w-72';
  const measuredDistance = distance(points);
  const measuredAngle = angle(points);
  const measuredDiameter = circleDiameter(points);
  const requiredPoints = mode === 'angle' || mode === 'diameter' ? 3 : mode === 'distance' ? 2 : 0;
  const snapDescription = SNAP_OPTIONS.find((option) => option.key === snapMode)?.description || '稳定表面点';
  const prompt =
    mode === 'bounds'
      ? '查看当前模型包围盒尺寸'
      : points.length === 0
        ? `点击模型选点，当前为${snapDescription}模式`
        : points.length < requiredPoints
          ? `继续选取第 ${points.length + 1} 个点`
          : mode === 'angle'
            ? '已完成三点角度测量'
            : mode === 'diameter'
              ? '已完成三点直径测量'
              : '已完成两点距离测量';
  const resultText = useMemo(() => {
    return getMeasurementText(mode, points, unit, bounds);
  }, [bounds, mode, points, unit]);

  const copyText = async (text: string, key: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 1200);
    } catch {
      setCopiedKey(null);
    }
  };

  return (
    <div
      className={`${panelClass} micro-glass flex max-h-[calc(100dvh-7rem)] flex-col overflow-hidden rounded-md border border-outline-variant/20 bg-surface/92 shadow-xl backdrop-blur-xl`}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-3 border-b border-outline-variant/15 px-3 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon name="compass" size={16} className={active ? 'text-primary' : 'text-on-surface-variant'} />
            <h3 className="text-sm font-semibold text-on-surface">测量工具</h3>
          </div>
          <p className="mt-1 text-[11px] text-on-surface-variant">{prompt}</p>
        </div>
        <button
          type="button"
          aria-label="关闭测量工具"
          onClick={onClose}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
        >
          <Icon name="close" size={16} />
        </button>
      </div>

      <div className="space-y-3 overflow-y-auto p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-on-surface-variant uppercase tracking-wider">单位</span>
          <div className="flex rounded-sm border border-outline-variant/20 bg-surface-container-low/70 p-0.5">
            {UNIT_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setUnit(option.key)}
                className={`rounded-[3px] px-2 py-1 text-[10px] transition-colors ${
                  unit === option.key
                    ? 'bg-primary-container/20 text-primary'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {mode !== 'bounds' && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-on-surface-variant uppercase tracking-wider">吸附</span>
            <div className="flex rounded-sm border border-outline-variant/20 bg-surface-container-low/70 p-0.5">
              {SNAP_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  title={option.description}
                  onClick={() => {
                    onSnapModeChange(option.key);
                    onClear();
                  }}
                  className={`rounded-[3px] px-2 py-1 text-[10px] transition-colors ${
                    snapMode === option.key
                      ? 'bg-primary-container/20 text-primary'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ['distance', '两点距离'],
              ['angle', '三点角度'],
              ['diameter', '三点直径'],
              ['bounds', '包围盒'],
            ] as Array<[MeasureMode, string]>
          ).map(([itemMode, label]) => (
            <button
              key={itemMode}
              type="button"
              onClick={() => onModeChange(itemMode)}
              className={`rounded-sm border px-2 py-2 text-xs transition-colors ${
                mode === itemMode
                  ? 'border-primary/40 bg-primary-container/15 text-primary'
                  : 'border-outline-variant/20 text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === 'distance' ? (
          <div className="rounded-sm border border-outline-variant/15 bg-surface-container-low/70 p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-on-surface-variant">距离</span>
              <span className="font-mono text-on-surface">
                {measuredDistance === null ? '-' : formatMeasure(measuredDistance, unit)}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] text-on-surface-variant">
              <span
                className={`rounded-sm px-2 py-1 ${points[0] ? 'bg-cyan-400/10 text-cyan-200' : 'bg-surface-container-high/50'}`}
              >
                起点 {snapLabel(points[0])}
              </span>
              <span
                className={`rounded-sm px-2 py-1 ${points[1] ? 'bg-amber-400/10 text-amber-200' : 'bg-surface-container-high/50'}`}
              >
                终点 {snapLabel(points[1])}
              </span>
            </div>
          </div>
        ) : mode === 'angle' ? (
          <div className="rounded-sm border border-outline-variant/15 bg-surface-container-low/70 p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-on-surface-variant">角度</span>
              <span className="font-mono text-on-surface">
                {measuredAngle === null ? '-' : `${measuredAngle.toFixed(2)} deg`}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] text-on-surface-variant">
              {[0, 1, 2].map((index) => (
                <span
                  key={index}
                  className={`rounded-sm px-2 py-1 ${points[index] ? 'bg-cyan-400/10 text-cyan-200' : 'bg-surface-container-high/50'}`}
                >
                  点{index + 1} {snapLabel(points[index])}
                </span>
              ))}
            </div>
          </div>
        ) : mode === 'diameter' ? (
          <div className="rounded-sm border border-outline-variant/15 bg-surface-container-low/70 p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-on-surface-variant">直径</span>
              <span className="font-mono text-on-surface">
                {measuredDiameter === null ? '-' : formatMeasure(measuredDiameter, unit)}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] text-on-surface-variant">
              {[0, 1, 2].map((index) => (
                <span
                  key={index}
                  className={`rounded-sm px-2 py-1 ${points[index] ? 'bg-amber-400/10 text-amber-200' : 'bg-surface-container-high/50'}`}
                >
                  点{index + 1} {snapLabel(points[index])}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-sm border border-outline-variant/15 bg-surface-container-low/70 p-2">
              <span className="block text-[10px] text-on-surface-variant">X</span>
              <span className="font-mono text-xs text-on-surface">{formatMeasure(bounds?.size.x, unit)}</span>
            </div>
            <div className="rounded-sm border border-outline-variant/15 bg-surface-container-low/70 p-2">
              <span className="block text-[10px] text-on-surface-variant">Y</span>
              <span className="font-mono text-xs text-on-surface">{formatMeasure(bounds?.size.y, unit)}</span>
            </div>
            <div className="rounded-sm border border-outline-variant/15 bg-surface-container-low/70 p-2">
              <span className="block text-[10px] text-on-surface-variant">Z</span>
              <span className="font-mono text-xs text-on-surface">{formatMeasure(bounds?.size.z, unit)}</span>
            </div>
            <div className="rounded-sm border border-outline-variant/15 bg-surface-container-low/70 p-2">
              <span className="block text-[10px] text-on-surface-variant">最大边</span>
              <span className="font-mono text-xs text-on-surface">{formatMeasure(bounds?.maxDim, unit)}</span>
            </div>
          </div>
        )}

        {records.length > 0 && (
          <div className="overflow-hidden rounded-sm border border-outline-variant/15 bg-surface-container-low/60">
            <div className="flex items-center justify-between gap-2 border-b border-outline-variant/10 px-2.5 py-2">
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-on-surface">测量历史</div>
                <div className="text-[10px] text-on-surface-variant">最多保留最近 {recordLimit} 条</div>
              </div>
              <button
                type="button"
                onClick={onClearRecords}
                className="shrink-0 rounded-sm px-2 py-1 text-[10px] text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
              >
                清空
              </button>
            </div>
            <div className="max-h-36 divide-y divide-outline-variant/10 overflow-y-auto">
              {records.map((record, index) => {
                const recordText = getRecordText(record, unit);
                return (
                  <div key={record.id} className="flex items-center gap-2 px-2.5 py-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-surface-container-high text-[10px] font-medium text-on-surface-variant">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-on-surface" title={recordText}>
                      {recordText || '-'}
                    </span>
                    <button
                      type="button"
                      onClick={() => copyText(recordText, record.id)}
                      disabled={!recordText}
                      aria-label="复制测量记录"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface disabled:opacity-40"
                    >
                      <Icon name={copiedKey === record.id ? 'check' : 'content_copy'} size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveRecord(record.id)}
                      aria-label="删除测量记录"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                    >
                      <Icon name="delete" size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => copyText(resultText, 'current')}
            disabled={!resultText}
            className="flex items-center justify-center gap-1.5 rounded-sm border border-outline-variant/20 px-3 py-2 text-xs text-on-surface-variant hover:border-primary/30 hover:text-on-surface disabled:opacity-40"
          >
            <Icon name={copiedKey === 'current' ? 'check' : 'content_copy'} size={14} />
            {copiedKey === 'current' ? '已复制' : '复制结果'}
          </button>
          <button
            type="button"
            onClick={onClear}
            className="flex items-center justify-center gap-1.5 rounded-sm border border-outline-variant/20 px-3 py-2 text-xs text-on-surface-variant hover:border-primary/30 hover:text-on-surface"
          >
            <Icon name="restart_alt" size={14} />
            清除测量
          </button>
        </div>
      </div>
    </div>
  );
}
