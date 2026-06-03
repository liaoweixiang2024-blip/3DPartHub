import type { TFunction } from 'i18next';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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

const UNIT_OPTIONS: Array<{ key: MeasureUnit; labelKey?: string; label?: string }> = [
  { key: 'auto', labelKey: 'viewer.measurement.unitAuto' },
  { key: 'mm', label: 'mm' },
  { key: 'cm', label: 'cm' },
  { key: 'm', label: 'm' },
];

const SNAP_OPTIONS: Array<{ key: MeasurementSnapMode; labelKey: string; descriptionKey: string }> = [
  {
    key: 'surface',
    labelKey: 'viewer.measurement.snapSurface',
    descriptionKey: 'viewer.measurement.snapSurfaceDescription',
  },
  { key: 'edge', labelKey: 'viewer.measurement.snapEdge', descriptionKey: 'viewer.measurement.snapEdgeDescription' },
  {
    key: 'vertex',
    labelKey: 'viewer.measurement.snapVertex',
    descriptionKey: 'viewer.measurement.snapVertexDescription',
  },
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

function snapLabel(point: MeasurementPoint | undefined, t: TFunction) {
  if (!point) return '-';
  if (point.snap === 'vertex') return t('viewer.measurement.snapVertex');
  if (point.snap === 'edge') return t('viewer.measurement.snapEdge');
  return t('viewer.measurement.snapSurface');
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
  t: TFunction,
  bounds?: ModelBoundsDetail | null,
) {
  if (mode === 'distance') {
    const measuredDistance = distance(points);
    return measuredDistance === null
      ? ''
      : t('viewer.measurement.resultDistance', { value: formatMeasure(measuredDistance, unit) });
  }
  if (mode === 'angle') {
    const measuredAngle = angle(points);
    return measuredAngle === null ? '' : t('viewer.measurement.resultAngle', { value: measuredAngle.toFixed(2) });
  }
  if (mode === 'diameter') {
    const measuredDiameter = circleDiameter(points);
    return measuredDiameter === null
      ? ''
      : t('viewer.measurement.resultDiameter', { value: formatMeasure(measuredDiameter, unit) });
  }
  if (!bounds) return '';
  return [
    t('viewer.measurement.resultBoundsX', { value: formatMeasure(bounds.size.x, unit) }),
    `Y：${formatMeasure(bounds.size.y, unit)}`,
    `Z：${formatMeasure(bounds.size.z, unit)}`,
    t('viewer.measurement.resultMaxEdge', { value: formatMeasure(bounds.maxDim, unit) }),
  ].join(' / ');
}

function getRecordText(record: MeasurementRecord, unit: MeasureUnit, t: TFunction) {
  return getMeasurementText(record.mode, record.points, unit, t);
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
  const { t } = useTranslation();
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
  const snapDescription = t(
    SNAP_OPTIONS.find((option) => option.key === snapMode)?.descriptionKey ||
      'viewer.measurement.snapSurfaceDescription',
  );
  const prompt =
    mode === 'bounds'
      ? t('viewer.measurement.promptBounds')
      : points.length === 0
        ? t('viewer.measurement.promptPick', { mode: snapDescription })
        : points.length < requiredPoints
          ? t('viewer.measurement.promptContinue', { index: points.length + 1 })
          : mode === 'angle'
            ? t('viewer.measurement.promptAngleDone')
            : mode === 'diameter'
              ? t('viewer.measurement.promptDiameterDone')
              : t('viewer.measurement.promptDistanceDone');
  const resultText = useMemo(() => {
    return getMeasurementText(mode, points, unit, t, bounds);
  }, [bounds, mode, points, t, unit]);

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
            <h3 className="text-sm font-semibold text-on-surface">{t('viewer.measurement.title')}</h3>
          </div>
          <p className="mt-1 text-[11px] text-on-surface-variant">{prompt}</p>
        </div>
        <button
          type="button"
          aria-label={t('viewer.measurement.close')}
          onClick={onClose}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
        >
          <Icon name="close" size={16} />
        </button>
      </div>

      <div className="space-y-3 overflow-y-auto p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-on-surface-variant uppercase tracking-wider">
            {t('viewer.measurement.unit')}
          </span>
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
                {option.labelKey ? t(option.labelKey) : option.label}
              </button>
            ))}
          </div>
        </div>

        {mode !== 'bounds' && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-on-surface-variant uppercase tracking-wider">
              {t('viewer.measurement.snap')}
            </span>
            <div className="flex rounded-sm border border-outline-variant/20 bg-surface-container-low/70 p-0.5">
              {SNAP_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  title={t(option.descriptionKey)}
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
                  {t(option.labelKey)}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ['distance', t('viewer.measurement.modeDistance')],
              ['angle', t('viewer.measurement.modeAngle')],
              ['diameter', t('viewer.measurement.modeDiameter')],
              ['bounds', t('viewer.measurement.modeBounds')],
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
              <span className="text-on-surface-variant">{t('viewer.measurement.distance')}</span>
              <span className="font-mono text-on-surface">
                {measuredDistance === null ? '-' : formatMeasure(measuredDistance, unit)}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] text-on-surface-variant">
              <span
                className={`rounded-sm px-2 py-1 ${points[0] ? 'bg-cyan-400/10 text-cyan-200' : 'bg-surface-container-high/50'}`}
              >
                {t('viewer.measurement.startPoint')} {snapLabel(points[0], t)}
              </span>
              <span
                className={`rounded-sm px-2 py-1 ${points[1] ? 'bg-amber-400/10 text-amber-200' : 'bg-surface-container-high/50'}`}
              >
                {t('viewer.measurement.endPoint')} {snapLabel(points[1], t)}
              </span>
            </div>
          </div>
        ) : mode === 'angle' ? (
          <div className="rounded-sm border border-outline-variant/15 bg-surface-container-low/70 p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-on-surface-variant">{t('viewer.measurement.angle')}</span>
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
                  {t('viewer.measurement.point', { index: index + 1 })} {snapLabel(points[index], t)}
                </span>
              ))}
            </div>
          </div>
        ) : mode === 'diameter' ? (
          <div className="rounded-sm border border-outline-variant/15 bg-surface-container-low/70 p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-on-surface-variant">{t('viewer.measurement.diameter')}</span>
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
                  {t('viewer.measurement.point', { index: index + 1 })} {snapLabel(points[index], t)}
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
              <span className="block text-[10px] text-on-surface-variant">{t('viewer.measurement.maxEdge')}</span>
              <span className="font-mono text-xs text-on-surface">{formatMeasure(bounds?.maxDim, unit)}</span>
            </div>
          </div>
        )}

        {records.length > 0 && (
          <div className="overflow-hidden rounded-sm border border-outline-variant/15 bg-surface-container-low/60">
            <div className="flex items-center justify-between gap-2 border-b border-outline-variant/10 px-2.5 py-2">
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-on-surface">{t('viewer.measurement.history')}</div>
                <div className="text-[10px] text-on-surface-variant">
                  {t('viewer.measurement.historyLimit', { limit: recordLimit })}
                </div>
              </div>
              <button
                type="button"
                onClick={onClearRecords}
                className="shrink-0 rounded-sm px-2 py-1 text-[10px] text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
              >
                {t('viewer.measurement.clearHistory')}
              </button>
            </div>
            <div className="max-h-36 divide-y divide-outline-variant/10 overflow-y-auto">
              {records.map((record, index) => {
                const recordText = getRecordText(record, unit, t);
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
                      aria-label={t('viewer.measurement.copyRecord')}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface disabled:opacity-40"
                    >
                      <Icon name={copiedKey === record.id ? 'check' : 'content_copy'} size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveRecord(record.id)}
                      aria-label={t('viewer.measurement.deleteRecord')}
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
            {copiedKey === 'current' ? t('viewer.measurement.copied') : t('viewer.measurement.copyResult')}
          </button>
          <button
            type="button"
            onClick={onClear}
            className="flex items-center justify-center gap-1.5 rounded-sm border border-outline-variant/20 px-3 py-2 text-xs text-on-surface-variant hover:border-primary/30 hover:text-on-surface"
          >
            <Icon name="restart_alt" size={14} />
            {t('viewer.measurement.clear')}
          </button>
        </div>
      </div>
    </div>
  );
}
