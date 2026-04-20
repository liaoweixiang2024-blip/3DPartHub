import { useState, useRef, useCallback, useEffect, useMemo, Suspense } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useMediaQuery } from "../layouts/hooks/useMediaQuery";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import TopNav from "../components/shared/TopNav";
import BottomNav from "../components/shared/BottomNav";
import MobileNavDrawer from "../components/shared/MobileNavDrawer";
import Icon from "../components/shared/Icon";
import Tooltip from "../components/shared/Tooltip";
import { ModelViewer, type ViewMode, type CameraPreset } from "../components/3d";
import LoadingOverlay from "../components/3d/LoadingOverlay";
import { useFavoriteStore, useAuthStore, getAccessToken } from "../stores";
import { useModel } from "../hooks/useModels";
import { modelApi } from "../api/models";
import { categoriesApi, type CategoryItem } from "../api/categories";
import { useToast } from "../components/shared/Toast";
import { getCachedPublicSettings, getSiteTitle } from "../lib/publicSettings";
import type { ModelSpec, ModelDownload } from "../types";
import useSWR from "swr";

interface ModelInfo {
  id: string;
  name: string;
  subtitle: string;
  category: string;
  categoryId?: string;
  specs: ModelSpec[];
  downloads: ModelDownload[];
  dimensions: string;
  modelUrl?: string;
}

const VIEW_MODES: { key: ViewMode; label: string; icon: string }[] = [
  { key: "solid", label: "实体", icon: "deployed_code" },
  { key: "wireframe", label: "线框", icon: "grid_4x4" },
  { key: "transparent", label: "透明", icon: "layers" },
  { key: "explode", label: "爆炸", icon: "zoom_out_map" },
];

const CAMERA_ANGLES: { key: CameraPreset; label: string; icon: string }[] = [
  { key: "front", label: "正视", icon: "square" },
  { key: "side", label: "侧视", icon: "view_sidebar" },
  { key: "iso", label: "等轴测", icon: "view_in_ar" },
  { key: "top", label: "俯视", icon: "crop_free" },
];

