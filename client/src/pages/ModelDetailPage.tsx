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
import ModelThumbnail from "../components/shared/ModelThumbnail";
import SafeImage from "../components/shared/SafeImage";
import { useModel } from "../hooks/useModels";
import { modelApi } from "../api/models";
import { categoriesApi, type CategoryItem } from "../api/categories";
import { useToast } from "../components/shared/Toast";
import CategorySelect from "../components/shared/CategorySelect";
import ShareDialog from "../components/shared/ShareDialog";
import { getCachedPublicSettings, getSiteTitle } from "../lib/publicSettings";
import type { ModelSpec, ModelDownload } from "../types";
import useSWR, { mutate as globalMutate } from "swr";

interface ModelVariant {
  model_id: string;
  name: string;
  thumbnail_url: string | null;
  original_name: string;
  original_size: number;
  is_primary: boolean;
  created_at: string;
  file_modified_at: string | null;
}

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
  thumbnailUrl?: string;
  drawingUrl?: string;
  groupId?: string;
  groupName?: string;
  variants?: ModelVariant[];
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
  { key: "iso", label: "等轴测", icon: "box_icon" },
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
  onThumbnailUpdated,
}: {
  modelId?: string;
  isAdmin?: boolean;
  modelUrl?: string;
  activeView: ViewMode;
  onViewChange: (v: ViewMode) => void;
  activeCamera: CameraPreset;
  onCameraChange: (c: CameraPreset) => void;
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
  onThumbnailUpdated?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [, setLoaded] = useState(false);
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
    let ok = false;
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => b ? resolve(b) : reject(new Error("toBlob failed")), "image/png");
      });
      const file = new File([blob], "thumbnail.png", { type: "image/png" });
      await modelApi.uploadThumbnail(modelId, file);
      toast("预览图已更新", "success");
      ok = true;
    } catch {
      toast("设置预览图失败", "error");
    } finally {
      setSettingThumb(false);
    }
    if (ok) onThumbnailUpdated?.();
  }, [modelId, toast, onThumbnailUpdated]);

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
    <div ref={containerRef} className="relative bg-surface-container flex-1 md:w-[60%] overflow-hidden border-r border-outline-variant/20 shrink-0" style={{ contain: 'strict' }}>
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
          <SafeImage
            src={watermark.image}
            alt=""
            className="opacity-[0.04] select-none"
            style={{ maxWidth: "40%", maxHeight: "40%", objectFit: "contain" }}
            fallbackClassName="hidden"
          />
        </div>
      )}

    </div>
  );
}
function DetailEditDialog({ open, modelId, modelName, thumbnailUrl: initialThumb, drawingUrl: initialDrawing, categoryId: initialCat, categories, onClose, onSaved, onDelete }: {
  open: boolean; modelId: string; modelName: string; thumbnailUrl: string | null; drawingUrl: string | null; categoryId?: string | null; categories: CategoryItem[]; onClose: () => void; onSaved: () => void; onDelete?: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(modelName);
  const [catId, setCatId] = useState(initialCat || '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [thumbUploading, setThumbUploading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [thumbUrl, setThumbUrl] = useState(initialThumb);
  const [drawingUploading, setDrawingUploading] = useState(false);
  const [drawingUrl, setDrawingUrl] = useState(initialDrawing);
  const [fileReplacing, setFileReplacing] = useState(false);

  useEffect(() => {
    if (open) { setName(modelName); setCatId(initialCat || ''); setThumbUrl(initialThumb); setDrawingUrl(initialDrawing); }
  }, [open, modelName, initialCat, initialThumb, initialDrawing]);

  if (!open) return null;

  const handleSave = async () => {
    if (!name.trim()) { toast('名称不能为空', 'error'); return; }
    setSaving(true);
    let ok = false;
    try {
      await modelApi.update(modelId, { name: name.trim(), categoryId: catId || null });
      toast('保存成功', 'success');
      ok = true;
    } catch { toast('保存失败', 'error'); } finally { setSaving(false); }
    if (ok) { onSaved(); onClose(); }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-surface-dim/70 backdrop-blur-sm p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] sm:p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-surface-container-low rounded-t-lg sm:rounded-lg shadow-xl border border-outline-variant/20 w-full max-w-md max-h-[calc(100dvh-1.5rem-env(safe-area-inset-bottom,0px))] sm:max-h-[90vh] flex flex-col overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-4 sm:px-6 border-b border-outline-variant/10 shrink-0">
              <h3 className="font-headline text-lg font-semibold text-on-surface">编辑模型</h3>
              <button onClick={onClose} className="p-1 text-on-surface-variant hover:text-on-surface transition-colors"><Icon name="close" size={20} /></button>
            </div>
            <div className="px-4 py-4 sm:px-6 space-y-4 overflow-y-auto scrollbar-hidden">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs uppercase tracking-wider text-on-surface-variant">预览图</label>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="w-16 h-16 rounded-sm bg-surface-container-highest shrink-0 overflow-hidden">
                    <ModelThumbnail src={thumbUrl} alt="" className="w-full h-full object-cover" />
                  </div>
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" id="detail-thumb-upload" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setThumbUploading(true); let ok = false; try { const r = await modelApi.uploadThumbnail(modelId, f); setThumbUrl(r.thumbnail_url); toast('预览图已更新', 'success'); ok = true; } catch { toast('上传失败', 'error'); } finally { setThumbUploading(false); } if (ok) onSaved(); e.target.value = ''; } }} />
                    <button onClick={() => document.getElementById('detail-thumb-upload')?.click()} disabled={thumbUploading} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-sm transition-colors border border-outline-variant/20 disabled:opacity-50"><Icon name="upload" size={14} />{thumbUploading ? '上传中...' : '上传图片'}</button>
                    <button onClick={async () => { setRegenerating(true); let ok = false; try { const r = await modelApi.reconvert(modelId); setThumbUrl(r.thumbnail_url); toast('已重新生成', 'success'); ok = true; } catch { toast('重新生成失败', 'error'); } finally { setRegenerating(false); } if (ok) onSaved(); }} disabled={regenerating} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-sm transition-colors border border-outline-variant/20 disabled:opacity-50"><Icon name="refresh" size={14} />{regenerating ? '生成中...' : '从模型重新生成'}</button>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs uppercase tracking-wider text-on-surface-variant">名称</label>
                <input value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-surface-container-lowest text-on-surface border border-outline-variant/30 focus:border-primary px-3 py-2 text-sm rounded-sm outline-none" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs uppercase tracking-wider text-on-surface-variant">分类</label>
                <CategorySelect categories={categories} value={catId} onChange={setCatId} placeholder="选择分类" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs uppercase tracking-wider text-on-surface-variant">产品图纸 (PDF)</label>
                <div className="flex items-center gap-3">
                  {drawingUrl ? (
                    <div className="flex items-center gap-2 flex-1">
                      <Icon name="description" size={20} className="text-primary shrink-0" />
                      <span className="text-sm text-on-surface truncate flex-1">已上传</span>
                      <a href={drawingUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">查看</a>
                      <button onClick={async () => { let ok = false; try { await modelApi.deleteDrawing(modelId); setDrawingUrl(null); toast('图纸已删除', 'success'); ok = true; } catch { toast('删除失败', 'error'); } if (ok) onSaved(); }} className="text-xs text-error hover:underline">删除</button>
                    </div>
                  ) : (
                    <>
                      <input type="file" accept="application/pdf" className="hidden" id="detail-drawing-upload" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; if (f.type !== 'application/pdf') { toast('仅支持 PDF 格式', 'error'); return; } setDrawingUploading(true); let ok = false; try { const r = await modelApi.uploadDrawing(modelId, f); setDrawingUrl(r.drawing_url); toast('图纸上传成功', 'success'); ok = true; } catch { toast('上传失败', 'error'); } finally { setDrawingUploading(false); } if (ok) onSaved(); e.target.value = ''; }} />
                      <button onClick={() => document.getElementById('detail-drawing-upload')?.click()} disabled={drawingUploading} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-sm transition-colors border border-outline-variant/20 disabled:opacity-50 w-full justify-center">
                        <Icon name="upload_file" size={14} />{drawingUploading ? '上传中...' : '上传 PDF 图纸'}
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="border-t border-outline-variant/20 pt-4 mt-1">
                <label className="text-xs uppercase tracking-wider text-on-surface-variant">替换模型文件</label>
                <p className="text-[10px] text-on-surface-variant/60 mt-1 mb-2">替换后将重新转换，预计耗时 30 秒</p>
                <input type="file" accept=".step,.stp,.iges,.igs,.xt,.x_t" className="hidden" id="detail-replace-file" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; const ext = f.name.split('.').pop()?.toLowerCase() || ''; if (!['step','stp','iges','igs','xt','x_t'].includes(ext)) { toast('仅支持 STEP/IGES/XT 格式', 'error'); return; } setFileReplacing(true); let ok = false; try { await modelApi.replaceFile(modelId, f); toast('文件已上传，正在转换中...', 'success'); ok = true; } catch { toast('替换文件失败', 'error'); } finally { setFileReplacing(false); } if (ok) { onSaved(); onClose(); } e.target.value = ''; }} />
                <button onClick={() => document.getElementById('detail-replace-file')?.click()} disabled={fileReplacing} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-sm transition-colors border border-outline-variant/20 disabled:opacity-50 w-full justify-center">
                  <Icon name="swap_horiz" size={14} />{fileReplacing ? '上传中...' : '选择新模型文件'}
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 border-t border-outline-variant/10 shrink-0">
                {onDelete && (
                  confirmDelete ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-error">确认删除？</span>
                      <button onClick={async () => { setDeleting(true); let ok = false; try { await onDelete(); toast('已删除', 'success'); ok = true; } catch { toast('删除失败', 'error'); } finally { setDeleting(false); setConfirmDelete(false); } if (ok) onClose(); }} disabled={deleting} className="px-3 py-1.5 text-xs bg-error text-white rounded-sm hover:bg-error/90 disabled:opacity-50">{deleting ? '删除中...' : '确认'}</button>
                      <button onClick={() => setConfirmDelete(false)} className="px-3 py-1.5 text-xs text-on-surface-variant hover:text-on-surface">取消</button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmDelete(true)} className="flex items-center gap-1 px-3 py-1.5 text-xs text-on-surface-variant hover:text-error hover:bg-error/10 rounded-sm transition-colors"><Icon name="delete" size={14} />删除模型</button>
                  )
                )}
                <div className="flex gap-3 ml-auto">
                  <button onClick={onClose} className="px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface transition-colors">取消</button>
                  <button onClick={handleSave} disabled={saving} className="px-6 py-2 bg-primary-container text-on-primary rounded-sm text-sm hover:bg-primary transition-colors disabled:opacity-50">{saving ? '保存中...' : '保存'}</button>
                </div>
              </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
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
  isAdmin,
  onToggleFav,
  onEdit,
  onShare,
  categoryBreadcrumb,
  onDownload,
}: {
  modelData: ModelInfo;
  isFav: boolean;
  isAdmin?: boolean;
  onToggleFav: () => void;
  onEdit?: () => void;
  onShare: () => void;
  categoryBreadcrumb: { id: string; name: string }[];
  onDownload: (id: string, format?: string) => void;
}) {
  return (
    <section className="w-full md:w-[40%] md:min-w-[400px] md:max-w-[500px] bg-surface-container-low overflow-y-auto flex flex-col shrink-0 min-h-0">
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
          {isAdmin && onEdit && (
            <button onClick={onEdit} className="p-2 text-on-surface-variant hover:text-primary hover:bg-surface-container-high rounded-sm transition-colors border border-outline-variant/20 shrink-0" title="编辑模型">
              <Icon name="settings" size={20} />
            </button>
          )}
        </div>
        <div className="flex gap-3 mt-6">
          <button
            onClick={() => onDownload(modelData.id, 'original')}
            className="flex-1 bg-primary-container text-on-primary rounded-sm py-2 px-4 text-sm font-medium hover:bg-primary transition-all active:scale-95 flex items-center justify-center gap-2"
          >
            <Icon name="download" size={18} />
            下载模型
          </button>
          <Tooltip text="分享">
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={onShare}
              className="bg-surface-container-high border border-outline/40 hover:border-outline text-on-surface rounded-sm p-2 transition-all flex items-center justify-center"
            >
              <Icon name="share" size={20} />
            </motion.button>
          </Tooltip>
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

      {/* Variant selector */}
      {modelData.variants && modelData.variants.length > 0 && (
        <div className="px-8 pt-4">
          <h3 className="text-[11px] tracking-[0.05em] uppercase text-on-surface-variant mb-4 border-b border-outline-variant/20 pb-2">
            历史版本 ({modelData.variants.length})
          </h3>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {modelData.variants.map((v) => {
              const isCurrent = v.model_id === modelData.id;
              return isCurrent ? (
                <div key={v.model_id} className="shrink-0">
                  <div className="w-20 h-20 rounded-md border-2 border-primary bg-surface-container-lowest overflow-hidden relative">
                    <ModelThumbnail src={v.thumbnail_url} alt="" className="w-full h-full object-cover" />
                    <div className="absolute bottom-0 inset-x-0 bg-primary/90 text-on-primary text-[9px] text-center py-0.5 font-medium">当前</div>
                    {v.is_primary && <div className="absolute top-1 left-1 bg-primary/80 text-on-primary text-[7px] px-1 rounded-sm">主版本</div>}
                  </div>
                  <p className="text-[10px] text-primary mt-1 text-center w-20 truncate" title={v.original_name}>{v.original_name.replace(/\.[^.]+$/, "")}</p>
                  {v.file_modified_at && <p className="text-[9px] text-on-surface-variant/40 text-center">{new Date(v.file_modified_at).toLocaleDateString("zh-CN")}</p>}
                </div>
              ) : (
                <Link key={v.model_id} to={`/model/${v.model_id}`} className="shrink-0 group">
                  <div className="w-20 h-20 rounded-md border border-outline-variant/30 bg-surface-container-lowest overflow-hidden hover:border-primary/50 transition-colors relative">
                    <ModelThumbnail src={v.thumbnail_url} alt="" className="w-full h-full object-cover" />
                    {v.is_primary && <div className="absolute top-1 left-1 bg-primary/80 text-on-primary text-[7px] px-1 rounded-sm">主版本</div>}
                  </div>
                  <p className="text-[10px] text-on-surface-variant group-hover:text-primary mt-1 text-center w-20 truncate" title={v.original_name}>{v.original_name.replace(/\.[^.]+$/, "")}</p>
                  {v.file_modified_at && <p className="text-[9px] text-on-surface-variant/40 text-center">{new Date(v.file_modified_at).toLocaleDateString("zh-CN")}</p>}
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <div className="p-8 pt-4 flex-grow bg-surface-container-low">
        <h3 className="text-[11px] tracking-[0.05em] uppercase text-on-surface-variant mb-4 border-b border-outline-variant/20 pb-2">文件下载</h3>
        <div className="flex flex-col gap-2">
          {modelData.downloads.map((file) => (
            file.downloadFormat === "drawing" ? (
              <a key={file.format} href={modelData.drawingUrl} target="_blank" rel="noreferrer" className="milled-inset bg-surface-container-lowest p-3 rounded-sm flex items-center justify-between border border-outline-variant/10 hover:border-primary/50 transition-colors group cursor-pointer">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-error/10 flex items-center justify-center shrink-0">
                    <span className="text-[10px] font-bold text-error">PDF</span>
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-on-surface truncate">{file.fileName}</div>
                    <div className="text-[11px] text-on-surface-variant mt-0.5">{file.format} · {file.size}</div>
                  </div>
                </div>
                <div className="text-primary hover:text-primary-container p-2">
                  <Icon name="open_in_new" size={20} />
                </div>
              </a>
            ) : (
              <div key={file.format} className="milled-inset bg-surface-container-lowest p-3 rounded-sm flex items-center justify-between border border-outline-variant/10 hover:border-primary/50 transition-colors group">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary-container/10 flex items-center justify-center shrink-0">
                    <span className="text-[10px] font-bold text-primary-container">{file.format.slice(0, 4)}</span>
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-on-surface font-mono truncate">{modelData.name}.{file.format.toLowerCase()}</div>
                    <div className="text-[11px] text-on-surface-variant mt-0.5">{file.format} · {file.size}</div>
                  </div>
                </div>
                <button
                  onClick={() => onDownload(modelData.id, file.downloadFormat === "original" ? "original" : undefined)}
                  className="text-primary hover:text-primary-container p-2"
                >
                  <Icon name="download" size={20} />
                </button>
              </div>
            )
          ))}
        </div>
      </div>

      <div className="mt-auto border-t border-outline-variant/20 bg-surface-container p-6 space-y-4">
        <Link to="/support" state={{ modelName: modelData.name, modelNo: modelData.name, specs: Object.fromEntries(modelData.specs.map(s => [s.label, s.value])), source: 'model' }} className="flex items-center gap-3 p-3 rounded-sm bg-surface-container-high hover:bg-surface-container-highest transition-colors group">
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
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [showMoreTools, setShowMoreTools] = useState(false);
  const mobileViewerRef = useRef<HTMLDivElement>(null);
  const peekContentRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const sheetContentRef = useRef<HTMLDivElement>(null);
  const [peekHeight, setPeekHeight] = useState(120);
  const dragStartY = useRef(0);
  const dragStartScrollTop = useRef(0);
  const dragStartExpanded = useRef(false);
  const isMouseDraggingSheet = useRef(false);
  const [sheetDragOffset, setSheetDragOffset] = useState(0);
  const [settingThumb, setSettingThumb] = useState(false);
  const [watermarkState, setWatermarkState] = useState<{ show: boolean; image: string }>({ show: false, image: "" });
  const [loginPromptOpen, setLoginPromptOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const isAdmin = useAuthStore.getState().user?.role === "ADMIN";
  const { toast } = useToast();

  const handleDownload = useCallback(async (modelId: string, format?: string) => {
    const token = getAccessToken();
    if (!token) {
      setLoginPromptOpen(true);
      return;
    }
    // Direct link — browser handles download, no blob in memory
    const params = new URLSearchParams();
    if (format) params.set("format", format);
    params.set("token", token);
    const a = document.createElement("a");
    a.href = `/api/models/${modelId}/download?${params.toString()}`;
    a.download = "";
    a.click();
  }, []);

  useEffect(() => {
    getCachedPublicSettings().then(s => {
      setWatermarkState({ show: !!s.show_watermark, image: (s as any).watermark_image || "" });
    }).catch(() => {});
  }, []);

  // Measure peek content height for adaptive bottom sheet
  useEffect(() => {
    const measure = () => {
      if (peekContentRef.current) {
        const h = peekContentRef.current.getBoundingClientRect().height;
        if (h > 0) setPeekHeight(Math.ceil(h) + 16); // 8px extra for drag handle padding
      }
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [id]);

  const handleScreenshot = useCallback(() => {
    const container = mobileViewerRef.current || document.querySelector(".relative.bg-surface-dim");
    const canvas = container?.querySelector("canvas");
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = "model-screenshot.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  }, []);

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

  const { data: serverModel, isLoading, error, mutate } = useModel(id);
  const { data: catTreeData } = useSWR("/categories", () => categoriesApi.tree());

  const handleSetThumbnail = useCallback(async () => {
    if (!id) return;
    const container = mobileViewerRef.current || document.querySelector(".relative.bg-surface-dim");
    const canvas = container?.querySelector("canvas") as HTMLCanvasElement | null;
    if (!canvas) return;
    setSettingThumb(true);
    let ok = false;
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => b ? resolve(b) : reject(new Error("toBlob failed")), "image/png");
      });
      const file = new File([blob], "thumbnail.png", { type: "image/png" });
      await modelApi.uploadThumbnail(id, file);
      toast("预览图已更新", "success");
      ok = true;
    } catch {
      toast("设置预览图失败", "error");
    } finally {
      setSettingThumb(false);
    }
    if (ok) { mutate(); globalMutate((k: string) => typeof k === 'string' && k.startsWith('/models')); }
  }, [id, toast, mutate]);
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
        { label: "文件日期", value: new Date(serverModel.file_modified_at || serverModel.created_at).toLocaleDateString("zh-CN") },
        { label: "上传时间", value: serverModel.created_at ? new Date(serverModel.created_at).toLocaleString("zh-CN") : "N/A" },
        ...(serverModel.description ? [{ label: "描述", value: serverModel.description }] : []),
      ],
      downloads: [
        { format, size: formatFileSize(serverModel.original_size || 0), fileName: serverModel.original_name || `${serverModel.name}.${format.toLowerCase()}`, downloadFormat: "original" },
        ...(serverModel.drawing_url ? [{ format: "PDF", size: serverModel.drawing_size ? formatFileSize(serverModel.drawing_size) : "PDF", fileName: serverModel.drawing_name || `${serverModel.name}.pdf`, downloadFormat: "drawing" as const }] : []),
      ],
      dimensions: "-",
      modelUrl: serverModel.gltf_url || undefined,
      thumbnailUrl: serverModel.thumbnail_url || undefined,
      drawingUrl: serverModel.drawing_url || undefined,
      groupId: serverModel.group?.id,
      groupName: serverModel.group?.name,
      variants: serverModel.group?.variants,
    };
  }

  const fav = modelData ? isFavorite(modelData.id) : false;

  const beginSheetDrag = useCallback((clientY: number) => {
    dragStartY.current = clientY;
    dragStartScrollTop.current = sheetContentRef.current?.scrollTop || 0;
    dragStartExpanded.current = sheetExpanded;
    setSheetDragOffset(0);
  }, [sheetExpanded]);

  const moveSheetDrag = useCallback((clientY: number) => {
    const dy = clientY - dragStartY.current;

    if (dragStartExpanded.current) {
      const canCloseFromTop = dragStartScrollTop.current <= 4 && (sheetContentRef.current?.scrollTop || 0) <= 4;
      if (dy > 0 && canCloseFromTop) {
        setSheetDragOffset(Math.min(dy, 180));
        return true;
      }
      return false;
    }

    if (dy < 0) {
      setSheetDragOffset(Math.max(dy, -90));
      return true;
    }

    return false;
  }, []);

  const endSheetDrag = useCallback((clientY: number) => {
    const dy = clientY - dragStartY.current;
    const closeFromTop = dragStartScrollTop.current <= 4;

    if (dragStartExpanded.current && dy > 80 && closeFromTop) {
      setSheetExpanded(false);
    } else if (!dragStartExpanded.current && dy < -50) {
      setSheetExpanded(true);
    }

    setSheetDragOffset(0);
  }, []);

  const handleSheetTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    beginSheetDrag(e.touches[0].clientY);
  }, [beginSheetDrag]);

  const handleSheetTouchEnd = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    endSheetDrag(e.changedTouches[0].clientY);
  }, [endSheetDrag]);

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;

    const handleTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;

      if (moveSheetDrag(touch.clientY)) {
        event.preventDefault();
      }
    };

    sheet.addEventListener("touchmove", handleTouchMove, { passive: false });
    return () => {
      sheet.removeEventListener("touchmove", handleTouchMove);
    };
  }, [moveSheetDrag]);

  const handleSheetMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    isMouseDraggingSheet.current = true;
    beginSheetDrag(e.clientY);

    const handleWindowMouseMove = (event: MouseEvent) => {
      if (!isMouseDraggingSheet.current) return;
      if (moveSheetDrag(event.clientY)) {
        event.preventDefault();
      }
    };

    const handleWindowMouseUp = (event: MouseEvent) => {
      if (!isMouseDraggingSheet.current) return;
      isMouseDraggingSheet.current = false;
      endSheetDrag(event.clientY);
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", handleWindowMouseUp);
    };

    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", handleWindowMouseUp);
  }, [beginSheetDrag, endSheetDrag, moveSheetDrag]);

  const cancelSheetDrag = useCallback(() => {
    isMouseDraggingSheet.current = false;
    setSheetDragOffset(0);
  }, []);

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
      <div className="flex flex-col items-center justify-center h-dvh bg-surface gap-4">
        <Icon name="error" size={64} className="text-error" />
        <h1 className="text-2xl font-headline font-bold text-on-surface">加载失败</h1>
        <p className="text-sm text-on-surface-variant">{error?.message || "请稍后重试"}</p>
        <button onClick={() => navigate("/")} className="text-primary hover:underline">返回首页</button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="h-dvh bg-surface flex items-stretch">
        {/* Sidebar skeleton */}
        <div className="hidden md:block w-64 bg-surface-container-low border-r border-outline-variant/10 p-5 space-y-4 animate-pulse">
          <div className="h-5 bg-surface-container rounded w-3/4" />
          <div className="aspect-square bg-surface-container rounded" />
          <div className="space-y-2">
            <div className="h-3 bg-surface-container rounded w-full" />
            <div className="h-3 bg-surface-container rounded w-5/6" />
            <div className="h-3 bg-surface-container rounded w-2/3" />
          </div>
          <div className="space-y-2">
            <div className="h-8 bg-surface-container rounded" />
            <div className="h-8 bg-surface-container rounded" />
          </div>
        </div>
        {/* Viewer skeleton */}
        <div className="flex-1 bg-surface-dim animate-pulse" />
      </div>
    );
  }

  if (!modelData) {
    return (
      <div className="flex flex-col items-center justify-center h-dvh bg-surface gap-4">
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
          <ViewerPanel {...viewerProps} onThumbnailUpdated={() => { mutate(); globalMutate((k: string) => typeof k === 'string' && k.startsWith('/models')); }} />
          <DesktopDetail
            modelData={modelData}
            isFav={fav}
            isAdmin={isAdmin}
            onToggleFav={handleToggleFav}
            onEdit={() => setEditOpen(true)}
            onShare={() => setShareOpen(true)}
            categoryBreadcrumb={categoryBreadcrumb}
            onDownload={handleDownload}
          />
        </main>
        <DetailEditDialog
          open={editOpen}
          modelId={modelData.id}
          modelName={modelData.name}
          thumbnailUrl={modelData.thumbnailUrl}
          drawingUrl={modelData.drawingUrl}
          categoryId={modelData.categoryId}
          categories={categoryTree || []}
          onClose={() => setEditOpen(false)}
          onSaved={() => { mutate(); globalMutate((k: string) => typeof k === 'string' && k.startsWith('/models')); }}
          onDelete={async () => { await modelApi.delete(modelData.id); navigate('/'); }}
        />
        <ShareDialog
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          modelId={modelData.id}
          modelName={modelData.name}
        />
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
    <div className="flex flex-col h-dvh bg-surface">
      <TopNav compact onMenuToggle={() => setNavOpen((prev) => !prev)} />
      <MobileNavDrawer open={navOpen} onClose={() => setNavOpen(false)} />

      {/* Main area: 3D viewer + bottom sheet */}
      <div
        className="flex-1 min-h-0 relative"
        style={{ marginBottom: "calc(3.5rem + env(safe-area-inset-bottom, 0px))" }}
      >
        {/* 3D Viewer — fills entire area */}
        <div ref={mobileViewerRef} className="absolute inset-0 bg-surface-container overflow-hidden rounded-b-2xl" style={{ bottom: peekHeight }} onClick={() => { if (sheetExpanded) setSheetExpanded(false); }}>
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

          {/* Back button — hidden when sheet is expanded */}
          {!sheetExpanded && (
            <button
              onClick={() => navigate(-1)}
              className="absolute top-2 left-2 z-40 w-8 h-8 flex items-center justify-center rounded-full micro-glass text-on-surface-variant hover:text-on-surface active:scale-90 transition-all"
            >
              <Icon name="arrow_back" size={18} />
            </button>
          )}

          {/* Unified toolbar — right side */}
          <div className="absolute right-2 top-1/2 -translate-y-1/2 z-10">
            <div className="micro-glass rounded-sm p-0.5 flex flex-col gap-px">
              {VIEW_MODES.filter(m => m.key !== "explode").map((mode) => (
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
              <div className="w-4 h-px bg-white/10 mx-auto" />
              {CAMERA_ANGLES.filter(a => a.key === "front" || a.key === "iso").map((angle) => (
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
              <div className="w-4 h-px bg-white/10 mx-auto" />
              <button
                onClick={() => setShowMoreTools(!showMoreTools)}
                title="更多"
                className={`p-1.5 text-on-surface-variant hover:text-primary transition-colors rounded-sm ${showMoreTools ? "text-primary bg-primary-container/10" : ""}`}
              >
                <Icon name="more_horiz" size={14} />
              </button>
            </div>
            {showMoreTools && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowMoreTools(false)} />
                <div className="absolute top-0 right-full mr-1 micro-glass rounded-sm p-0.5 flex flex-col gap-px z-20">
                  <button onClick={() => { setActiveView("explode"); }} className={`p-1.5 transition-colors rounded-sm ${activeView === "explode" ? "text-primary bg-primary-container/10" : "text-on-surface-variant hover:text-primary"}`}>
                    <Icon name={VIEW_MODES[3].icon} size={14} />
                  </button>
                  {CAMERA_ANGLES.filter(a => a.key === "side" || a.key === "top").map((angle) => (
                    <button key={angle.key} onClick={() => { setActiveCamera(angle.key); }} className={`p-1.5 transition-colors rounded-sm ${activeCamera === angle.key ? "text-primary bg-primary-container/10" : "text-on-surface-variant hover:text-primary"}`}>
                      <Icon name={angle.icon} size={14} />
                    </button>
                  ))}
                  <div className="w-4 h-px bg-white/10 mx-auto" />
                  <button onClick={() => { setShowDimensions(!showDimensions); }} className={`p-1.5 transition-colors rounded-sm ${showDimensions ? "text-primary bg-primary-container/10" : "text-on-surface-variant hover:text-primary"}`}>
                    <Icon name="straighten" size={14} />
                  </button>
                  <button onClick={() => { setClipEnabled(!clipEnabled); }} className={`p-1.5 transition-colors rounded-sm ${clipEnabled ? "text-primary bg-primary-container/10" : "text-on-surface-variant hover:text-primary"}`}>
                    <Icon name="content_cut" size={14} />
                  </button>
                  <button onClick={() => { setShowAxis(!showAxis); }} className={`p-1.5 transition-colors rounded-sm ${showAxis ? "text-primary bg-primary-container/10" : "text-on-surface-variant hover:text-primary"}`}>
                    <Icon name="3d_rotation" size={14} />
                  </button>
                  <div className="w-4 h-px bg-white/10 mx-auto" />
                  <button onClick={() => { handleScreenshot(); setShowMoreTools(false); }} className="p-1.5 text-on-surface-variant hover:text-primary transition-colors">
                    <Icon name="photo_camera" size={14} />
                  </button>
                  <button onClick={() => { handleFullscreen(); setShowMoreTools(false); }} className="p-1.5 text-on-surface-variant hover:text-primary transition-colors">
                    <Icon name="fullscreen" size={14} />
                  </button>
                  {useAuthStore.getState().user?.role === "ADMIN" && (
                    <button onClick={() => { handleSetThumbnail(); setShowMoreTools(false); }} disabled={settingThumb} className={`p-1.5 transition-colors ${settingThumb ? "text-primary animate-pulse" : "text-on-surface-variant hover:text-primary"}`}>
                      <Icon name="wallpaper" size={14} />
                    </button>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Clip controls */}
          {clipEnabled && (
            <div className="absolute bottom-2 left-2 micro-glass rounded-sm p-2 flex flex-col gap-1.5 min-w-[130px]">
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

          {/* Watermark */}
          {watermarkState.show && watermarkState.image && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center select-none">
              <SafeImage
                src={watermarkState.image}
                alt=""
                className="opacity-[0.04] select-none"
                style={{ maxWidth: "40%", maxHeight: "40%", objectFit: "contain" }}
                fallbackClassName="hidden"
              />
            </div>
          )}
        </div>

        {/* Bottom sheet */}
        <div
          ref={sheetRef}
          className="absolute bottom-0 left-0 right-0 z-30 bg-surface-container-low rounded-t-2xl shadow-[0_-2px_20px_rgba(0,0,0,0.25)] border-t border-outline-variant/10 flex flex-col overflow-hidden"
          onTouchStart={handleSheetTouchStart}
          onTouchEnd={handleSheetTouchEnd}
          onTouchCancel={cancelSheetDrag}
          onMouseDown={handleSheetMouseDown}
          style={{
            height: sheetExpanded ? '94%' : peekHeight,
            transform: `translateY(${sheetDragOffset}px)`,
            transition: sheetDragOffset === 0
              ? 'height 0.35s cubic-bezier(0.32, 0.72, 0, 1), transform 0.2s ease-out'
              : 'none',
          }}
        >
          {/* Drag handle + back button (when expanded) */}
          <div className="flex items-center gap-2 pt-2.5 pb-1.5 px-3 shrink-0">
            {sheetExpanded && (
              <button
                onClick={() => navigate(-1)}
                className="w-7 h-7 flex items-center justify-center rounded-full text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high active:scale-90 transition-all shrink-0"
              >
                <Icon name="arrow_back" size={18} />
              </button>
            )}
            <div
              onClick={() => setSheetExpanded(!sheetExpanded)}
              className="flex-1 flex justify-center cursor-pointer"
            >
              <div className="w-9 h-1 rounded-full bg-on-surface-variant/25" />
            </div>
            {sheetExpanded && <div className="w-7 shrink-0" />}
          </div>

          {/* Peek bar — always visible */}
          <div ref={peekContentRef} className="px-4 pb-4 shrink-0">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-bold text-on-surface line-clamp-2 break-words">{modelData.name}</h2>
                <p className="text-[11px] text-on-surface-variant truncate">{modelData.subtitle}</p>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                {isAdmin && (
                  <button onClick={() => setEditOpen(true)} className="w-8 h-8 flex items-center justify-center rounded-full text-on-surface-variant hover:text-primary transition-colors">
                    <Icon name="settings" size={18} />
                  </button>
                )}
                <button onClick={() => setShareOpen(true)} className="w-8 h-8 flex items-center justify-center rounded-full text-on-surface-variant hover:text-primary transition-colors">
                  <Icon name="share" size={18} />
                </button>
                <motion.button whileTap={{ scale: 0.9 }} onClick={handleToggleFav} className="w-8 h-8 flex items-center justify-center rounded-full text-on-surface-variant transition-colors">
                  <Icon name={fav ? "star" : "star_border"} size={18} className={fav ? "text-primary" : ""} />
                </motion.button>
              </div>
            </div>
            <button
              onClick={() => handleDownload(modelData.id, 'original')}
              className="w-full mt-2.5 py-2 rounded-lg bg-primary-container text-on-primary text-sm font-medium flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
            >
              <Icon name="download" size={18} />
              下载模型
            </button>
          </div>

          {/* Expanded content — scrollable */}
          <div ref={sheetContentRef} className={`flex-1 min-h-0 overflow-y-auto scrollbar-hidden ${!sheetExpanded ? "hidden" : ""}`}>
            <div className="px-4 pb-8 space-y-5">
              {/* Category breadcrumb */}
              <div className="flex items-center gap-1.5 text-[11px] text-on-surface-variant overflow-x-auto scrollbar-hidden">
                <Link to="/" className="hover:text-primary transition-colors">模型库</Link>
                {categoryBreadcrumb.map((cat, i) => (
                  <span key={cat.id} className="flex items-center gap-1.5 shrink-0">
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

              {/* Specs — collapsible */}
              <div className="rounded-sm border border-outline-variant/10 overflow-hidden">
                <button
                  onClick={() => setExpandedSpecs(!expandedSpecs)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-surface-container-low"
                >
                  <span className="text-[11px] uppercase tracking-widest text-on-surface-variant font-medium">技术参数</span>
                  <motion.span animate={{ rotate: expandedSpecs ? 180 : 0 }} transition={{ duration: 0.2 }}>
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

              {/* Variants */}
              {modelData.variants && modelData.variants.length > 0 && (
                <div>
                  <div className="text-[11px] uppercase tracking-widest text-on-surface-variant font-medium mb-3">
                    历史版本 ({modelData.variants.length})
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                    {modelData.variants.map((v) => {
                      const isCurrent = v.model_id === modelData.id;
                      return isCurrent ? (
                        <div key={v.model_id} className="shrink-0">
                          <div className="w-16 h-16 rounded-md border-2 border-primary bg-surface-container-lowest overflow-hidden relative">
                            <ModelThumbnail src={v.thumbnail_url} alt="" className="w-full h-full object-cover" />
                            <div className="absolute bottom-0 inset-x-0 bg-primary/90 text-on-primary text-[8px] text-center py-0.5">当前</div>
                            {v.is_primary && <div className="absolute top-0.5 left-0.5 bg-primary/80 text-on-primary text-[6px] px-0.5 rounded-sm">主</div>}
                          </div>
                          <p className="text-[9px] text-primary mt-0.5 text-center w-16 truncate" title={v.original_name}>{v.original_name.replace(/\.[^.]+$/, "")}</p>
                          {v.file_modified_at && <p className="text-[8px] text-on-surface-variant/40 text-center">{new Date(v.file_modified_at).toLocaleDateString("zh-CN")}</p>}
                        </div>
                      ) : (
                        <Link key={v.model_id} to={`/model/${v.model_id}`} className="shrink-0">
                          <div className="w-16 h-16 rounded-md border border-outline-variant/30 bg-surface-container-lowest overflow-hidden relative">
                            <ModelThumbnail src={v.thumbnail_url} alt="" className="w-full h-full object-cover" />
                            {v.is_primary && <div className="absolute top-0.5 left-0.5 bg-primary/80 text-on-primary text-[6px] px-0.5 rounded-sm">主</div>}
                          </div>
                          <p className="text-[9px] text-on-surface-variant mt-0.5 text-center w-16 truncate" title={v.original_name}>{v.original_name.replace(/\.[^.]+$/, "")}</p>
                          {v.file_modified_at && <p className="text-[8px] text-on-surface-variant/40 text-center">{new Date(v.file_modified_at).toLocaleDateString("zh-CN")}</p>}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Downloads */}
              <div>
                <div className="text-[11px] uppercase tracking-widest text-on-surface-variant font-medium mb-2">文件下载</div>
                <div className="space-y-1.5">
                  {modelData.downloads.map((file) => (
                    file.downloadFormat === "drawing" ? (
                      <a key={file.format} href={modelData.drawingUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 px-3 py-2 rounded-sm bg-surface-container-low border border-outline-variant/10 hover:bg-surface-container transition-colors">
                        <div className="w-7 h-7 rounded bg-error/10 flex items-center justify-center shrink-0">
                          <span className="text-[8px] font-bold text-error">PDF</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-medium text-on-surface line-clamp-2 break-words" title={file.fileName}>{file.fileName}</span>
                          <span className="text-[10px] text-on-surface-variant">{file.format} · {file.size}</span>
                        </div>
                        <div className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-primary/10 text-primary">
                          <Icon name="open_in_new" size={14} />
                        </div>
                      </a>
                    ) : (
                      <div key={file.format} className="flex items-center gap-2 px-3 py-2.5 rounded-sm bg-surface-container-low border border-outline-variant/10">
                        <div className="w-7 h-7 rounded bg-primary-container/15 flex items-center justify-center shrink-0">
                          <span className="text-[8px] font-bold text-primary-container">{file.format.slice(0, 3)}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-medium text-on-surface line-clamp-2 break-words" title={file.fileName}>{file.fileName || file.format}</span>
                          <span className="text-[10px] text-on-surface-variant">{file.format} · {file.size}</span>
                        </div>
                        <button onClick={() => handleDownload(modelData.id, file.downloadFormat === "original" ? "original" : undefined)} className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-primary/10 hover:bg-primary/20 text-primary active:scale-90 transition-all">
                          <Icon name="download" size={15} />
                        </button>
                      </div>
                    )
                  ))}
                </div>
              </div>

              {/* Support */}
              <div className="pt-2 border-t border-outline-variant/20">
                <Link to="/support" state={{ modelName: modelData.name, modelNo: modelData.name, specs: Object.fromEntries(modelData.specs.map(s => [s.label, s.value])), source: 'model' }} className="flex items-center gap-3 p-3 rounded-sm bg-surface-container-high hover:bg-surface-container-highest transition-colors group">
                  <div className="w-8 h-8 rounded-full bg-primary-container/15 flex items-center justify-center shrink-0">
                    <Icon name="support_agent" size={16} className="text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-on-surface">需要非标定制？</p>
                    <p className="text-[11px] text-on-surface-variant">联系工程师获取专业支持</p>
                  </div>
                  <Icon name="chevron_right" size={16} className="text-on-surface-variant/40" />
                </Link>
                <div className="pt-3 space-y-1">
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
        </div>
      </div>

      <BottomNav />
      <DetailEditDialog
        open={editOpen}
        modelId={modelData.id}
        modelName={modelData.name}
        thumbnailUrl={modelData.thumbnailUrl}
        drawingUrl={modelData.drawingUrl}
        categoryId={modelData.categoryId}
        categories={categoryTree || []}
        onClose={() => setEditOpen(false)}
        onSaved={() => { mutate(); globalMutate((k: string) => typeof k === 'string' && k.startsWith('/models')); }}
        onDelete={async () => { await modelApi.delete(modelData.id); navigate('/'); }}
      />
      <ShareDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        modelId={modelData.id}
        modelName={modelData.name}
      />
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
