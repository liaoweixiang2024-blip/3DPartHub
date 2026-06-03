import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getPublicSettingsSnapshot } from '../../lib/publicSettings';
import Icon from '../shared/Icon';
import type { CameraPreset, ViewMode } from './ModelViewer';
import { CAMERA_ANGLES, MATERIAL_PRESETS, VIEW_MODES, type MaterialPresetKey } from './viewerControls';
import { dispatchFitModel } from './viewerEvents';

interface CadViewerToolbarProps {
  variant: 'desktop' | 'mobile';
  isAdmin?: boolean;
  activeView: ViewMode;
  onViewChange: (view: ViewMode) => void;
  explodeAmount?: number;
  onExplodeAmountChange?: (amount: number) => void;
  onResetExplode?: () => void;
  activeCamera: CameraPreset;
  onCameraChange: (camera: CameraPreset) => void;
  showDimensions: boolean;
  onToggleDimensions: () => void;
  materialPreset: MaterialPresetKey;
  onMaterialChange: (preset: MaterialPresetKey) => void;
  showEdges: boolean;
  onToggleEdges: () => void;
  clipEnabled: boolean;
  onToggleClip: () => void;
  clipPosition: number;
  onClipPositionChange: (position: number) => void;
  clipRange?: { min: number; max: number; step: number };
  clipDirection: 'x' | 'y' | 'z';
  onClipDirectionChange: (direction: 'x' | 'y' | 'z') => void;
  clipInverted?: boolean;
  onToggleClipInverted?: () => void;
  onResetClip?: () => void;
  showAxis: boolean;
  onToggleAxis: () => void;
  measurementOpen?: boolean;
  onToggleMeasurement?: () => void;
  propertiesOpen?: boolean;
  onToggleProperties?: () => void;
  structureOpen?: boolean;
  onToggleStructure?: () => void;
  partCount?: number;
  onResetDisplay: () => void;
  tuningOpen?: boolean;
  onToggleTuning?: () => void;
  onScreenshot?: () => void;
  onFullscreen?: () => void;
  onSetThumbnail?: () => void;
  settingThumbnail?: boolean;
  onOpenDiagnostics?: () => void;
}

function getVisiblePresets() {
  const raw = (getPublicSettingsSnapshot().viewer_visible_presets as string) || '';
  if (!raw.trim()) return MATERIAL_PRESETS;
  const keys = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return MATERIAL_PRESETS.filter((p) => keys.includes(p.key));
}

function ToolbarButton({
  icon,
  label,
  active,
  disabled,
  size,
  tooltipSide,
  compact = false,
  onClick,
}: {
  icon: string;
  label: string;
  active?: boolean;
  disabled?: boolean;
  size: number;
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right';
  compact?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      data-tooltip={label}
      data-tooltip-side={tooltipSide}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      className={`group relative transition-colors rounded-sm disabled:opacity-50 ${
        compact ? 'flex h-8 w-8 items-center justify-center p-0' : 'p-2'
      } ${active ? 'text-primary bg-primary-container/10' : 'text-on-surface-variant hover:text-primary'}`}
    >
      <Icon name={icon} size={size} className={disabled ? 'animate-pulse' : ''} />
    </button>
  );
}

