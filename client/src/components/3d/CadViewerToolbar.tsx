import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import Icon from "../shared/Icon";
import type { CameraPreset, ViewMode } from "./ModelViewer";
import { dispatchFitModel } from "./viewerEvents";
import { CAMERA_ANGLES, MATERIAL_PRESETS, VIEW_MODES, type MaterialPresetKey } from "./viewerControls";

interface CadViewerToolbarProps {
  variant: "desktop" | "mobile";
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
  clipDirection: "x" | "y" | "z";
  onClipDirectionChange: (direction: "x" | "y" | "z") => void;
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

function ToolbarButton({
  icon,
  label,
  active,
  disabled,
  size,
  tooltipSide = "left",
  compact = false,
  onClick,
}: {
  icon: string;
  label: string;
  active?: boolean;
  disabled?: boolean;
  size: number;
  tooltipSide?: "left" | "right";
  compact?: boolean;
  onClick: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [tooltipPosition, setTooltipPosition] = useState<{ left: number; top: number } | null>(null);

  const showTooltip = () => {
    if (compact || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setTooltipPosition({
      left: tooltipSide === "right" ? rect.right + 8 : rect.left - 8,
      top: rect.top + rect.height / 2,
    });
  };

  const hideTooltip = () => setTooltipPosition(null);

  return (
    <button
      ref={buttonRef}
      type="button"
      title={label}
      aria-label={label}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      className={`group relative transition-colors rounded-sm disabled:opacity-50 ${
        compact ? "flex h-8 w-8 items-center justify-center p-0" : "p-2"
      } ${
        active
          ? "text-primary bg-primary-container/10"
          : "text-on-surface-variant hover:text-primary"
      }`}
    >
      <Icon name={icon} size={size} className={disabled ? "animate-pulse" : ""} />
      {!compact && tooltipPosition && createPortal(
        <span
          className="fixed z-[300] rounded bg-black/90 px-2 py-0.5 text-[10px] text-white shadow-lg pointer-events-none whitespace-nowrap"
          style={{
            left: tooltipPosition.left,
            top: tooltipPosition.top,
            transform: tooltipSide === "right" ? "translateY(-50%)" : "translate(-100%, -50%)",
          }}
        >
          {label}
        </span>,
        document.body
      )}
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
}: Pick<CadViewerToolbarProps, "clipDirection" | "onClipDirectionChange" | "clipPosition" | "onClipPositionChange" | "clipRange" | "clipInverted" | "onToggleClipInverted" | "onResetClip"> & { compact?: boolean }) {
  const range = clipRange || { min: -2, max: 2, step: 0.01 };
  const labelValue = Math.abs(range.step) >= 1 ? clipPosition.toFixed(0) : clipPosition.toFixed(2);

  return (
    <div
      className={`micro-glass rounded-sm flex flex-col gap-1.5 ${compact ? "p-2 min-w-[144px]" : "p-3"}`}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {!compact && <span className="text-[10px] text-on-surface-variant uppercase tracking-wider">剖面方向</span>}
      <div className="flex gap-1">
        {(["x", "y", "z"] as const).map((direction) => (
          <button
            key={direction}
            type="button"
            onClick={() => onClipDirectionChange(direction)}
            className={`flex-1 text-[10px] rounded-sm transition-colors ${
              compact ? "py-0.5" : "py-1"
            } ${
              clipDirection === direction
                ? "bg-primary-container/30 text-primary font-bold"
                : "text-on-surface-variant hover:text-on-surface"
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
        className={`${compact ? "w-full" : "w-24"} accent-primary-container`}
      />
      {(onToggleClipInverted || onResetClip) && (
        <div className="grid grid-cols-2 gap-1">
          {onToggleClipInverted && (
            <button
              type="button"
              onClick={onToggleClipInverted}
              className={`rounded-sm border px-2 py-1 text-[10px] transition-colors ${
                clipInverted
                  ? "border-primary/40 bg-primary-container/20 text-primary"
                  : "border-outline-variant/20 text-on-surface-variant hover:text-on-surface"
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
      className={`micro-glass rounded-sm flex flex-col gap-1.5 ${compact ? "p-2 min-w-[144px]" : "p-3"}`}
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
        className={`${compact ? "w-full" : "w-24"} accent-primary-container`}
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
    showAxis,
    onToggleAxis,
    measurementOpen,
    onToggleMeasurement,
    propertiesOpen,
    onToggleProperties,
    structureOpen,
    onToggleStructure,
    partCount,
    onResetDisplay,
    tuningOpen,
    onToggleTuning,
    onScreenshot,
    onFullscreen,
    onSetThumbnail,
    settingThumbnail,
    onOpenDiagnostics,
  } = props;

  if (variant === "mobile") {
    return (
      <div
        className="absolute right-2 top-3 bottom-3 z-10 flex items-center"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="micro-glass rounded-sm p-0.5 flex max-h-full flex-col gap-px overflow-y-auto overscroll-contain scrollbar-hidden">
          {onFullscreen && <ToolbarButton compact icon="fullscreen" label="全屏" size={14} onClick={onFullscreen} />}
          <ToolbarButton compact icon="locate_fixed" label="适配视图" size={14} onClick={dispatchFitModel} />
          <ToolbarButton compact icon="restart_alt" label="恢复视角" size={14} onClick={onResetDisplay} />
          <ToolbarButton compact icon="box_icon" label="等轴测" size={14} active={activeCamera === "iso"} onClick={() => onCameraChange("iso")} />
          <ToolbarButton compact icon="diamond" label="实体边线" size={14} active={showEdges} onClick={onToggleEdges} />
          <div className="w-4 h-px bg-white/10 mx-auto" />
          <ToolbarButton compact icon="more_horiz" label="更多" size={14} active={moreOpen} onClick={() => setMoreOpen((open) => !open)} />
        </div>

        {moreOpen && createPortal(
          <>
            <div
              className="fixed inset-0 z-[70]"
              onClick={(event) => {
                event.stopPropagation();
                setMoreOpen(false);
              }}
            />
            <div
              className="fixed right-12 top-1/2 z-[80] grid w-[4.25rem] max-h-[calc(100dvh-14rem)] -translate-y-1/2 grid-cols-2 gap-0.5 overflow-y-auto overscroll-contain rounded-md border border-outline-variant/25 bg-surface/95 p-1 shadow-xl backdrop-blur-xl touch-pan-y"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              style={{ WebkitOverflowScrolling: "touch" }}
            >
              {VIEW_MODES.map((mode) => (
                <ToolbarButton
                  key={mode.key}
                  compact
                  icon={mode.icon}
                  label={mode.label}
                  size={14}
                  active={activeView === mode.key}
                  onClick={() => onViewChange(mode.key)}
                />
              ))}
              <div className="col-span-2 my-0.5 h-px bg-white/10" />
              {CAMERA_ANGLES.filter((angle) => angle.key !== "iso").map((angle) => (
                <ToolbarButton
                  key={angle.key}
                  compact
                  icon={angle.icon}
                  label={angle.label}
                  size={14}
                  active={activeCamera === angle.key}
                  onClick={() => onCameraChange(angle.key)}
                />
              ))}
              <div className="col-span-2 my-0.5 h-px bg-white/10" />
              <ToolbarButton compact icon="straighten" label="尺寸标注" size={14} active={showDimensions} onClick={onToggleDimensions} />
              {onToggleMeasurement && (
                <ToolbarButton compact icon="compass" label="测量工具" size={14} active={measurementOpen} onClick={() => { onToggleMeasurement(); setMoreOpen(false); }} />
              )}
              {onToggleProperties && (
                <ToolbarButton compact icon="description" label="模型属性" size={14} active={propertiesOpen} onClick={() => { onToggleProperties(); setMoreOpen(false); }} />
              )}
              {onToggleStructure && (
                <ToolbarButton compact icon="view_sidebar" label={`模型结构${partCount ? ` ${partCount}` : ""}`} size={14} active={structureOpen} onClick={() => { onToggleStructure(); setMoreOpen(false); }} />
              )}
              <ToolbarButton compact icon="content_cut" label="剖面查看" size={14} active={clipEnabled} onClick={onToggleClip} />
              <ToolbarButton compact icon="3d_rotation" label="视角盒" size={14} active={showAxis} onClick={onToggleAxis} />
              {isAdmin && onToggleTuning && (
                <ToolbarButton compact icon="tune" label="预览调试" size={14} active={tuningOpen} onClick={() => { onToggleTuning(); setMoreOpen(false); }} />
              )}
              <div className="col-span-2 my-0.5 h-px bg-white/10" />
              {MATERIAL_PRESETS.map((preset) => (
                <ToolbarButton
                  key={preset.key}
                  compact
                  icon={preset.icon}
                  label={preset.label}
                  size={14}
                  active={materialPreset === preset.key}
                  onClick={() => onMaterialChange(preset.key)}
                />
              ))}
              <div className="col-span-2 my-0.5 h-px bg-white/10" />
              {onScreenshot && <ToolbarButton compact icon="photo_camera" label="截图下载" size={14} onClick={() => { onScreenshot(); setMoreOpen(false); }} />}
              {isAdmin && onSetThumbnail && (
                <ToolbarButton
                  compact
                  icon="wallpaper"
                  label="设为预览图"
                  size={14}
                  disabled={settingThumbnail}
                  onClick={() => { onSetThumbnail(); setMoreOpen(false); }}
                />
              )}
              {isAdmin && onOpenDiagnostics && (
                <ToolbarButton compact icon="data_usage" label="预览诊断" size={14} onClick={() => { onOpenDiagnostics(); setMoreOpen(false); }} />
              )}
            </div>
          </>,
          document.body
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
        {activeView === "explode" && onExplodeAmountChange && (
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
            tooltipSide="right"
            active={activeCamera === angle.key}
            onClick={() => onCameraChange(angle.key)}
          />
        ))}
        <div className="h-6 w-px bg-outline-variant/30 mx-0.5" />
        <ToolbarButton icon="locate_fixed" label="适配视图" size={20} tooltipSide="right" onClick={dispatchFitModel} />
      </div>

      <div
        className="absolute right-3 top-3 bottom-3 z-30 flex flex-col items-end gap-2 overflow-y-auto overscroll-contain pr-0.5 scrollbar-hidden"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="micro-glass rounded-sm p-1 flex flex-col items-stretch gap-0.5">
          {VIEW_MODES.map((mode) => (
            <ToolbarButton
              key={mode.key}
              icon={mode.icon}
              label={mode.label}
              size={18}
              active={activeView === mode.key}
              onClick={() => onViewChange(mode.key)}
            />
          ))}
          <div className="w-full h-px bg-outline-variant/30 my-0.5" />
          <ToolbarButton icon="straighten" label="尺寸标注" size={18} active={showDimensions} onClick={onToggleDimensions} />
          {onToggleMeasurement && (
            <ToolbarButton icon="compass" label="测量工具" size={18} active={measurementOpen} onClick={onToggleMeasurement} />
          )}
          {onToggleProperties && (
            <ToolbarButton icon="description" label="模型属性" size={18} active={propertiesOpen} onClick={onToggleProperties} />
          )}
          {onToggleStructure && (
            <ToolbarButton icon="view_sidebar" label={`模型结构${partCount ? ` ${partCount}` : ""}`} size={18} active={structureOpen} onClick={onToggleStructure} />
          )}
          <ToolbarButton icon="diamond" label="实体边线" size={18} active={showEdges} onClick={onToggleEdges} />
          <ToolbarButton icon="content_cut" label="剖面查看" size={18} active={clipEnabled} onClick={onToggleClip} />
          <ToolbarButton icon="3d_rotation" label="视角盒" size={18} active={showAxis} onClick={onToggleAxis} />
          <ToolbarButton icon="restart_alt" label="重置显示" size={18} onClick={onResetDisplay} />
          {isAdmin && onToggleTuning && (
            <ToolbarButton icon="tune" label="预览调试" size={18} active={tuningOpen} onClick={onToggleTuning} />
          )}
          <div className="w-full h-px bg-outline-variant/30 my-0.5" />
          {onScreenshot && <ToolbarButton icon="photo_camera" label="截图下载" size={18} onClick={onScreenshot} />}
          {isAdmin && onSetThumbnail && (
            <ToolbarButton icon="wallpaper" label="设为预览图" size={18} disabled={settingThumbnail} onClick={onSetThumbnail} />
          )}
          {isAdmin && onOpenDiagnostics && (
            <ToolbarButton icon="data_usage" label="预览诊断" size={18} onClick={onOpenDiagnostics} />
          )}
          {onFullscreen && <ToolbarButton icon="fullscreen" label="全屏" size={18} onClick={onFullscreen} />}
        </div>

        <AnimatePresence>
          {activeView === "explode" && onExplodeAmountChange && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
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

        <div className="micro-glass rounded-sm p-2 flex flex-col gap-1">
          <span className="text-[9px] text-on-surface-variant uppercase tracking-wider px-1">材质</span>
          {MATERIAL_PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              onClick={() => onMaterialChange(preset.key)}
              className={`text-[10px] px-2 py-1 rounded-sm transition-colors text-left ${
                materialPreset === preset.key
                  ? "bg-primary-container/20 text-primary"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
