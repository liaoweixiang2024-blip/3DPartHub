import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { createPortal } from 'react-dom';
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
  const range = clipRange || { min: -2, max: 2, step: 0.01 };
  const labelValue = Math.abs(range.step) >= 1 ? clipPosition.toFixed(0) : clipPosition.toFixed(2);

  return (
    <div
      className={`micro-glass rounded-sm flex flex-col gap-1.5 ${compact ? 'p-2 min-w-[144px]' : 'p-3'}`}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {!compact && <span className="text-[10px] text-on-surface-variant uppercase tracking-wider">剖面方向</span>}
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
        {!compact && <span className="text-[10px] text-on-surface-variant uppercase tracking-wider">剖面位置</span>}
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
              反向
            </button>
          )}
          {onResetClip && (
            <button
              type="button"
              onClick={onResetClip}
              className="rounded-sm border border-outline-variant/20 px-2 py-1 text-[10px] text-on-surface-variant transition-colors hover:text-on-surface"
            >
              归中
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
  return (
    <div
      className={`micro-glass rounded-sm flex flex-col gap-1.5 ${compact ? 'p-2 min-w-[144px]' : 'p-3'}`}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-2">
        {!compact && <span className="text-[10px] text-on-surface-variant uppercase tracking-wider">爆炸比例</span>}
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
        aria-label="爆炸比例"
      />
      <button
        type="button"
        onClick={onResetExplode}
        className="rounded-sm border border-outline-variant/20 px-2 py-1 text-[10px] text-on-surface-variant transition-colors hover:text-on-surface"
      >
        恢复
      </button>
    </div>
  );
}

function ListMenuItem({
  icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: string;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      className={`flex w-full items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-left text-xs transition-colors disabled:opacity-50 ${
        active ? 'bg-primary-container/12 text-primary font-medium' : 'text-on-surface hover:bg-surface-container-high'
      }`}
    >
      <Icon name={icon} size={16} className={active ? 'text-primary' : 'text-on-surface-variant'} />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

function ListSectionDivider() {
  return <div className="my-1 h-px bg-outline-variant/15" />;
}

function ToolbarSectionLabel({ children }: { children: string }) {
  return (
    <div className="px-2 pt-1 pb-0.5 text-[10px] font-semibold tracking-[0.08em] uppercase text-on-surface-variant/60">
      {children}
    </div>
  );
}

export default function CadViewerToolbar(props: CadViewerToolbarProps) {
  const [moreOpen, setMoreOpen] = useState(false);
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

  if (variant === 'mobile') {
    return (
      <div
        className="absolute right-2 top-3 bottom-3 z-10 flex items-center"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="micro-glass rounded-sm p-0.5 flex max-h-full flex-col gap-px overflow-y-auto overscroll-contain scrollbar-hidden">
          {onFullscreen && (
            <ToolbarButton compact icon="fullscreen" label="全屏" size={14} tooltipSide="left" onClick={onFullscreen} />
          )}
          <ToolbarButton
            compact
            icon="locate_fixed"
            label="适配视图"
            size={14}
            tooltipSide="left"
            onClick={dispatchFitModel}
          />
          <ToolbarButton
            compact
            icon="restart_alt"
            label="恢复视角"
            size={14}
            tooltipSide="left"
            onClick={onResetDisplay}
          />
          <ToolbarButton
            compact
            icon="box_icon"
            label="等轴测"
            size={14}
            tooltipSide="left"
            active={activeCamera === 'iso'}
            onClick={() => onCameraChange('iso')}
          />
          <ToolbarButton
            compact
            icon="diamond"
            label="实体边线"
            size={14}
            tooltipSide="left"
            active={showEdges}
            onClick={onToggleEdges}
          />
          <div className="w-4 h-px bg-white/10 mx-auto" />
          <ToolbarButton
            compact
            icon="more_horiz"
            label="更多"
            size={14}
            tooltipSide="left"
            active={moreOpen}
            onClick={() => setMoreOpen((open) => !open)}
          />
        </div>

        {moreOpen &&
          createPortal(
            <>
              <div
                className="fixed inset-0 z-[70]"
                onClick={(event) => {
                  event.stopPropagation();
                  setMoreOpen(false);
                }}
              />
              <div
                className="fixed right-12 top-1/2 z-[80] max-h-[calc(100dvh-8rem)] w-[10.5rem] -translate-y-1/2 overflow-y-auto overscroll-contain rounded-md border border-outline-variant/25 bg-surface/95 py-1.5 shadow-xl backdrop-blur-xl touch-pan-y custom-scrollbar"
                onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                style={{ WebkitOverflowScrolling: 'touch' }}
              >
                <ToolbarSectionLabel>显示</ToolbarSectionLabel>
                {VIEW_MODES.map((mode) => (
                  <ListMenuItem
                    key={mode.key}
                    icon={mode.icon}
                    label={mode.label}
                    active={activeView === mode.key}
                    onClick={() => onViewChange(mode.key)}
                  />
                ))}
                <ListSectionDivider />
                <ToolbarSectionLabel>视角</ToolbarSectionLabel>
                {CAMERA_ANGLES.filter((angle) => angle.key !== 'iso').map((angle) => (
                  <ListMenuItem
                    key={angle.key}
                    icon={angle.icon}
                    label={angle.label}
                    active={activeCamera === angle.key}
                    onClick={() => onCameraChange(angle.key)}
                  />
                ))}
                <ListSectionDivider />
                <ToolbarSectionLabel>工具</ToolbarSectionLabel>
                <ListMenuItem icon="straighten" label="尺寸标注" active={showDimensions} onClick={onToggleDimensions} />
                {onToggleMeasurement && (
                  <ListMenuItem
                    icon="compass"
                    label="测量工具"
                    active={measurementOpen}
                    onClick={() => {
                      onToggleMeasurement();
                      setMoreOpen(false);
                    }}
                  />
                )}
                <ListMenuItem icon="content_cut" label="剖面查看" active={clipEnabled} onClick={onToggleClip} />
                <ListSectionDivider />
                <ToolbarSectionLabel>材质</ToolbarSectionLabel>
                {getVisiblePresets().map((preset) => (
                  <ListMenuItem
                    key={preset.key}
                    icon={preset.icon}
                    label={preset.label}
                    active={materialPreset === preset.key}
                    onClick={() => onMaterialChange(preset.key)}
                  />
                ))}
                <ListSectionDivider />
                <ToolbarSectionLabel>输出</ToolbarSectionLabel>
                {onScreenshot && (
                  <ListMenuItem
                    icon="photo_camera"
                    label="截图下载"
                    onClick={() => {
                      onScreenshot();
                      setMoreOpen(false);
                    }}
                  />
                )}
                {isAdmin && onSetThumbnail && (
                  <ListMenuItem
                    icon="wallpaper"
                    label="设为预览图"
                    disabled={settingThumbnail}
                    onClick={() => {
                      onSetThumbnail();
                      setMoreOpen(false);
                    }}
                  />
                )}
              </div>
            </>,
            document.body,
          )}

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
        {activeView === 'explode' && onExplodeAmountChange && (
          <div className="absolute top-0 right-full mr-1 z-20">
            <ExplodeControl
              compact
              explodeAmount={explodeAmount}
              onExplodeAmountChange={onExplodeAmountChange}
              onResetExplode={onResetExplode}
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
            label={angle.label}
            size={20}
            tooltipSide="bottom"
            active={activeCamera === angle.key}
            onClick={() => onCameraChange(angle.key)}
          />
        ))}
        <div className="h-6 w-px bg-outline-variant/30 mx-0.5" />
        <ToolbarButton icon="locate_fixed" label="适配视图" size={20} tooltipSide="bottom" onClick={dispatchFitModel} />
      </div>

      <div
        className="absolute right-3 top-3 bottom-3 z-30 flex flex-col items-end pr-0.5"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="micro-glass rounded-sm p-1 flex flex-col items-stretch gap-0.5 origin-top-right">
          {VIEW_MODES.map((mode) => (
            <ToolbarButton
              key={mode.key}
              icon={mode.icon}
              label={mode.label}
              size={18}
              tooltipSide="left"
              active={activeView === mode.key}
              onClick={() => onViewChange(mode.key)}
            />
          ))}
          <div className="w-full h-px bg-outline-variant/30 my-0.5" />
          <ToolbarButton
            icon="straighten"
            label="尺寸标注"
            size={18}
            tooltipSide="left"
            active={showDimensions}
            onClick={onToggleDimensions}
          />
          <ToolbarButton
            icon="diamond"
            label="实体边线"
            size={18}
            tooltipSide="left"
            active={showEdges}
            onClick={onToggleEdges}
          />
          <ToolbarButton
            icon="content_cut"
            label="剖面查看"
            size={18}
            tooltipSide="left"
            active={clipEnabled}
            onClick={onToggleClip}
          />
          <ToolbarButton icon="restart_alt" label="重置显示" size={18} tooltipSide="left" onClick={onResetDisplay} />
          {onFullscreen && (
            <ToolbarButton icon="fullscreen" label="全屏" size={18} tooltipSide="left" onClick={onFullscreen} />
          )}
          <div className="w-full h-px bg-outline-variant/30 my-0.5" />
          {onToggleMeasurement && (
            <ToolbarButton
              icon="compass"
              label="测量工具"
              size={18}
              tooltipSide="left"
              active={measurementOpen}
              onClick={onToggleMeasurement}
            />
          )}
          <div className="w-full h-px bg-outline-variant/30 my-0.5" />
          {getVisiblePresets().map((preset) => (
            <ToolbarButton
              key={preset.key}
              icon={preset.icon}
              label={preset.label}
              size={18}
              tooltipSide="left"
              active={materialPreset === preset.key}
              onClick={() => onMaterialChange(preset.key)}
            />
          ))}
          <div className="w-full h-px bg-outline-variant/30 my-0.5" />
          {onScreenshot && (
            <ToolbarButton icon="photo_camera" label="截图下载" size={18} tooltipSide="left" onClick={onScreenshot} />
          )}
          {isAdmin && onSetThumbnail && (
            <ToolbarButton
              icon="wallpaper"
              label="设为预览图"
              size={18}
              tooltipSide="left"
              disabled={settingThumbnail}
              onClick={onSetThumbnail}
            />
          )}
        </div>

        <AnimatePresence>
          {activeView === 'explode' && onExplodeAmountChange && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="mt-2"
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
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="mt-2"
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
    </>
  );
}