const MATERIAL_PRESETS = [
  { key: "default" as const, label: "默认" },
  { key: "metal" as const, label: "金属" },
  { key: "plastic" as const, label: "塑料" },
  { key: "glass" as const, label: "玻璃" },
];

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ViewerPanel({
  modelId,
  isAdmin,
  modelUrl,
  activeView,
  onViewChange,
  activeCamera,
  onCameraChange,
  dimensions,
  showDimensions,
  onToggleDimensions,
  materialPreset,
  onMaterialChange,
  clipEnabled,
  onToggleClip,
  clipPosition,
  onClipPositionChange,
  clipDirection,
  onClipDirectionChange,
  showAxis,
  onToggleAxis,
}: {
  modelId?: string;
  isAdmin?: boolean;
  modelUrl?: string;
  activeView: ViewMode;
  onViewChange: (v: ViewMode) => void;
  activeCamera: CameraPreset;
  onCameraChange: (c: CameraPreset) => void;
  dimensions: string;
  showDimensions: boolean;
  onToggleDimensions: () => void;
  materialPreset: "metal" | "plastic" | "glass" | "default";
  onMaterialChange: (p: "metal" | "plastic" | "glass" | "default") => void;
  clipEnabled: boolean;
  onToggleClip: () => void;
  clipPosition: number;
  onClipPositionChange: (v: number) => void;
  clipDirection: "x" | "y" | "z";
  onClipDirectionChange: (d: "x" | "y" | "z") => void;
  showAxis: boolean;
  onToggleAxis: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [settingThumb, setSettingThumb] = useState(false);
  const [watermark, setWatermark] = useState<{ show: boolean; image: string }>({ show: false, image: "" });
  const { toast } = useToast();

  useEffect(() => {
    getCachedPublicSettings().then(s => {
      setWatermark({ show: !!s.show_watermark, image: (s as any).watermark_image || "" });
    }).catch(() => {});
  }, []);

  const handleScreenshot = useCallback(() => {
    const canvas = containerRef.current?.querySelector("canvas");
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = "model-screenshot.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  }, []);

  const handleSetThumbnail = useCallback(async () => {
    if (!modelId) return;
    const canvas = containerRef.current?.querySelector("canvas") as HTMLCanvasElement | null;
    if (!canvas) return;
    setSettingThumb(true);
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => b ? resolve(b) : reject(new Error("toBlob failed")), "image/png");
      });
      const file = new File([blob], "thumbnail.png", { type: "image/png" });
      await modelApi.uploadThumbnail(modelId, file);
      toast("预览图已更新", "success");
    } catch {
      toast("设置预览图失败", "error");
    } finally {
      setSettingThumb(false);
    }
  }, [modelId, toast]);

  const handleFullscreen = useCallback(() => {
    if (containerRef.current) {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        containerRef.current.requestFullscreen();
      }
    }
  }, []);

  return (
    <div ref={containerRef} className="relative bg-[#1a1a2e] flex-1 md:w-[60%] overflow-hidden border-r border-outline-variant/20 shrink-0" style={{ contain: 'strict' }}>
      <LoadingOverlay />
      <div className="absolute inset-0">
        <Suspense
          fallback={
            <div className="w-full h-full flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <Icon name="view_in_ar" size={48} className="text-on-surface-variant/30 animate-pulse" />
                <span className="text-xs text-on-surface-variant">加载 3D 模型...</span>
              </div>
            </div>
          }
        >
          <ModelViewer
            modelUrl={modelUrl}
            viewMode={activeView}
            cameraPreset={activeCamera}
            showDimensions={showDimensions}
            showGrid={false}
            clipEnabled={clipEnabled}
            clipDirection={clipDirection}
            clipPosition={clipPosition}
            materialPreset={materialPreset}
            showAxis={showAxis}
            onLoaded={() => setLoaded(true)}
          />
        </Suspense>
      </div>

      <div className="absolute top-4 left-4 micro-glass rounded-sm p-1 flex items-center gap-1">
        {CAMERA_ANGLES.map((angle) => (
          <button
            key={angle.key}
            onClick={() => onCameraChange(angle.key)}
            title={angle.label}
            className={`group relative p-2 text-on-surface-variant hover:text-primary transition-colors rounded-sm ${
              activeCamera === angle.key ? "text-primary bg-primary-container/10" : ""
            }`}
          >
            <Icon name={angle.icon} size={20} />
            <span className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-0.5 bg-black/90 text-white text-[10px] rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10">{angle.label}</span>
          </button>
        ))}
      </div>

      <div className="absolute top-4 right-4 flex flex-col gap-2">
        <div className="micro-glass rounded-sm p-1 flex flex-col items-stretch gap-0.5">
          {VIEW_MODES.map((mode) => (
            <button
              key={mode.key}
              onClick={() => onViewChange(mode.key)}
              className={`group relative p-2 text-on-surface-variant hover:text-primary transition-colors rounded-sm ${
                activeView === mode.key ? "text-primary bg-primary-container/10" : ""
              }`}
            >
              <Icon name={mode.icon} size={18} />
              <span className="absolute right-full mr-2 top-1/2 -translate-y-1/2 px-2 py-0.5 bg-black/90 text-white text-[10px] rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10">{mode.label}</span>
            </button>
          ))}
          <div className="w-full h-px bg-outline-variant/30 my-0.5" />
          <button onClick={onToggleDimensions} className={`group relative p-2 text-on-surface-variant hover:text-primary transition-colors rounded-sm ${showDimensions ? "text-primary bg-primary-container/10" : ""}`}>
            <Icon name="straighten" size={18} />
            <span className="absolute right-full mr-2 top-1/2 -translate-y-1/2 px-2 py-0.5 bg-black/90 text-white text-[10px] rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10">尺寸标注</span>
          </button>
          <button onClick={onToggleClip} className={`group relative p-2 text-on-surface-variant hover:text-primary transition-colors rounded-sm ${clipEnabled ? "text-primary bg-primary-container/10" : ""}`}>
            <Icon name="content_cut" size={18} />
            <span className="absolute right-full mr-2 top-1/2 -translate-y-1/2 px-2 py-0.5 bg-black/90 text-white text-[10px] rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10">剖面查看</span>
          </button>
          <button onClick={onToggleAxis} className={`group relative p-2 text-on-surface-variant hover:text-primary transition-colors rounded-sm ${showAxis ? "text-primary bg-primary-container/10" : ""}`}>
            <Icon name="3d_rotation" size={18} />
            <span className="absolute right-full mr-2 top-1/2 -translate-y-1/2 px-2 py-0.5 bg-black/90 text-white text-[10px] rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10">坐标轴</span>
          </button>
          <div className="w-full h-px bg-outline-variant/30 my-0.5" />
          <button onClick={handleScreenshot} className="group relative p-2 text-on-surface-variant hover:text-primary transition-colors">
            <Icon name="photo_camera" size={18} />
            <span className="absolute right-full mr-2 top-1/2 -translate-y-1/2 px-2 py-0.5 bg-black/90 text-white text-[10px] rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10">截图下载</span>
          </button>
          {isAdmin && (
          <button onClick={handleSetThumbnail} disabled={settingThumb} className={`group relative p-2 transition-colors ${settingThumb ? "text-primary animate-pulse" : "text-on-surface-variant hover:text-primary"}`}>
            <Icon name="wallpaper" size={18} />
            <span className="absolute right-full mr-2 top-1/2 -translate-y-1/2 px-2 py-0.5 bg-black/90 text-white text-[10px] rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10">设为预览图</span>
          </button>
          )}
          <button onClick={handleFullscreen} className="group relative p-2 text-on-surface-variant hover:text-primary transition-colors">
            <Icon name="fullscreen" size={18} />
            <span className="absolute right-full mr-2 top-1/2 -translate-y-1/2 px-2 py-0.5 bg-black/90 text-white text-[10px] rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10">全屏</span>
          </button>
        </div>

        <AnimatePresence>
          {clipEnabled && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="micro-glass rounded-sm p-3 flex flex-col gap-2"
            >
              <span className="text-[10px] text-on-surface-variant uppercase tracking-wider">剖面方向</span>
              <div className="flex gap-1">
                {(["x", "y", "z"] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => onClipDirectionChange(d)}
                    className={`flex-1 text-[10px] py-1 rounded-sm transition-colors ${
                      clipDirection === d ? "bg-primary-container/30 text-primary font-bold" : "text-on-surface-variant hover:text-on-surface"
                    }`}
                  >
                    {d.toUpperCase()}
                  </button>
                ))}
              </div>
              <span className="text-[10px] text-on-surface-variant uppercase tracking-wider mt-1">剖面位置</span>
              <input
                type="range"
                min={-2}
                max={2}
                step={0.01}
                value={clipPosition}
                onChange={(e) => onClipPositionChange(parseFloat(e.target.value))}
                className="w-24 accent-primary-container"
              />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="micro-glass rounded-sm p-2 flex flex-col gap-1">
          <span className="text-[9px] text-on-surface-variant uppercase tracking-wider px-1">材质</span>
          {MATERIAL_PRESETS.map((mp) => (
            <button
              key={mp.key}
              onClick={() => onMaterialChange(mp.key)}
              className={`text-[10px] px-2 py-1 rounded-sm transition-colors text-left ${
                materialPreset === mp.key ? "bg-primary-container/20 text-primary" : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              {mp.label}
            </button>
          ))}
        </div>
      </div>

      {watermark.show && watermark.image && (
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center select-none">
          <img
            src={watermark.image}
            alt=""
            className="opacity-[0.04] select-none"
            style={{ maxWidth: "40%", maxHeight: "40%", objectFit: "contain" }}
          />
        </div>
      )}

    </div>
  );
}

function SpecTable({ specs }: { specs: ModelSpec[] }) {
  return (
    <div className="rounded-sm border border-outline-variant/10 overflow-hidden divide-y divide-outline-variant/10">
      {specs.map((spec, i) => (
        <div
          key={spec.label}
          className={`flex items-center justify-between px-4 py-2.5 text-sm ${
            i % 2 === 0 ? "bg-surface-container-lowest" : "bg-surface-container-high"
          }`}
        >
          <span className="text-on-secondary-container">{spec.label}</span>
          <span className="text-on-surface font-medium text-right ml-4 font-mono">{spec.value}</span>
        </div>
      ))}
    </div>
  );
}

function DesktopDetail({
  modelData,
  isFav,
  onToggleFav,
  categoryBreadcrumb,
  onDownload,
}: {
  modelData: ModelInfo;
  isFav: boolean;
  onToggleFav: () => void;
  categoryBreadcrumb: { id: string; name: string }[];
  onDownload: (id: string, format?: string) => void;
}) {
  return (
    <section className="w-full md:w-[40%] md:min-w-[400px] md:max-w-[500px] bg-surface-container-low overflow-hidden flex flex-col shrink-0 min-h-0">
      <div className="p-8 border-b border-outline-variant/10">
        <div className="flex justify-between items-start mb-4">
          <div>
            <div className="flex items-center gap-1.5 text-[11px] tracking-[0.05em] uppercase text-on-surface-variant mb-1.5">
              <Link to="/" className="hover:text-primary transition-colors">模型库</Link>
              {categoryBreadcrumb.map((cat, i) => (
                <span key={cat.id} className="flex items-center gap-1.5">
                  <Icon name="chevron_right" size={12} className="text-on-surface-variant/40" />
                  <Link
                    to={`/?category=${cat.id}`}
                    className={`hover:text-primary transition-colors ${i === categoryBreadcrumb.length - 1 ? "text-primary" : ""}`}
                  >
                    {cat.name}
                  </Link>
                </span>
              ))}
            </div>
            <h1 className="font-headline text-3xl font-bold text-on-surface tracking-tight mb-2">{modelData.name}</h1>
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <button
            onClick={() => onDownload(modelData.id, 'original')}
            className="flex-1 bg-primary-container text-on-primary rounded-sm py-2 px-4 text-sm font-medium hover:bg-primary transition-all active:scale-95 flex items-center justify-center gap-2"
          >
            <Icon name="download" size={18} />
            下载模型
          </button>
          <Tooltip text="收藏">
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={onToggleFav}
              className={`bg-surface-container-high border ${isFav ? "border-primary/50" : "border-outline/40"} hover:border-outline text-on-surface rounded-sm p-2 transition-all flex items-center justify-center`}
            >
              <Icon name={isFav ? "bookmark" : "bookmark_border"} size={20} className={`${isFav ? "text-primary" : ""}`} fill={isFav} />
            </motion.button>
          </Tooltip>
        </div>
      </div>

      <div className="p-8 pb-4">
        <h3 className="text-[11px] tracking-[0.05em] uppercase text-on-surface-variant mb-4 border-b border-outline-variant/20 pb-2">技术规格</h3>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {modelData.specs.map((spec) => (
            <div key={spec.label} className="flex flex-col py-2 border-b border-outline-variant/10">
              <span className="text-xs text-on-secondary-container mb-1">{spec.label}</span>
              <span className="text-sm font-medium text-on-surface">{spec.value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="p-8 pt-4 flex-grow bg-surface-container-low">
        <h3 className="text-[11px] tracking-[0.05em] uppercase text-on-surface-variant mb-4 border-b border-outline-variant/20 pb-2">模型下载</h3>
        <div className="flex flex-col gap-2">
          {modelData.downloads.map((file) => (
            <div key={file.format} className="milled-inset bg-surface-container-lowest p-3 rounded-sm flex items-center justify-between border border-outline-variant/10 hover:border-primary/50 transition-colors group">
              <div className="flex items-center gap-3">
                <Icon name={file.format === "STEP" || file.format === "x_t" ? "deployed_code" : "description"} className="text-on-surface-variant group-hover:text-primary transition-colors" />
                <div>
                  <div className="text-sm font-medium text-on-surface font-mono">{modelData.name}.{file.format.toLowerCase()}</div>
                  <div className="text-[11px] text-on-secondary-container mt-0.5">{file.format} / {file.size}</div>
                </div>
              </div>
              <button
                onClick={() => onDownload(modelData.id, file.downloadFormat === "original" ? "original" : undefined)}
                className="text-primary hover:text-primary-container p-2"
              >
                <Icon name="download" size={20} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-auto border-t border-outline-variant/20 bg-surface-container p-6 space-y-4">
        <Link to="/support" className="flex items-center gap-3 p-3 rounded-sm bg-surface-container-high hover:bg-surface-container-highest transition-colors group">
          <div className="w-10 h-10 rounded-full bg-primary-container/15 flex items-center justify-center shrink-0">
            <Icon name="support_agent" size={20} className="text-primary group-hover:text-on-primary transition-colors" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-on-surface">需要非标定制？</p>
            <p className="text-xs text-on-surface-variant mt-0.5">联系工程师获取专业支持</p>
          </div>
          <Icon name="chevron_right" size={20} className="text-on-surface-variant/40 group-hover:text-on-surface transition-colors" />
        </Link>

        <div className="pt-2 space-y-1.5">
          <p className="text-xs text-on-surface-variant/50 leading-relaxed">
            本平台所有 3D 模型仅供参考与模拟验证，不作为生产加工依据。产品持续迭代更新，请以实物为准。
          </p>
          <p className="text-xs text-on-surface-variant/30">
            © {new Date().getFullYear()} {getSiteTitle()}
          </p>
        </div>
      </div>
    </section>
  );
}

function MobileDetail({
  modelData,
  expandedSpecs,
  onToggleSpecs,
  isFav,
  onToggleFav,
  onBack,
  categoryBreadcrumb,
  onDownload,
}: {
  modelData: ModelInfo;
  expandedSpecs: boolean;
  onToggleSpecs: () => void;
  isFav: boolean;
  onToggleFav: () => void;
  onBack: () => void;
  categoryBreadcrumb: { id: string; name: string }[];
  onDownload: (id: string, format?: string) => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto bg-surface scrollbar-hidden">
      <div className="p-4 space-y-5 pb-20">
        <div>
          <div className="flex items-center justify-between mb-3">
            <button onClick={onBack} className="w-9 h-9 flex items-center justify-center rounded-sm text-on-surface-variant hover:bg-surface-container transition-colors">
              <Icon name="arrow_back" size={24} />
            </button>
            <span className="text-sm font-medium text-on-surface font-headline truncate mx-2">{modelData.name}</span>
            <div className="flex items-center gap-1">
              <motion.button whileTap={{ scale: 0.9 }} onClick={onToggleFav} className="w-9 h-9 flex items-center justify-center rounded-sm text-on-surface-variant hover:bg-surface-container transition-colors">
                <Icon name="star" size={20} className={`${isFav ? "text-primary" : ""}`} fill={isFav} />
              </motion.button>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-on-surface-variant mb-2">
            <Link to="/" className="hover:text-primary transition-colors">模型库</Link>
            {categoryBreadcrumb.map((cat, i) => (
              <span key={cat.id} className="flex items-center gap-1.5">
                <Icon name="chevron_right" size={12} className="text-on-surface-variant/40" />
                <Link
                  to={`/?category=${cat.id}`}
                  className={`hover:text-primary transition-colors ${i === categoryBreadcrumb.length - 1 ? "text-primary" : ""}`}
                >
                  {cat.name}
                </Link>
              </span>
            ))}
          </div>
          <p className="text-sm text-on-surface-variant font-light">{modelData.subtitle}</p>
        </div>

        <div className="rounded-sm border border-outline-variant/10 overflow-hidden">
          <button onClick={onToggleSpecs} className="w-full flex items-center justify-between px-4 py-3 bg-surface-container-low">
            <span className="text-[11px] uppercase tracking-widest text-on-surface-variant font-medium">技术参数</span>
            <motion.span
              animate={{ rotate: expandedSpecs ? 180 : 0 }}
              transition={{ duration: 0.2 }}
            >
              <Icon name="expand_more" size={20} className="text-on-surface-variant" />
            </motion.span>
          </button>
          <AnimatePresence>
            {expandedSpecs && (
              <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
                <SpecTable specs={modelData.specs} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-widest text-on-surface-variant font-medium mb-3">下载文件</div>
          <div className="grid grid-cols-2 gap-2">
            {modelData.downloads.map((file) => (
              <button key={file.format} onClick={() => onDownload(modelData.id, file.downloadFormat === "original" ? "original" : undefined)} className="flex flex-col items-center gap-1.5 p-3 rounded-sm bg-surface-container-low border border-outline-variant/10 hover:bg-surface-container transition-colors active:scale-95">
                <Icon name="download" size={24} className="text-primary-container" fill />
                <span className="text-xs font-medium text-on-surface font-mono">{file.format}</span>
                <span className="text-[11px] text-on-surface-variant">{file.size}</span>
              </button>
            ))}
          </div>
          <button onClick={() => onDownload(modelData.id, 'original')} className="w-full mt-3 py-2.5 rounded-sm bg-primary-container text-on-primary font-medium text-sm hover:bg-primary-container/90 transition-colors flex items-center justify-center gap-2">
            <Icon name="download" size={20} fill />
            下载模型
          </button>
        </div>

        <div className="mt-4 pt-4 border-t border-outline-variant/20 space-y-3">
          <Link to="/support" className="flex items-center gap-3 p-3 rounded-sm bg-surface-container-high hover:bg-surface-container-highest transition-colors group">
            <div className="w-8 h-8 rounded-full bg-primary-container/15 flex items-center justify-center shrink-0">
              <Icon name="support_agent" size={16} className="text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-on-surface">需要非标定制？</p>
              <p className="text-[11px] text-on-surface-variant">联系工程师获取专业支持</p>
            </div>
            <Icon name="chevron_right" size={16} className="text-on-surface-variant/40" />
          </Link>

          <div className="pt-1 space-y-1">
            <p className="text-[11px] text-on-surface-variant/50 leading-relaxed">
              本平台所有 3D 模型仅供参考与模拟验证，不作为生产加工依据。产品持续迭代更新，请以实物为准。
            </p>
            <p className="text-[11px] text-on-surface-variant/30">
              © {new Date().getFullYear()} {getSiteTitle()}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ModelDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  useDocumentTitle();
  const isDesktop = useMediaQuery("(min-width: 768px)");

  const [activeView, setActiveView] = useState<ViewMode>("solid");
  const [activeCamera, setActiveCamera] = useState<CameraPreset>("iso");
  const [expandedSpecs, setExpandedSpecs] = useState(true);
  const [navOpen, setNavOpen] = useState(false);
  const [showDimensions, setShowDimensions] = useState(false);
  const [materialPreset, setMaterialPreset] = useState<"metal" | "plastic" | "glass" | "default">("default");
  const [clipEnabled, setClipEnabled] = useState(false);
  const [clipPosition, setClipPosition] = useState(0);
  const [clipDirection, setClipDirection] = useState<"x" | "y" | "z">("x");
  const [showAxis, setShowAxis] = useState(true);
  const mobileViewerRef = useRef<HTMLDivElement>(null);
  const [settingThumb, setSettingThumb] = useState(false);
  const [watermarkState, setWatermarkState] = useState<{ show: boolean; image: string }>({ show: false, image: "" });
  const [loginPromptOpen, setLoginPromptOpen] = useState(false);
  const { toast } = useToast();

  const handleDownload = useCallback(async (modelId: string, format?: string) => {
    const token = getAccessToken();
    if (!token) {
      setLoginPromptOpen(true);
      return;
    }
    const url = `/api/models/${modelId}/download${format ? `?format=${format}` : ''}`;
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 401) {
        setLoginPromptOpen(true);
        return;
      }
      if (res.status === 429) {
        const data = await res.json().catch(() => null);
        toast(data?.message || data?.detail || '每日下载次数已达上限', 'error');
        return;
      }
      if (!res.ok) {
        toast('下载失败，请稍后重试', 'error');
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get('content-disposition');
      const match = cd?.match(/filename="?(.+?)"?$/);
      const filename = match?.[1] || `${modelId}.${format || 'step'}`;

      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      toast('下载失败，请检查网络', 'error');
    }
  }, [toast, navigate]);

  useEffect(() => {
    getCachedPublicSettings().then(s => {
      setWatermarkState({ show: !!s.show_watermark, image: (s as any).watermark_image || "" });
    }).catch(() => {});
  }, []);

  const handleScreenshot = useCallback(() => {
    const container = mobileViewerRef.current || document.querySelector(".relative.bg-surface-dim");
    const canvas = container?.querySelector("canvas");
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = "model-screenshot.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  }, []);

  const handleSetThumbnail = useCallback(async () => {
    if (!id) return;
    const container = mobileViewerRef.current || document.querySelector(".relative.bg-surface-dim");
    const canvas = container?.querySelector("canvas") as HTMLCanvasElement | null;
    if (!canvas) return;
    setSettingThumb(true);
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => b ? resolve(b) : reject(new Error("toBlob failed")), "image/png");
      });
      const file = new File([blob], "thumbnail.png", { type: "image/png" });
      await modelApi.uploadThumbnail(id, file);
      toast("预览图已更新", "success");
    } catch {
      toast("设置预览图失败", "error");
    } finally {
      setSettingThumb(false);
    }
  }, [id, toast]);

  const handleFullscreen = useCallback(() => {
    const container = mobileViewerRef.current || document.querySelector(".relative.bg-surface-dim");
    if (container) {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        container.requestFullscreen();
      }
    }
  }, []);

  const { isFavorite, toggleFavorite } = useFavoriteStore();

  const { data: serverModel, isLoading, error } = useModel(id);
  const { data: catTreeData } = useSWR("/categories", () => categoriesApi.tree());
  const categoryTree = catTreeData?.items;

  let modelData: ModelInfo | undefined;

  if (serverModel) {
    const format = serverModel.format?.toUpperCase() || "UNKNOWN";
    const name = serverModel.name || serverModel.original_name?.replace(/\.[^.]+$/, "") || "未命名模型";
    modelData = {
      id: serverModel.model_id,
      name,
      subtitle: `${format} 格式 3D 模型`,
      category: serverModel.category || "模型库",
      categoryId: serverModel.category_id || undefined,
      specs: [
        { label: "格式", value: format },
        { label: "文件大小", value: formatFileSize(serverModel.original_size || 0) },
        { label: "状态", value: serverModel.status === "completed" ? "已完成" : serverModel.status },
        { label: "上传时间", value: serverModel.created_at ? new Date(serverModel.created_at).toLocaleString("zh-CN") : "N/A" },
        ...(serverModel.description ? [{ label: "描述", value: serverModel.description }] : []),
      ],
      downloads: [
        { format, size: formatFileSize(serverModel.original_size || 0), downloadFormat: "original" },
      ],
      dimensions: "-",
      modelUrl: serverModel.gltf_url || undefined,
    };
  }

  const fav = modelData ? isFavorite(modelData.id) : false;

  const handleToggleFav = useCallback(async () => {
    if (!modelData) return;
    const wasFav = isFavorite(modelData.id);
    await toggleFavorite({ id: modelData.id, name: modelData.name, subtitle: modelData.subtitle, category: modelData.category, dimensions: modelData.dimensions });
    toast(wasFav ? "已取消收藏" : "已收藏，可在「我的收藏」中批量下载", "success");
  }, [modelData, isFavorite, toggleFavorite, toast]);

  // Resolve category breadcrumb path from tree
  const categoryBreadcrumb = useMemo(() => {
    if (!categoryTree || !modelData) return [];
    const result: { id: string; name: string }[] = [];
    for (const cat of categoryTree) {
      if (cat.id === modelData.categoryId) {
        result.push({ id: cat.id, name: cat.name });
        return result;
      }
      if (cat.children) {
        for (const child of cat.children) {
          if (child.id === modelData.categoryId) {
            result.push({ id: cat.id, name: cat.name });
            result.push({ id: child.id, name: child.name });
            return result;
          }
        }
      }
    }
    if (modelData.category) {
      result.push({ id: modelData.categoryId || "", name: modelData.category });
    }
    return result;
  }, [categoryTree, modelData]);

  if (error) {
    console.error("Model load error:", error);
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-surface gap-4">
        <Icon name="error" size={64} className="text-error" />
        <h1 className="text-2xl font-headline font-bold text-on-surface">加载失败</h1>
        <p className="text-sm text-on-surface-variant">{error?.message || "请稍后重试"}</p>
        <button onClick={() => navigate("/")} className="text-primary hover:underline">返回首页</button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-surface gap-4">
        <Icon name="view_in_ar" size={48} className="text-on-surface-variant animate-pulse" />
        <span className="text-sm text-on-surface-variant">加载中...</span>
      </div>
    );
  }

  if (!modelData) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-surface gap-4">
        <Icon name="search_off" size={64} className="text-on-surface-variant" />
        <h1 className="text-2xl font-headline font-bold text-on-surface">模型不存在</h1>
        <button onClick={() => navigate("/")} className="text-primary hover:underline">返回首页</button>
      </div>
    );
  }

  const viewerProps = {
    modelId: modelData.id,
    isAdmin: useAuthStore.getState().user?.role === "ADMIN",
    modelUrl: modelData.modelUrl,
    activeView,
    onViewChange: setActiveView,
    activeCamera,
    onCameraChange: setActiveCamera,
    dimensions: modelData.dimensions,
    showDimensions,
    onToggleDimensions: () => setShowDimensions(!showDimensions),
    materialPreset,
    onMaterialChange: setMaterialPreset,
    clipEnabled,
    onToggleClip: () => setClipEnabled(!clipEnabled),
    clipPosition,
    onClipPositionChange: setClipPosition,
    clipDirection,
    onClipDirectionChange: setClipDirection,
    showAxis,
    onToggleAxis: () => setShowAxis(!showAxis),
  };

  if (isDesktop) {
    return (
      <div className="fixed inset-0 flex flex-col overflow-hidden">
        <TopNav />
        <main className="flex-1 min-h-0 overflow-hidden flex flex-col md:flex-row">
          <ViewerPanel {...viewerProps} />
          <DesktopDetail
            modelData={modelData}
            isFav={fav}
            onToggleFav={handleToggleFav}
            categoryBreadcrumb={categoryBreadcrumb}
            onDownload={handleDownload}
          />
        </main>
        <AnimatePresence>
          {loginPromptOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm"
              onClick={() => setLoginPromptOpen(false)}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-surface-container-high rounded-lg shadow-2xl p-6 w-80 border border-outline-variant/20"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full bg-primary-container/20 flex items-center justify-center">
                    <Icon name="lock" size={20} className="text-primary-container" />
                  </div>
                  <h3 className="text-lg font-headline font-bold text-on-surface">需要登录</h3>
                </div>
                <p className="text-sm text-on-surface-variant mb-5">下载模型需要先登录账号，是否前往登录？</p>
                <div className="flex gap-3">
                  <button onClick={() => setLoginPromptOpen(false)} className="flex-1 py-2.5 text-sm text-on-surface-variant border border-outline-variant/30 rounded-lg hover:bg-surface-container-highest transition-colors">取消</button>
                  <button onClick={() => { setLoginPromptOpen(false); navigate('/login'); }} className="flex-1 py-2.5 text-sm font-medium text-on-primary bg-primary-container rounded-lg hover:opacity-90 transition-opacity">前往登录</button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-surface">
      <TopNav compact onMenuToggle={() => setNavOpen((prev) => !prev)} />
      <MobileNavDrawer open={navOpen} onClose={() => setNavOpen(false)} />
      <div ref={mobileViewerRef} className="relative h-[50vh] min-h-[280px] max-h-[500px] bg-[#1a1a2e] overflow-hidden">
        <LoadingOverlay />
        <Suspense fallback={<div className="w-full h-full flex items-center justify-center"><Icon name="view_in_ar" size={64} className="text-on-surface-variant/15 animate-pulse" /></div>}>
          <ModelViewer
            modelUrl={modelData.modelUrl}
            viewMode={activeView}
            cameraPreset={activeCamera}
            showDimensions={showDimensions}
            showGrid={false}
            clipEnabled={clipEnabled}
            clipDirection={clipDirection}
            clipPosition={clipPosition}
            materialPreset={materialPreset}
            showAxis={showAxis}
          />
        </Suspense>
        <div className="absolute top-2 left-1/2 -translate-x-1/2 micro-glass rounded-sm p-0.5 flex items-center gap-px">
          {VIEW_MODES.map((mode) => (
            <button
              key={mode.key}
              onClick={() => setActiveView(mode.key)}
              title={mode.label}
              className={`p-1.5 text-on-surface-variant hover:text-primary transition-colors rounded-sm ${
                activeView === mode.key ? "text-primary bg-primary-container/10" : ""
              }`}
            >
              <Icon name={mode.icon} size={14} />
            </button>
          ))}
          <div className="w-px h-3 bg-white/10 mx-px" />
          <Tooltip text="尺寸标注" delay={600}>
            <button onClick={() => setShowDimensions(!showDimensions)} className={`p-1.5 transition-colors rounded-sm ${showDimensions ? "text-primary bg-primary-container/10" : "text-on-surface-variant hover:text-primary"}`}>
              <Icon name="straighten" size={14} />
            </button>
          </Tooltip>
          <Tooltip text="剖面查看" delay={600}>
            <button onClick={() => setClipEnabled(!clipEnabled)} className={`p-1.5 transition-colors rounded-sm ${clipEnabled ? "text-primary bg-primary-container/10" : "text-on-surface-variant hover:text-primary"}`}>
              <Icon name="content_cut" size={14} />
            </button>
          </Tooltip>
          <Tooltip text="坐标轴" delay={600}>
            <button onClick={() => setShowAxis(!showAxis)} className={`p-1.5 transition-colors rounded-sm ${showAxis ? "text-primary bg-primary-container/10" : "text-on-surface-variant hover:text-primary"}`}>
              <Icon name="3d_rotation" size={14} />
            </button>
          </Tooltip>
          <Tooltip text="截图" delay={600}>
            <button onClick={handleScreenshot} className="p-1.5 text-on-surface-variant hover:text-primary transition-colors">
              <Icon name="photo_camera" size={14} />
            </button>
          </Tooltip>
          {useAuthStore.getState().user?.role === "ADMIN" && (
          <Tooltip text="设为预览图" delay={600}>
            <button onClick={handleSetThumbnail} disabled={settingThumb} className={`p-1.5 transition-colors ${settingThumb ? "text-primary animate-pulse" : "text-on-surface-variant hover:text-primary"}`}>
              <Icon name="wallpaper" size={14} />
            </button>
          </Tooltip>
          )}
          <Tooltip text="全屏" delay={600}>
            <button onClick={handleFullscreen} className="p-1.5 text-on-surface-variant hover:text-primary transition-colors">
              <Icon name="fullscreen" size={14} />
            </button>
          </Tooltip>
        </div>
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 micro-glass rounded-sm p-0.5 flex items-center gap-px">
          {CAMERA_ANGLES.map((angle) => (
            <button
              key={angle.key}
              onClick={() => setActiveCamera(angle.key)}
              title={angle.label}
              className={`p-1.5 text-on-surface-variant hover:text-primary transition-colors rounded-sm ${
                activeCamera === angle.key ? "text-primary bg-primary-container/10" : ""
              }`}
            >
              <Icon name={angle.icon} size={14} />
            </button>
          ))}
        </div>
        {clipEnabled && (
          <div className="absolute bottom-12 left-1/2 -translate-x-1/2 micro-glass rounded-sm p-2 flex flex-col gap-1.5 min-w-[140px]">
            <div className="flex gap-1">
              {(["x", "y", "z"] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setClipDirection(d)}
                  className={`flex-1 text-[10px] py-0.5 rounded-sm transition-colors ${
                    clipDirection === d ? "bg-primary-container/30 text-primary font-bold" : "text-on-surface-variant hover:text-on-surface"
                  }`}
                >
                  {d.toUpperCase()}
                </button>
              ))}
            </div>
            <input
              type="range"
              min={-2}
              max={2}
              step={0.01}
              value={clipPosition}
              onChange={(e) => setClipPosition(parseFloat(e.target.value))}
              className="w-full accent-primary-container"
            />
          </div>
        )}
        {watermarkState.show && watermarkState.image && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center select-none">
            <img
              src={watermarkState.image}
              alt=""
              className="opacity-[0.04] select-none"
              style={{ maxWidth: "40%", maxHeight: "40%", objectFit: "contain" }}
            />
          </div>
        )}
      </div>
      <MobileDetail
        modelData={modelData}
        expandedSpecs={expandedSpecs}
        onToggleSpecs={() => setExpandedSpecs(!expandedSpecs)}
        isFav={fav}
        onToggleFav={() => toggleFavorite({ id: modelData.id, name: modelData.name, subtitle: modelData.subtitle, category: modelData.category, dimensions: modelData.dimensions })}
        onBack={() => navigate(-1)}
        categoryBreadcrumb={categoryBreadcrumb}
        onDownload={handleDownload}
      />
      <BottomNav />
      <AnimatePresence>
        {loginPromptOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={() => setLoginPromptOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-surface-container-high rounded-lg shadow-2xl p-6 w-80 border border-outline-variant/20"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-primary-container/20 flex items-center justify-center">
                  <Icon name="lock" size={20} className="text-primary-container" />
                </div>
                <h3 className="text-lg font-headline font-bold text-on-surface">需要登录</h3>
              </div>
              <p className="text-sm text-on-surface-variant mb-5">下载模型需要先登录账号，是否前往登录？</p>
              <div className="flex gap-3">
                <button onClick={() => setLoginPromptOpen(false)} className="flex-1 py-2.5 text-sm text-on-surface-variant border border-outline-variant/30 rounded-lg hover:bg-surface-container-highest transition-colors">取消</button>
                <button onClick={() => { setLoginPromptOpen(false); navigate('/login'); }} className="flex-1 py-2.5 text-sm font-medium text-on-primary bg-primary-container rounded-lg hover:opacity-90 transition-opacity">前往登录</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