function ClipControl({
  compact = false,
  clipDirection,
  onClipDirectionChange,
  clipPosition,
  onClipPositionChange,
  clipRange,
  clipInverted,
  onToggleClipInverted,
  onResetClip,
}: Pick<
  CadViewerToolbarProps,
  | 'clipDirection'
  | 'onClipDirectionChange'
  | 'clipPosition'
  | 'onClipPositionChange'
  | 'clipRange'
  | 'clipInverted'
  | 'onToggleClipInverted'
  | 'onResetClip'
> & { compact?: boolean }) {
  const { t } = useTranslation();
  const range = clipRange || { min: -2, max: 2, step: 0.01 };
  const labelValue = Math.abs(range.step) >= 1 ? clipPosition.toFixed(0) : clipPosition.toFixed(2);

  return (
    <div
      className={`micro-glass rounded-sm flex flex-col gap-1.5 ${compact ? 'p-2 min-w-[144px]' : 'p-3'}`}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {!compact && (
        <span className="text-[10px] text-on-surface-variant uppercase tracking-wider">
          {t('viewer.toolbar.clipDirection')}
        </span>
      )}
      <div className="flex gap-1">
        {(['x', 'y', 'z'] as const).map((direction) => (
          <button
            key={direction}
            type="button"
            onClick={() => onClipDirectionChange(direction)}
            className={`flex-1 text-[10px] rounded-sm transition-colors ${compact ? 'py-0.5' : 'py-1'} ${
              clipDirection === direction
                ? 'bg-primary-container/30 text-primary font-bold'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            {direction.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        {!compact && (
          <span className="text-[10px] text-on-surface-variant uppercase tracking-wider">
            {t('viewer.toolbar.clipPosition')}
          </span>
        )}
        <span className="ml-auto font-mono text-[10px] text-on-surface-variant">{labelValue}</span>
      </div>
      <input
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={clipPosition}
        onChange={(event) => onClipPositionChange(parseFloat(event.target.value))}
        className={`${compact ? 'w-full' : 'w-24'} accent-primary-container`}
      />
      {(onToggleClipInverted || onResetClip) && (
        <div className="grid grid-cols-2 gap-1">
          {onToggleClipInverted && (
            <button
              type="button"
              onClick={onToggleClipInverted}
              className={`rounded-sm border px-2 py-1 text-[10px] transition-colors ${
                clipInverted
                  ? 'border-primary/40 bg-primary-container/20 text-primary'
                  : 'border-outline-variant/20 text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {t('viewer.toolbar.invert')}
            </button>
          )}
          {onResetClip && (
            <button
              type="button"
              onClick={onResetClip}
              className="rounded-sm border border-outline-variant/20 px-2 py-1 text-[10px] text-on-surface-variant transition-colors hover:text-on-surface"
            >
              {t('viewer.toolbar.resetClip')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ExplodeControl({
  compact = false,
  explodeAmount = 1,
  onExplodeAmountChange,
  onResetExplode,
}: {
  compact?: boolean;
  explodeAmount?: number;
  onExplodeAmountChange?: (amount: number) => void;
  onResetExplode?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={`micro-glass rounded-sm flex flex-col gap-1.5 ${compact ? 'p-2 min-w-[144px]' : 'p-3'}`}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-2">
        {!compact && (
          <span className="text-[10px] text-on-surface-variant uppercase tracking-wider">
            {t('viewer.toolbar.explodeAmount')}
          </span>
        )}
        <span className="ml-auto font-mono text-[10px] text-on-surface-variant">{explodeAmount.toFixed(1)}x</span>
      </div>
      <input
        type="range"
        min={0}
        max={3}
        step={0.1}
        value={explodeAmount}
        onChange={(event) => onExplodeAmountChange?.(parseFloat(event.target.value))}
        className={`${compact ? 'w-full' : 'w-24'} accent-primary-container`}
        aria-label={t('viewer.toolbar.explodeAmount')}
      />
      <button
        type="button"
        onClick={onResetExplode}
        className="rounded-sm border border-outline-variant/20 px-2 py-1 text-[10px] text-on-surface-variant transition-colors hover:text-on-surface"
      >
        {t('viewer.toolbar.resetExplode')}
      </button>
    </div>
  );
}

function MaterialPresetMenu({
  presets,
  active,
  onSelect,
}: {
  presets: typeof MATERIAL_PRESETS;
  active: MaterialPresetKey;
  onSelect: (preset: MaterialPresetKey) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="micro-glass flex min-w-[138px] flex-col gap-1 rounded-sm p-1.5"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {presets.map((preset) => (
        <button
          key={preset.key}
          type="button"
          onClick={() => onSelect(preset.key)}
          className={`inline-flex h-8 items-center gap-2 rounded-sm px-2 text-xs font-medium transition-colors ${
            active === preset.key
              ? 'bg-primary-container/20 text-primary'
              : 'text-on-surface-variant hover:bg-surface-container-high/70 hover:text-on-surface'
          }`}
        >
          <Icon name={preset.icon} size={14} />
          <span className="truncate">{t(`viewer.material.${preset.key}`, { defaultValue: preset.label })}</span>
        </button>
      ))}
    </div>
  );
}

export default function CadViewerToolbar(props: CadViewerToolbarProps) {
  const { t } = useTranslation();
  const {
    variant,
    isAdmin,
    activeView,
    onViewChange,
    explodeAmount = 1,
    onExplodeAmountChange,
    onResetExplode,
    activeCamera,
    onCameraChange,
    showDimensions,
    onToggleDimensions,
    materialPreset,
    onMaterialChange,
    showEdges,
    onToggleEdges,
    clipEnabled,
    onToggleClip,
    clipPosition,
    onClipPositionChange,
    clipRange,
    clipDirection,
    onClipDirectionChange,
    clipInverted,
    onToggleClipInverted,
    onResetClip,
    measurementOpen,
    onToggleMeasurement,
    onResetDisplay,
    onScreenshot,
    onFullscreen,
    onSetThumbnail,
    settingThumbnail,
  } = props;
  const [materialMenuOpen, setMaterialMenuOpen] = useState(false);
  const visiblePresets = getVisiblePresets();
  const activeMaterialPreset =
    visiblePresets.find((preset) => preset.key === materialPreset) ||
    MATERIAL_PRESETS.find((preset) => preset.key === materialPreset) ||
    MATERIAL_PRESETS[0];

  if (variant === 'mobile') {
    return (
      <div
        className="absolute right-2 top-3 bottom-3 z-10 flex items-center"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="micro-glass rounded-sm p-0.5 flex max-h-full flex-col gap-px overflow-y-auto overscroll-contain scrollbar-hidden">
          <ToolbarButton
            compact
            icon="straighten"
            label={t('viewer.toolbar.dimensions')}
            size={14}
            tooltipSide="left"
            active={showDimensions}
            onClick={onToggleDimensions}
          />
          <ToolbarButton
            compact
            icon="content_cut"
            label={t('viewer.toolbar.clip')}
            size={14}
            tooltipSide="left"
            active={clipEnabled}
            onClick={onToggleClip}
          />
          <ToolbarButton
            compact
            icon="restart_alt"
            label={t('viewer.toolbar.resetDisplay')}
            size={14}
            tooltipSide="left"
            onClick={onResetDisplay}
          />
          <ToolbarButton
            compact
            icon="diamond"
            label={t('viewer.toolbar.edges')}
            size={14}
            tooltipSide="left"
            active={showEdges}
            onClick={onToggleEdges}
          />
          <ToolbarButton
            compact
            icon="opacity"
            label={t('viewer.toolbar.transparent')}
            size={14}
            tooltipSide="left"
            active={activeView === 'transparent'}
            onClick={() => onViewChange(activeView === 'transparent' ? 'solid' : 'transparent')}
          />
          {onScreenshot && (
            <ToolbarButton
              compact
              icon="photo_camera"
              label={t('viewer.toolbar.screenshot')}
              size={14}
              tooltipSide="left"
              onClick={onScreenshot}
            />
          )}
          {onFullscreen && (
            <ToolbarButton
              compact
              icon="fullscreen"
              label={t('viewer.toolbar.fullscreen')}
              size={14}
              tooltipSide="left"
              onClick={onFullscreen}
            />
          )}
        </div>

        {clipEnabled && (
          <div className="absolute bottom-0 right-full mr-1 z-20">
            <ClipControl
              compact
              clipDirection={clipDirection}
              onClipDirectionChange={onClipDirectionChange}
              clipPosition={clipPosition}
              onClipPositionChange={onClipPositionChange}
              clipRange={clipRange}
              clipInverted={clipInverted}
              onToggleClipInverted={onToggleClipInverted}
              onResetClip={onResetClip}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <div
        className="absolute top-4 left-4 z-30 micro-glass rounded-sm p-1 flex max-w-[calc(100%-7rem)] items-center gap-1 overflow-x-auto overscroll-contain scrollbar-hidden"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {CAMERA_ANGLES.map((angle) => (
          <ToolbarButton
            key={angle.key}
            icon={angle.icon}
            label={t(`viewer.camera.${angle.key}`, { defaultValue: angle.label })}
            size={20}
            tooltipSide="bottom"
            active={activeCamera === angle.key}
            onClick={() => onCameraChange(angle.key)}
          />
        ))}
        <div className="h-6 w-px bg-outline-variant/30 mx-0.5" />
        <ToolbarButton
          icon="locate_fixed"
          label={t('viewer.camera.fit')}
          size={20}
          tooltipSide="bottom"
          onClick={dispatchFitModel}
        />
      </div>

      <div
        className="absolute right-3 top-3 bottom-3 z-30 flex min-h-0 flex-col items-end pr-0.5"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="micro-glass rounded-sm p-1 flex min-h-0 max-h-full flex-col items-stretch gap-0.5 overflow-y-auto overscroll-contain scrollbar-hidden origin-top-right">
          {VIEW_MODES.map((mode) => (
            <ToolbarButton
              key={mode.key}
              icon={mode.icon}
              label={t(`viewer.viewMode.${mode.key}`, { defaultValue: mode.label })}
              size={18}
              tooltipSide="left"
              active={activeView === mode.key}
              onClick={() => onViewChange(mode.key)}
            />
          ))}
          <div className="w-full h-px bg-outline-variant/30 my-0.5" />
          <ToolbarButton
            icon="straighten"
            label={t('viewer.toolbar.dimensions')}
            size={18}
            tooltipSide="left"
            active={showDimensions}
            onClick={onToggleDimensions}
          />
          <ToolbarButton
            icon="diamond"
            label={t('viewer.toolbar.edges')}
            size={18}
            tooltipSide="left"
            active={showEdges}
            onClick={onToggleEdges}
          />
          <ToolbarButton
            icon="content_cut"
            label={t('viewer.toolbar.clipView')}
            size={18}
            tooltipSide="left"
            active={clipEnabled}
            onClick={onToggleClip}
          />
          <ToolbarButton
            icon="restart_alt"
            label={t('viewer.toolbar.resetDisplay')}
            size={18}
            tooltipSide="left"
            onClick={onResetDisplay}
          />
          {onFullscreen && (
            <ToolbarButton
              icon="fullscreen"
              label={t('viewer.toolbar.fullscreen')}
              size={18}
              tooltipSide="left"
              onClick={onFullscreen}
            />
          )}
          <div className="w-full h-px bg-outline-variant/30 my-0.5" />
          {onToggleMeasurement && (
            <ToolbarButton
              icon="compass"
              label={t('viewer.toolbar.measurement')}
              size={18}
              tooltipSide="left"
              active={measurementOpen}
              onClick={onToggleMeasurement}
            />
          )}
          <div className="w-full h-px bg-outline-variant/30 my-0.5" />
          {visiblePresets.length <= 1 ? (
            <ToolbarButton
              icon={activeMaterialPreset.icon}
              label={t(`viewer.material.${activeMaterialPreset.key}`, { defaultValue: activeMaterialPreset.label })}
              size={18}
              tooltipSide="left"
              active={materialPreset === activeMaterialPreset.key}
              onClick={() => onMaterialChange(activeMaterialPreset.key)}
            />
          ) : (
            <ToolbarButton
              icon={activeMaterialPreset.icon}
              label={t('viewer.material.label', {
                name: t(`viewer.material.${activeMaterialPreset.key}`, { defaultValue: activeMaterialPreset.label }),
              })}
              size={18}
              tooltipSide="left"
              active={materialMenuOpen}
              onClick={() => setMaterialMenuOpen((open) => !open)}
            />
          )}
          <div className="w-full h-px bg-outline-variant/30 my-0.5" />
          {onScreenshot && (
            <ToolbarButton
              icon="photo_camera"
              label={t('viewer.toolbar.screenshot')}
              size={18}
              tooltipSide="left"
              onClick={onScreenshot}
            />
          )}
          {isAdmin && onSetThumbnail && (
            <ToolbarButton
              icon="wallpaper"
              label={t('viewer.toolbar.setThumbnail')}
              size={18}
              tooltipSide="left"
              disabled={settingThumbnail}
              onClick={onSetThumbnail}
            />
          )}
        </div>

        <div className="pointer-events-none absolute right-full top-0 mr-2 flex max-h-full flex-col items-end gap-2 overflow-y-auto overscroll-contain scrollbar-hidden">
          <AnimatePresence>
            {materialMenuOpen && visiblePresets.length > 1 && (
              <motion.div
                initial={{ opacity: 0, x: 8, scale: 0.96 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 8, scale: 0.96 }}
                className="pointer-events-auto"
              >
                <MaterialPresetMenu
                  presets={visiblePresets}
                  active={materialPreset}
                  onSelect={(preset) => {
                    onMaterialChange(preset);
                    setMaterialMenuOpen(false);
                  }}
                />
              </motion.div>
            )}
            {activeView === 'explode' && onExplodeAmountChange && (
              <motion.div
                initial={{ opacity: 0, x: 8, scale: 0.96 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 8, scale: 0.96 }}
                className="pointer-events-auto"
              >
                <ExplodeControl
                  explodeAmount={explodeAmount}
                  onExplodeAmountChange={onExplodeAmountChange}
                  onResetExplode={onResetExplode}
                />
              </motion.div>
            )}
            {clipEnabled && (
              <motion.div
                initial={{ opacity: 0, x: 8, scale: 0.96 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 8, scale: 0.96 }}
                className="pointer-events-auto"
              >
                <ClipControl
                  clipDirection={clipDirection}
                  onClipDirectionChange={onClipDirectionChange}
                  clipPosition={clipPosition}
                  onClipPositionChange={onClipPositionChange}
                  clipRange={clipRange}
                  clipInverted={clipInverted}
                  onToggleClipInverted={onToggleClipInverted}
                  onResetClip={onResetClip}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </>
  );
}
