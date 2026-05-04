import { motion, AnimatePresence } from 'framer-motion';
import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link, useLocation } from 'react-router-dom';
import useSWR, { mutate as globalMutate } from 'swr';
import { categoriesApi, type CategoryItem } from '../api/categories';
import { downloadModelFile, isDownloadAuthRequiredError, openModelDrawing } from '../api/downloads';
import { modelApi, type ModelPreviewMeta } from '../api/models';
import { updateSettings } from '../api/settings';
import type { ViewMode, CameraPreset } from '../components/3d';
import CadViewerPanel from '../components/3d/CadViewerPanel';
import { CAMERA_ANGLES, MATERIAL_PRESETS, VIEW_MODES, type MaterialPresetKey } from '../components/3d/viewerControls';
import { dispatchFitModel } from '../components/3d/viewerEvents';
import { DEFAULT_VIEWER_TUNING, viewerTuningFromSettings, type ViewerTuning } from '../components/3d/viewerTuning';
import CategorySelect from '../components/shared/CategorySelect';
import Icon from '../components/shared/Icon';
import ModelThumbnail from '../components/shared/ModelThumbnail';
import { PublicPageShell } from '../components/shared/PublicPageShell';
import ShareDialog from '../components/shared/ShareDialog';
import { useToast } from '../components/shared/Toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useModel } from '../hooks/useModels';
import { useMediaQuery } from '../layouts/hooks/useMediaQuery';
import { getModelReturnPath, normalizeModelReturnPath } from '../lib/modelReturnPath';
import {
  getCachedPublicSettings,
  getDefaultPreset,
  getPublicSettingsSnapshot,
  getSiteTitle,
  refreshSiteConfig,
} from '../lib/publicSettings';
import { useFavoriteStore, useAuthStore } from '../stores';
import type { ModelSpec, ModelDownload } from '../types';

interface ModelVariant {
  model_id: string;
  name: string;
  thumbnail_url: string | null;
  original_name: string;
  original_size: number;
  is_primary: boolean;
  created_at: string;
  file_modified_at?: string | null;
}

interface ModelInfo {
  id: string;
  name: string;
  subtitle: string;
  format: string;
  fileSize: string;
  createdAtLabel: string;
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
  previewMeta?: ModelPreviewMeta | null;
}

type ViewerDisplayPrefs = {
  activeView: ViewMode;
  activeCamera: CameraPreset;
  showDimensions: boolean;
  materialPreset: MaterialPresetKey;
  showEdges: boolean;
  showAxis: boolean;
};

const VIEWER_DISPLAY_PREFS_KEY = 'model_viewer_display_prefs_v1';

const DEFAULT_VIEWER_DISPLAY_PREFS: ViewerDisplayPrefs = {
  activeView: 'solid',
  activeCamera: 'iso',
  showDimensions: false,
  materialPreset: (getDefaultPreset() as MaterialPresetKey) || 'default',
  showEdges: getPublicSettingsSnapshot().viewer_edge_enabled !== false,
  showAxis: false,
};

type ModelDetailLocationState = {
  from?: string;
  homeBrowseState?: {
    categoryId?: string;
    query?: string;
    page?: number;
    pageSize?: number;
    sort?: string;
    restoreKey?: string;
  } | null;
} | null;

const HOME_SCROLL_TARGET_PREFIX = 'home_model_scroll_target:';
const HOME_BROWSE_STATE_PREFIX = 'home_model_browse_state:';
const HOME_SCROLL_RESTORE_PENDING_KEY = 'home_model_scroll_restore_pending_v1';

function markHomeRestorePending(
  homeBrowseState: NonNullable<ModelDetailLocationState>['homeBrowseState'],
  modelId?: string,
) {
  if (typeof window === 'undefined' || !homeBrowseState?.restoreKey) return;
  try {
    const restoreKey = homeBrowseState.restoreKey;
    window.sessionStorage.setItem(`${HOME_BROWSE_STATE_PREFIX}${restoreKey}`, JSON.stringify(homeBrowseState));
    if (modelId) window.sessionStorage.setItem(`${HOME_SCROLL_TARGET_PREFIX}${restoreKey}`, modelId);
    window.sessionStorage.setItem(HOME_SCROLL_RESTORE_PENDING_KEY, restoreKey);
  } catch {
    // Ignore private browsing or storage quota failures.
  }
}

function getViewerDisplayPrefs(): ViewerDisplayPrefs {
  if (typeof window === 'undefined') return DEFAULT_VIEWER_DISPLAY_PREFS;
  try {
    const raw = window.localStorage.getItem(VIEWER_DISPLAY_PREFS_KEY);
    if (!raw) return DEFAULT_VIEWER_DISPLAY_PREFS;
    const parsed = JSON.parse(raw) as Partial<ViewerDisplayPrefs>;
    const rawView = VIEW_MODES.some((mode) => mode.key === parsed.activeView)
      ? parsed.activeView
      : DEFAULT_VIEWER_DISPLAY_PREFS.activeView;
    const view = rawView === 'solid' ? rawView : DEFAULT_VIEWER_DISPLAY_PREFS.activeView;
    const storedCamera = parsed.activeCamera as CameraPreset | 'side' | undefined;
    const parsedCamera = storedCamera === 'side' ? 'right' : storedCamera;
    const camera = CAMERA_ANGLES.some((angle) => angle.key === parsedCamera)
      ? parsedCamera
      : DEFAULT_VIEWER_DISPLAY_PREFS.activeCamera;
    const material = MATERIAL_PRESETS.some((preset) => preset.key === parsed.materialPreset)
      ? parsed.materialPreset
      : DEFAULT_VIEWER_DISPLAY_PREFS.materialPreset;
    return {
      activeView: view as ViewMode,
      activeCamera: camera as CameraPreset,
      showDimensions:
        typeof parsed.showDimensions === 'boolean'
          ? parsed.showDimensions
          : DEFAULT_VIEWER_DISPLAY_PREFS.showDimensions,
      materialPreset: material as MaterialPresetKey,
      showEdges: DEFAULT_VIEWER_DISPLAY_PREFS.showEdges,
      showAxis: typeof parsed.showAxis === 'boolean' ? parsed.showAxis : DEFAULT_VIEWER_DISPLAY_PREFS.showAxis,
    };
  } catch {
    return DEFAULT_VIEWER_DISPLAY_PREFS;
  }
}

function saveViewerDisplayPrefs(prefs: ViewerDisplayPrefs) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(VIEWER_DISPLAY_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore private browsing or storage quota failures.
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DetailEditDialog({
  open,
  modelId,
  modelName,
  thumbnailUrl: initialThumb,
  drawingUrl: initialDrawing,
  categoryId: initialCat,
  categories,
  onClose,
  onSaved,
  onDelete,
}: {
  open: boolean;
  modelId: string;
  modelName: string;
  thumbnailUrl: string | null;
  drawingUrl: string | null;
  categoryId?: string | null;
  categories: CategoryItem[];
  onClose: () => void;
  onSaved: () => void;
  onDelete?: () => void;
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
    if (open) {
      setName(modelName);
      setCatId(initialCat || '');
      setThumbUrl(initialThumb);
      setDrawingUrl(initialDrawing);
    }
  }, [open, modelName, initialCat, initialThumb, initialDrawing]);

  if (!open) return null;

  const handleSave = async () => {
    if (!name.trim()) {
      toast('名称不能为空', 'error');
      return;
    }
    setSaving(true);
    let ok = false;
    try {
      await modelApi.update(modelId, { name: name.trim(), categoryId: catId || null });
      toast('保存成功', 'success');
      ok = true;
    } catch {
      toast('保存失败', 'error');
    } finally {
      setSaving(false);
    }
    if (ok) {
      onSaved();
      onClose();
    }
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
              <button onClick={onClose} className="p-1 text-on-surface-variant hover:text-on-surface transition-colors">
                <Icon name="close" size={20} />
              </button>
            </div>
            <div className="px-4 py-4 sm:px-6 space-y-4 overflow-y-auto scrollbar-hidden sm:custom-scrollbar">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs uppercase tracking-wider text-on-surface-variant">预览图</label>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="w-16 h-16 rounded-sm bg-surface-container-highest shrink-0 overflow-hidden">
                    <ModelThumbnail src={thumbUrl} alt="" className="w-full h-full object-cover" />
                  </div>
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      id="detail-thumb-upload"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (f) {
                          setThumbUploading(true);
                          let ok = false;
                          try {
                            const r = await modelApi.uploadThumbnail(modelId, f);
                            setThumbUrl(r.thumbnail_url);
                            toast('预览图已更新', 'success');
                            ok = true;
                          } catch {
                            toast('上传失败', 'error');
                          } finally {
                            setThumbUploading(false);
                          }
                          if (ok) onSaved();
                          e.target.value = '';
                        }
                      }}
                    />
                    <button
                      onClick={() => document.getElementById('detail-thumb-upload')?.click()}
                      disabled={thumbUploading}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-sm transition-colors border border-outline-variant/20 disabled:opacity-50"
                    >
                      <Icon name="upload" size={14} />
                      {thumbUploading ? '上传中...' : '上传图片'}
                    </button>
                    <button
                      onClick={async () => {
                        setRegenerating(true);
                        let ok = false;
                        try {
                          const r = await modelApi.reconvert(modelId);
                          setThumbUrl(r.thumbnail_url);
                          toast('已重新生成', 'success');
                          ok = true;
                        } catch {
                          toast('重新生成失败', 'error');
                        } finally {
                          setRegenerating(false);
                        }
                        if (ok) onSaved();
                      }}
                      disabled={regenerating}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-sm transition-colors border border-outline-variant/20 disabled:opacity-50"
                    >
                      <Icon name="refresh" size={14} />
                      {regenerating ? '生成中...' : '从模型重新生成'}
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs uppercase tracking-wider text-on-surface-variant">名称</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-surface-container-lowest text-on-surface border border-outline-variant/30 focus:border-primary px-3 py-2 text-sm rounded-sm outline-none"
                />
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
                      <button
                        type="button"
                        onClick={() => void openModelDrawing(modelId).catch(() => toast('打开图纸失败', 'error'))}
                        className="text-xs text-primary hover:underline"
                      >
                        查看
                      </button>
                      <button
                        onClick={async () => {
                          let ok = false;
                          try {
                            await modelApi.deleteDrawing(modelId);
                            setDrawingUrl(null);
                            toast('图纸已删除', 'success');
                            ok = true;
                          } catch {
                            toast('删除失败', 'error');
                          }
                          if (ok) onSaved();
                        }}
                        className="text-xs text-error hover:underline"
                      >
                        删除
                      </button>
                    </div>
                  ) : (
                    <>
                      <input
                        type="file"
                        accept="application/pdf"
                        className="hidden"
                        id="detail-drawing-upload"
                        onChange={async (e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          if (f.type !== 'application/pdf') {
                            toast('仅支持 PDF 格式', 'error');
                            return;
                          }
                          setDrawingUploading(true);
                          let ok = false;
                          try {
                            const r = await modelApi.uploadDrawing(modelId, f);
                            setDrawingUrl(r.drawing_url);
                            toast('图纸上传成功', 'success');
                            ok = true;
                          } catch {
                            toast('上传失败', 'error');
                          } finally {
                            setDrawingUploading(false);
                          }
                          if (ok) onSaved();
                          e.target.value = '';
                        }}
                      />
                      <button
                        onClick={() => document.getElementById('detail-drawing-upload')?.click()}
                        disabled={drawingUploading}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-sm transition-colors border border-outline-variant/20 disabled:opacity-50 w-full justify-center"
                      >
                        <Icon name="upload_file" size={14} />
                        {drawingUploading ? '上传中...' : '上传 PDF 图纸'}
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="border-t border-outline-variant/20 pt-4 mt-1">
                <label className="text-xs uppercase tracking-wider text-on-surface-variant">替换模型文件</label>
                <p className="text-[10px] text-on-surface-variant/60 mt-1 mb-2">替换后将重新转换，预计耗时 30 秒</p>
                <input
                  type="file"
                  accept=".step,.stp,.iges,.igs,.xt,.x_t"
                  className="hidden"
                  id="detail-replace-file"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const ext = f.name.split('.').pop()?.toLowerCase() || '';
                    if (!['step', 'stp', 'iges', 'igs', 'xt', 'x_t'].includes(ext)) {
                      toast('仅支持 STEP/IGES/XT 格式', 'error');
                      return;
                    }
                    setFileReplacing(true);
                    let ok = false;
                    try {
                      await modelApi.replaceFile(modelId, f);
                      toast('文件已上传，正在转换中...', 'success');
                      ok = true;
                    } catch {
                      toast('替换文件失败', 'error');
                    } finally {
                      setFileReplacing(false);
                    }
                    if (ok) {
                      onSaved();
                      onClose();
                    }
                    e.target.value = '';
                  }}
                />
                <button
                  onClick={() => document.getElementById('detail-replace-file')?.click()}
                  disabled={fileReplacing}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-sm transition-colors border border-outline-variant/20 disabled:opacity-50 w-full justify-center"
                >
                  <Icon name="swap_horiz" size={14} />
                  {fileReplacing ? '上传中...' : '选择新模型文件'}
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 border-t border-outline-variant/10 shrink-0">
              {onDelete &&
                (confirmDelete ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-error">确认删除？</span>
                    <button
                      onClick={async () => {
                        setDeleting(true);
                        let ok = false;
                        try {
                          await onDelete();
                          toast('已删除', 'success');
                          ok = true;
                        } catch {
                          toast('删除失败', 'error');
                        } finally {
                          setDeleting(false);
                          setConfirmDelete(false);
                        }
                        if (ok) onClose();
                      }}
                      disabled={deleting}
                      className="px-3 py-1.5 text-xs bg-error text-white rounded-sm hover:bg-error/90 disabled:opacity-50"
                    >
                      {deleting ? '删除中...' : '确认'}
                    </button>
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="px-3 py-1.5 text-xs text-on-surface-variant hover:text-on-surface"
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs text-on-surface-variant hover:text-error hover:bg-error/10 rounded-sm transition-colors"
                  >
                    <Icon name="delete" size={14} />
                    删除模型
                  </button>
                ))}
              <div className="flex gap-3 ml-auto">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-6 py-2 bg-primary-container text-on-primary rounded-sm text-sm hover:bg-primary transition-colors disabled:opacity-50"
                >
                  {saving ? '保存中...' : '保存'}
                </button>
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
          key={`${spec.label || 'spec'}-${i}`}
          className={`flex items-center justify-between px-4 py-2.5 text-sm ${
            i % 2 === 0 ? 'bg-surface-container-lowest' : 'bg-surface-container-high'
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
  const { toast } = useToast();

  return (
    <section className="w-full md:w-[40%] md:min-w-[400px] md:max-w-[500px] bg-surface-container-low overflow-y-auto flex flex-col shrink-0 min-h-0">
      <div className="p-8 border-b border-outline-variant/10">
        <div className="flex justify-between items-start mb-4">
          <div>
            <div className="flex items-center gap-1.5 text-[11px] tracking-[0.05em] uppercase text-on-surface-variant mb-1.5">
              <Link to="/" className="hover:text-primary transition-colors">
                模型库
              </Link>
              {categoryBreadcrumb.map((cat, i) => (
                <span key={`${cat.id || cat.name || 'category'}-${i}`} className="flex items-center gap-1.5">
                  <Icon name="chevron_right" size={12} className="text-on-surface-variant/40" />
                  <Link
                    to="/"
                    state={{ homeBrowseState: { categoryId: cat.id, page: 1 } }}
                    className={`hover:text-primary transition-colors ${i === categoryBreadcrumb.length - 1 ? 'text-primary' : ''}`}
                  >
                    {cat.name}
                  </Link>
                </span>
              ))}
            </div>
            <h1 className="font-headline text-3xl font-bold text-on-surface tracking-tight mb-2">{modelData.name}</h1>
          </div>
          {isAdmin && onEdit && (
            <button
              onClick={onEdit}
              className="p-2 text-on-surface-variant hover:text-primary hover:bg-surface-container-high rounded-sm transition-colors border border-outline-variant/20 shrink-0"
              aria-label="编辑模型"
              data-tooltip="编辑模型"
              data-tooltip-side="bottom"
            >
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
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={onShare}
            aria-label="分享"
            data-tooltip="分享"
            data-tooltip-side="bottom"
            className="bg-surface-container-high border border-outline/40 hover:border-outline text-on-surface rounded-sm p-2 transition-all flex items-center justify-center"
          >
            <Icon name="share" size={20} />
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={onToggleFav}
            aria-label={isFav ? '取消收藏' : '收藏'}
            data-tooltip={isFav ? '取消收藏' : '收藏'}
            data-tooltip-side="bottom"
            className={`bg-surface-container-high border ${isFav ? 'border-primary/50' : 'border-outline/40'} hover:border-outline text-on-surface rounded-sm p-2 transition-all flex items-center justify-center`}
          >
            <Icon
              name={isFav ? 'bookmark' : 'bookmark_border'}
              size={20}
              className={`${isFav ? 'text-primary' : ''}`}
              fill={isFav}
            />
          </motion.button>
        </div>
      </div>

      <div className="p-8 pb-4">
        <h3 className="text-[11px] tracking-[0.05em] uppercase text-on-surface-variant mb-4 border-b border-outline-variant/20 pb-2">
          技术规格
        </h3>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {modelData.specs.map((spec, index) => (
            <div
              key={`${spec.label || 'spec'}-${index}`}
              className="flex flex-col py-2 border-b border-outline-variant/10"
            >
              <span className="text-xs text-on-secondary-container mb-1">{spec.label}</span>
              <span className="text-sm font-medium text-on-surface">{spec.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Variant selector */}
      {modelData.variants && modelData.variants.length > 1 && (
        <div className="px-8 pt-4">
          <h3 className="text-[11px] tracking-[0.05em] uppercase text-on-surface-variant mb-4 border-b border-outline-variant/20 pb-2">
            历史版本 ({modelData.variants.length})
          </h3>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {modelData.variants.map((v, index) => {
              const isCurrent = v.model_id === modelData.id;
              const variantKey = `${v.model_id || v.original_name || 'variant'}-${index}`;
              return isCurrent ? (
                <div key={variantKey} className="shrink-0">
                  <div className="w-20 h-20 rounded-md border-2 border-primary bg-surface-container-lowest overflow-hidden relative">
                    <ModelThumbnail src={v.thumbnail_url} alt="" className="w-full h-full object-cover" />
                    <div className="absolute bottom-0 inset-x-0 bg-primary/90 text-on-primary text-[9px] text-center py-0.5 font-medium">
                      当前
                    </div>
                    {v.is_primary && (
                      <div className="absolute top-1 left-1 bg-primary/80 text-on-primary text-[7px] px-1 rounded-sm">
                        主版本
                      </div>
                    )}
                  </div>
                  <p className="text-[10px] text-primary mt-1 text-center w-20 truncate" title={v.original_name}>
                    {v.original_name.replace(/\.[^.]+$/, '')}
                  </p>
                  {v.file_modified_at && (
                    <p className="text-[9px] text-on-surface-variant/40 text-center">
                      {new Date(v.file_modified_at).toLocaleDateString('zh-CN')}
                    </p>
                  )}
                </div>
              ) : (
                <Link key={variantKey} to={`/model/${v.model_id}`} className="shrink-0 group">
                  <div className="w-20 h-20 rounded-md border border-outline-variant/30 bg-surface-container-lowest overflow-hidden hover:border-primary/50 transition-colors relative">
                    <ModelThumbnail src={v.thumbnail_url} alt="" className="w-full h-full object-cover" />
                    {v.is_primary && (
                      <div className="absolute top-1 left-1 bg-primary/80 text-on-primary text-[7px] px-1 rounded-sm">
                        主版本
                      </div>
                    )}
                  </div>
                  <p
                    className="text-[10px] text-on-surface-variant group-hover:text-primary mt-1 text-center w-20 truncate"
                    title={v.original_name}
                  >
                    {v.original_name.replace(/\.[^.]+$/, '')}
                  </p>
                  {v.file_modified_at && (
                    <p className="text-[9px] text-on-surface-variant/40 text-center">
                      {new Date(v.file_modified_at).toLocaleDateString('zh-CN')}
                    </p>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <div className="p-8 pt-4 flex-grow bg-surface-container-low">
        <h3 className="text-[11px] tracking-[0.05em] uppercase text-on-surface-variant mb-4 border-b border-outline-variant/20 pb-2">
          文件下载
        </h3>
        <div className="flex flex-col gap-2">
          {modelData.downloads.map((file, index) => {
            const downloadKey = `${file.downloadFormat || file.format || file.fileName || 'download'}-${index}`;
            return file.downloadFormat === 'drawing' ? (
              <button
                key={downloadKey}
                type="button"
                onClick={() => void openModelDrawing(modelData.id).catch(() => toast('打开图纸失败', 'error'))}
                className="milled-inset bg-surface-container-lowest p-3 rounded-sm flex items-center justify-between border border-outline-variant/10 hover:border-primary/50 transition-colors group cursor-pointer text-left"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-9 h-9 rounded-lg bg-error/10 flex items-center justify-center shrink-0">
                    <span className="text-[10px] font-bold text-error">PDF</span>
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-on-surface truncate">{file.fileName}</div>
                    <div className="text-[11px] text-on-surface-variant mt-0.5">
                      {file.format} · {file.size}
                    </div>
                  </div>
                </div>
                <div className="text-primary hover:text-primary-container p-2">
                  <Icon name="open_in_new" size={20} />
                </div>
              </button>
            ) : (
              <div
                key={downloadKey}
                className="milled-inset bg-surface-container-lowest p-3 rounded-sm flex items-center justify-between border border-outline-variant/10 hover:border-primary/50 transition-colors group"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-9 h-9 rounded-lg bg-primary-container/10 flex items-center justify-center shrink-0">
                    <span className="text-[10px] font-bold text-primary-container">{file.format.slice(0, 4)}</span>
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-on-surface font-mono flex min-w-0">
                      <span className="truncate">{modelData.name}</span>
                      <span className="shrink-0 text-on-surface-variant">.{file.format.toLowerCase()}</span>
                    </div>
                    <div className="text-[11px] text-on-surface-variant mt-0.5">
                      {file.format} · {file.size}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => onDownload(modelData.id, file.downloadFormat === 'original' ? 'original' : undefined)}
                  className="text-primary hover:text-primary-container p-2"
                >
                  <Icon name="download" size={20} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-auto border-t border-outline-variant/20 bg-surface-container p-6 space-y-4">
        <Link
          to="/support"
          state={{
            modelName: modelData.name,
            modelNo: modelData.name,
            specs: Object.fromEntries(modelData.specs.map((s) => [s.label, s.value])),
            source: 'model',
          }}
          className="flex items-center gap-3 p-3 rounded-sm bg-surface-container-high hover:bg-surface-container-highest transition-colors group"
        >
          <div className="w-10 h-10 rounded-full bg-primary-container/15 flex items-center justify-center shrink-0">
            <Icon
              name="support_agent"
              size={20}
              className="text-primary group-hover:text-on-primary transition-colors"
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-on-surface">需要非标定制？</p>
            <p className="text-xs text-on-surface-variant mt-0.5">联系工程师获取专业支持</p>
          </div>
          <Icon
            name="chevron_right"
            size={20}
            className="text-on-surface-variant/40 group-hover:text-on-surface transition-colors"
          />
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
  const location = useLocation();
  useDocumentTitle();
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const initialViewerPrefs = useMemo(() => getViewerDisplayPrefs(), []);

  const [activeView, setActiveView] = useState<ViewMode>(initialViewerPrefs.activeView);
  const [activeCamera, setActiveCamera] = useState<CameraPreset>(initialViewerPrefs.activeCamera);
  const [expandedSpecs, setExpandedSpecs] = useState(true);
  const [showDimensions, setShowDimensions] = useState(initialViewerPrefs.showDimensions);
  const [materialPreset, setMaterialPreset] = useState<MaterialPresetKey>(initialViewerPrefs.materialPreset);
  const [showEdges, setShowEdges] = useState(initialViewerPrefs.showEdges);
  const [clipEnabled, setClipEnabled] = useState(false);
  const [clipPosition, setClipPosition] = useState(0);
  const [clipDirection, setClipDirection] = useState<'x' | 'y' | 'z'>('x');
  const [clipInverted, setClipInverted] = useState(false);
  const [showAxis, setShowAxis] = useState(initialViewerPrefs.showAxis);
  const [viewerTuning, setViewerTuning] = useState<ViewerTuning>(DEFAULT_VIEWER_TUNING);
  const [savedViewerTuning, setSavedViewerTuning] = useState<ViewerTuning>(DEFAULT_VIEWER_TUNING);
  const [viewerTuningOpen, setViewerTuningOpen] = useState(false);
  const [viewerTuningSaving, setViewerTuningSaving] = useState(false);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const peekContentRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const sheetContentRef = useRef<HTMLDivElement>(null);
  const [peekHeight, setPeekHeight] = useState(120);
  const dragStartY = useRef(0);
  const dragStartScrollTop = useRef(0);
  const dragStartExpanded = useRef(false);
  const isMouseDraggingSheet = useRef(false);
  const [sheetDragOffset, setSheetDragOffset] = useState(0);
  const [loginPromptOpen, setLoginPromptOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const isAdmin = useAuthStore.getState().user?.role === 'ADMIN';
  const { toast } = useToast();
  const currentPath = `${location.pathname}${location.search}${location.hash}`;
  const detailLocationState = location.state as ModelDetailLocationState;
  const returnPath = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const fromQuery = normalizeModelReturnPath(params.get('from'), currentPath);
    if (fromQuery) return fromQuery;

    const fromState = normalizeModelReturnPath(detailLocationState?.from, currentPath);
    if (fromState) return fromState;

    const storedPath = getModelReturnPath(currentPath);
    if (storedPath) return storedPath;

    if (typeof window === 'undefined' || !document.referrer) return null;
    try {
      const referrer = new URL(document.referrer);
      if (referrer.origin !== window.location.origin) return null;
      return normalizeModelReturnPath(`${referrer.pathname}${referrer.search}${referrer.hash}`, currentPath);
    } catch {
      return null;
    }
  }, [currentPath, detailLocationState?.from, location.search]);

  useEffect(() => {
    markHomeRestorePending(detailLocationState?.homeBrowseState, id);
  }, [detailLocationState?.homeBrowseState, id]);

  useEffect(() => {
    const handlePageHide = () => {
      markHomeRestorePending(detailLocationState?.homeBrowseState, id);
    };
    const handlePopState = () => {
      markHomeRestorePending(detailLocationState?.homeBrowseState, id);
    };
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [detailLocationState?.homeBrowseState, id]);

  const handleBack = useCallback(() => {
    if (returnPath) {
      markHomeRestorePending(detailLocationState?.homeBrowseState, id);
      navigate(
        returnPath,
        detailLocationState?.homeBrowseState
          ? { state: { homeBrowseState: detailLocationState.homeBrowseState } }
          : undefined,
      );
      return;
    }
    const historyIndex = typeof window !== 'undefined' ? window.history.state?.idx : 0;
    if (typeof historyIndex === 'number' && historyIndex > 0) {
      navigate(-1);
      return;
    }
    navigate('/');
  }, [detailLocationState?.homeBrowseState, id, navigate, returnPath]);

  const handleDownload = useCallback(
    async (modelId: string, format?: string) => {
      try {
        await downloadModelFile(modelId, format || 'original');
      } catch (error) {
        if (isDownloadAuthRequiredError(error)) {
          setLoginPromptOpen(true);
          return;
        }
        toast('下载失败，请稍后重试', 'error');
      }
    },
    [toast],
  );

  useEffect(() => {
    getCachedPublicSettings()
      .then((s) => {
        const nextTuning = viewerTuningFromSettings(s as Partial<ViewerTuning>);
        setViewerTuning(nextTuning);
        setSavedViewerTuning(nextTuning);
      })
      .catch(() => {});
  }, []);

  const handleSaveViewerTuning = useCallback(async () => {
    if (!isAdmin) return;
    setViewerTuningSaving(true);
    try {
      const saved = await updateSettings(viewerTuning);
      const nextTuning = viewerTuningFromSettings(saved as Partial<ViewerTuning>);
      setViewerTuning(nextTuning);
      setSavedViewerTuning(nextTuning);
      await refreshSiteConfig();
      toast('3D 预览参数已保存', 'success');
    } catch {
      toast('保存 3D 预览参数失败', 'error');
    } finally {
      setViewerTuningSaving(false);
    }
  }, [isAdmin, toast, viewerTuning]);

  const handleResetViewerTuning = useCallback(() => {
    setViewerTuning(savedViewerTuning);
  }, [savedViewerTuning]);

  useEffect(() => {
    saveViewerDisplayPrefs({
      activeView,
      activeCamera,
      showDimensions,
      materialPreset,
      showEdges,
      showAxis,
    });
  }, [activeView, activeCamera, showDimensions, materialPreset, showEdges, showAxis]);

  const handleResetViewerDisplay = useCallback(() => {
    setActiveView(DEFAULT_VIEWER_DISPLAY_PREFS.activeView);
    setActiveCamera(DEFAULT_VIEWER_DISPLAY_PREFS.activeCamera);
    setShowDimensions(DEFAULT_VIEWER_DISPLAY_PREFS.showDimensions);
    setMaterialPreset(DEFAULT_VIEWER_DISPLAY_PREFS.materialPreset);
    setShowEdges(DEFAULT_VIEWER_DISPLAY_PREFS.showEdges);
    setShowAxis(DEFAULT_VIEWER_DISPLAY_PREFS.showAxis);
    setClipEnabled(false);
    setClipDirection('x');
    setClipPosition(0);
    setClipInverted(false);
    window.setTimeout(dispatchFitModel, 0);
  }, []);

  const { isFavorite, toggleFavorite } = useFavoriteStore();

  const { data: serverModel, isLoading, error, mutate } = useModel(id);
  const { data: catTreeData } = useSWR('/categories', () => categoriesApi.tree());

  const categoryTree = catTreeData?.items;

  let modelData: ModelInfo | undefined;

  if (serverModel) {
    const format = serverModel.format?.toUpperCase() || 'UNKNOWN';
    const name = serverModel.name || serverModel.original_name?.replace(/\.[^.]+$/, '') || '未命名模型';
    const fileSize = formatFileSize(serverModel.original_size || 0);
    const createdAtLabel = serverModel.created_at ? new Date(serverModel.created_at).toLocaleString('zh-CN') : 'N/A';
    modelData = {
      id: serverModel.model_id,
      name,
      subtitle: `${format} 格式 3D 模型`,
      format,
      fileSize,
      createdAtLabel,
      category: serverModel.category || '模型库',
      categoryId: serverModel.category_id || undefined,
      specs: [
        { label: '格式', value: format },
        { label: '文件大小', value: fileSize },
        {
          label: '文件日期',
          value: new Date(serverModel.file_modified_at || serverModel.created_at).toLocaleDateString('zh-CN'),
        },
        { label: '上传时间', value: createdAtLabel },
        ...(serverModel.description ? [{ label: '描述', value: serverModel.description }] : []),
      ],
      downloads: [
        {
          format,
          size: fileSize,
          fileName: serverModel.original_name || `${serverModel.name}.${format.toLowerCase()}`,
          downloadFormat: 'original',
        },
        ...(serverModel.drawing_url
          ? [
              {
                format: 'PDF',
                size: serverModel.drawing_size ? formatFileSize(serverModel.drawing_size) : 'PDF',
                fileName: serverModel.drawing_name || `${serverModel.name}.pdf`,
                downloadFormat: 'drawing' as const,
              },
            ]
          : []),
      ],
      dimensions: '-',
      modelUrl: serverModel.gltf_url || undefined,
      thumbnailUrl: serverModel.thumbnail_url || undefined,
      drawingUrl: serverModel.drawing_url || undefined,
      groupId: serverModel.group?.id,
      groupName: serverModel.group?.name,
      variants: serverModel.group?.variants,
      previewMeta: serverModel.preview_meta || null,
    };
  }

  const fav = modelData ? isFavorite(modelData.id) : false;

  // Measure peek content height after model data and fonts/layout settle.
  useEffect(() => {
    const content = peekContentRef.current;
    if (!content) return;

    let rafId = 0;
    const measure = () => {
      window.cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(() => {
        const h = content.getBoundingClientRect().height;
        if (h > 0) {
          setPeekHeight(Math.max(128, Math.ceil(h) + 16));
        }
      });
    };

    measure();
    const timeoutId = window.setTimeout(measure, 250);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(content);
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(timeoutId);
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, [id, modelData?.id, modelData?.name, modelData?.subtitle, isAdmin, fav]);

  const beginSheetDrag = useCallback(
    (clientY: number) => {
      dragStartY.current = clientY;
      dragStartScrollTop.current = sheetContentRef.current?.scrollTop || 0;
      dragStartExpanded.current = sheetExpanded;
      setSheetDragOffset(0);
    },
    [sheetExpanded],
  );

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

  const handleSheetTouchStart = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      beginSheetDrag(e.touches[0].clientY);
    },
    [beginSheetDrag],
  );

  const handleSheetTouchEnd = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      endSheetDrag(e.changedTouches[0].clientY);
    },
    [endSheetDrag],
  );

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

    sheet.addEventListener('touchmove', handleTouchMove, { passive: false });
    return () => {
      sheet.removeEventListener('touchmove', handleTouchMove);
    };
  }, [moveSheetDrag]);

  const handleSheetMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
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
        window.removeEventListener('mousemove', handleWindowMouseMove);
        window.removeEventListener('mouseup', handleWindowMouseUp);
      };

      window.addEventListener('mousemove', handleWindowMouseMove);
      window.addEventListener('mouseup', handleWindowMouseUp);
    },
    [beginSheetDrag, endSheetDrag, moveSheetDrag],
  );

  const cancelSheetDrag = useCallback(() => {
    isMouseDraggingSheet.current = false;
    setSheetDragOffset(0);
  }, []);

  const handleToggleFav = useCallback(async () => {
    if (!modelData) return;
    const wasFav = isFavorite(modelData.id);
    await toggleFavorite({
      id: modelData.id,
      name: modelData.name,
      subtitle: modelData.subtitle,
      category: modelData.category,
      dimensions: modelData.dimensions,
    });
    toast(wasFav ? '已取消收藏' : '已收藏，可在「我的收藏」中批量下载', 'success');
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
      result.push({ id: modelData.categoryId || '', name: modelData.category });
    }
    return result;
  }, [categoryTree, modelData]);

  if (error) {
    if (import.meta.env.DEV) console.error('Model load error:', error);
    return (
      <div className="flex flex-col items-center justify-center h-dvh bg-surface gap-4">
        <Icon name="error" size={64} className="text-error" />
        <h1 className="text-2xl font-headline font-bold text-on-surface">加载失败</h1>
        <p className="text-sm text-on-surface-variant">{error?.message || '请稍后重试'}</p>
        <button onClick={handleBack} className="text-primary hover:underline">
          返回上一页
        </button>
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
        <button onClick={handleBack} className="text-primary hover:underline">
          返回上一页
        </button>
      </div>
    );
  }

  const viewerProps = {
    modelId: modelData.id,
    modelName: modelData.name,
    modelFormat: modelData.format,
    modelFileSize: modelData.fileSize,
    modelCreatedAt: modelData.createdAtLabel,
    isAdmin: useAuthStore.getState().user?.role === 'ADMIN',
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
    showEdges,
    onToggleEdges: () => setShowEdges(!showEdges),
    clipEnabled,
    onToggleClip: () => setClipEnabled((enabled) => !enabled),
    clipPosition,
    onClipPositionChange: setClipPosition,
    clipDirection,
    onClipDirectionChange: setClipDirection,
    clipInverted,
    onToggleClipInverted: () => setClipInverted((inverted) => !inverted),
    onResetClip: () => {
      setClipDirection('x');
      setClipPosition(0);
      setClipInverted(false);
    },
    showAxis,
    onToggleAxis: () => setShowAxis(!showAxis),
    onResetDisplay: handleResetViewerDisplay,
    tuningOpen: viewerTuningOpen,
    onToggleTuning: () => setViewerTuningOpen((prev) => !prev),
    viewerTuning,
    previewMeta: modelData.previewMeta,
    onViewerTuningChange: setViewerTuning,
    onApplyViewerPreset: setViewerTuning,
    onResetViewerTuning: handleResetViewerTuning,
    onSaveViewerTuning: handleSaveViewerTuning,
    viewerTuningSaving,
  };

  if (isDesktop) {
    return (
      <PublicPageShell className="fixed inset-0 flex flex-col overflow-hidden">
        <main className="flex-1 min-h-0 overflow-hidden flex flex-col md:flex-row">
          <CadViewerPanel
            variant="desktop"
            {...viewerProps}
            showBackButton
            onBack={handleBack}
            onThumbnailUpdated={() => {
              mutate();
              globalMutate((k: string) => typeof k === 'string' && k.startsWith('/models'));
            }}
          />
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
          thumbnailUrl={modelData.thumbnailUrl ?? null}
          drawingUrl={modelData.drawingUrl ?? null}
          categoryId={modelData.categoryId}
          categories={categoryTree || []}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            mutate();
            globalMutate((k: string) => typeof k === 'string' && k.startsWith('/models'));
          }}
          onDelete={async () => {
            await modelApi.delete(modelData.id);
            handleBack();
          }}
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
                  <button
                    onClick={() => setLoginPromptOpen(false)}
                    className="flex-1 py-2.5 text-sm text-on-surface-variant border border-outline-variant/30 rounded-lg hover:bg-surface-container-highest transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={() => {
                      setLoginPromptOpen(false);
                      navigate('/login');
                    }}
                    className="flex-1 py-2.5 text-sm font-medium text-on-primary bg-primary-container rounded-lg hover:opacity-90 transition-opacity"
                  >
                    前往登录
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </PublicPageShell>
    );
  }

  return (
    <PublicPageShell mobileClassName="flex flex-col h-dvh bg-surface" keepMobileDrawerMounted>
      {/* Main area: 3D viewer + bottom sheet */}
      <div
        className="flex-1 min-h-0 relative"
        style={{ marginBottom: 'calc(3.5rem + env(safe-area-inset-bottom, 0px))' }}
      >
        <CadViewerPanel
          variant="mobile"
          {...viewerProps}
          style={{ bottom: peekHeight }}
          onClick={() => {
            if (sheetExpanded) setSheetExpanded(false);
          }}
          showBackButton={!sheetExpanded}
          onBack={handleBack}
          onThumbnailUpdated={() => {
            mutate();
            globalMutate((k: string) => typeof k === 'string' && k.startsWith('/models'));
          }}
        />

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
            transition:
              sheetDragOffset === 0 ? 'height 0.35s cubic-bezier(0.32, 0.72, 0, 1), transform 0.2s ease-out' : 'none',
          }}
        >
          {/* Drag handle + back button (when expanded) */}
          <div className="flex items-center gap-2 pt-2.5 pb-1.5 px-3 shrink-0">
            {sheetExpanded && (
              <button
                onClick={handleBack}
                className="w-7 h-7 flex items-center justify-center rounded-full text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high active:scale-90 transition-all shrink-0"
              >
                <Icon name="arrow_back" size={18} />
              </button>
            )}
            <div onClick={() => setSheetExpanded(!sheetExpanded)} className="flex-1 flex justify-center cursor-pointer">
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
                  <button
                    onClick={() => setEditOpen(true)}
                    aria-label="编辑模型"
                    className="w-8 h-8 flex items-center justify-center rounded-full text-on-surface-variant hover:text-primary transition-colors"
                  >
                    <Icon name="settings" size={18} />
                  </button>
                )}
                <button
                  onClick={() => setShareOpen(true)}
                  aria-label="分享"
                  className="w-8 h-8 flex items-center justify-center rounded-full text-on-surface-variant hover:text-primary transition-colors"
                >
                  <Icon name="share" size={18} />
                </button>
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={handleToggleFav}
                  aria-label={fav ? '取消收藏' : '收藏'}
                  className="w-8 h-8 flex items-center justify-center rounded-full text-on-surface-variant transition-colors"
                >
                  <Icon name={fav ? 'star' : 'star_border'} size={18} className={fav ? 'text-primary' : ''} />
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
          <div
            ref={sheetContentRef}
            className={`flex-1 min-h-0 overflow-y-auto scrollbar-hidden ${!sheetExpanded ? 'hidden' : ''}`}
          >
            <div className="px-4 pb-8 space-y-5">
              {/* Category breadcrumb */}
              <div className="flex items-center gap-1.5 text-[11px] text-on-surface-variant overflow-x-auto scrollbar-hidden">
                <Link to="/" className="hover:text-primary transition-colors">
                  模型库
                </Link>
                {categoryBreadcrumb.map((cat, i) => (
                  <span key={`${cat.id || cat.name || 'category'}-${i}`} className="flex items-center gap-1.5 shrink-0">
                    <Icon name="chevron_right" size={12} className="text-on-surface-variant/40" />
                    <Link
                      to="/"
                      state={{ homeBrowseState: { categoryId: cat.id, page: 1 } }}
                      className={`hover:text-primary transition-colors ${i === categoryBreadcrumb.length - 1 ? 'text-primary' : ''}`}
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
                  <span className="text-[11px] uppercase tracking-widest text-on-surface-variant font-medium">
                    技术参数
                  </span>
                  <motion.span animate={{ rotate: expandedSpecs ? 180 : 0 }} transition={{ duration: 0.2 }}>
                    <Icon name="expand_more" size={20} className="text-on-surface-variant" />
                  </motion.span>
                </button>
                <AnimatePresence>
                  {expandedSpecs && (
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: 'auto' }}
                      exit={{ height: 0 }}
                      className="overflow-hidden"
                    >
                      <SpecTable specs={modelData.specs} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Variants */}
              {modelData.variants && modelData.variants.length > 1 && (
                <div>
                  <div className="text-[11px] uppercase tracking-widest text-on-surface-variant font-medium mb-3">
                    历史版本 ({modelData.variants.length})
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                    {modelData.variants.map((v, index) => {
                      const isCurrent = v.model_id === modelData.id;
                      const variantKey = `${v.model_id || v.original_name || 'variant'}-${index}`;
                      return isCurrent ? (
                        <div key={variantKey} className="shrink-0">
                          <div className="w-16 h-16 rounded-md border-2 border-primary bg-surface-container-lowest overflow-hidden relative">
                            <ModelThumbnail src={v.thumbnail_url} alt="" className="w-full h-full object-cover" />
                            <div className="absolute bottom-0 inset-x-0 bg-primary/90 text-on-primary text-[8px] text-center py-0.5">
                              当前
                            </div>
                            {v.is_primary && (
                              <div className="absolute top-0.5 left-0.5 bg-primary/80 text-on-primary text-[6px] px-0.5 rounded-sm">
                                主
                              </div>
                            )}
                          </div>
                          <p
                            className="text-[9px] text-primary mt-0.5 text-center w-16 truncate"
                            title={v.original_name}
                          >
                            {v.original_name.replace(/\.[^.]+$/, '')}
                          </p>
                          {v.file_modified_at && (
                            <p className="text-[8px] text-on-surface-variant/40 text-center">
                              {new Date(v.file_modified_at).toLocaleDateString('zh-CN')}
                            </p>
                          )}
                        </div>
                      ) : (
                        <Link key={variantKey} to={`/model/${v.model_id}`} className="shrink-0">
                          <div className="w-16 h-16 rounded-md border border-outline-variant/30 bg-surface-container-lowest overflow-hidden relative">
                            <ModelThumbnail src={v.thumbnail_url} alt="" className="w-full h-full object-cover" />
                            {v.is_primary && (
                              <div className="absolute top-0.5 left-0.5 bg-primary/80 text-on-primary text-[6px] px-0.5 rounded-sm">
                                主
                              </div>
                            )}
                          </div>
                          <p
                            className="text-[9px] text-on-surface-variant mt-0.5 text-center w-16 truncate"
                            title={v.original_name}
                          >
                            {v.original_name.replace(/\.[^.]+$/, '')}
                          </p>
                          {v.file_modified_at && (
                            <p className="text-[8px] text-on-surface-variant/40 text-center">
                              {new Date(v.file_modified_at).toLocaleDateString('zh-CN')}
                            </p>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Downloads */}
              <div>
                <div className="text-[11px] uppercase tracking-widest text-on-surface-variant font-medium mb-2">
                  文件下载
                </div>
                <div className="space-y-1.5">
                  {modelData.downloads.map((file, index) => {
                    const downloadKey = `${file.downloadFormat || file.format || file.fileName || 'download'}-${index}`;
                    return file.downloadFormat === 'drawing' ? (
                      <button
                        key={downloadKey}
                        type="button"
                        onClick={() => void openModelDrawing(modelData.id).catch(() => toast('打开图纸失败', 'error'))}
                        className="flex items-center gap-2.5 px-3 py-2 rounded-sm bg-surface-container-low border border-outline-variant/10 hover:bg-surface-container transition-colors text-left"
                      >
                        <div className="w-7 h-7 rounded bg-error/10 flex items-center justify-center shrink-0">
                          <span className="text-[8px] font-bold text-error">PDF</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <span
                            className="text-xs font-medium text-on-surface line-clamp-2 break-words"
                            title={file.fileName}
                          >
                            {file.fileName}
                          </span>
                          <span className="text-[10px] text-on-surface-variant">
                            {file.format} · {file.size}
                          </span>
                        </div>
                        <div className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-primary/10 text-primary">
                          <Icon name="open_in_new" size={14} />
                        </div>
                      </button>
                    ) : (
                      <div
                        key={downloadKey}
                        className="flex items-center gap-2 px-3 py-2.5 rounded-sm bg-surface-container-low border border-outline-variant/10"
                      >
                        <div className="w-7 h-7 rounded bg-primary-container/15 flex items-center justify-center shrink-0">
                          <span className="text-[8px] font-bold text-primary-container">{file.format.slice(0, 3)}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-on-surface flex min-w-0">
                            <span className="truncate">{file.fileName || file.format}</span>
                          </div>
                          <span className="text-[10px] text-on-surface-variant">
                            {file.format} · {file.size}
                          </span>
                        </div>
                        <button
                          onClick={() =>
                            handleDownload(modelData.id, file.downloadFormat === 'original' ? 'original' : undefined)
                          }
                          className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-primary/10 hover:bg-primary/20 text-primary active:scale-90 transition-all"
                        >
                          <Icon name="download" size={15} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Support */}
              <div className="pt-2 border-t border-outline-variant/20">
                <Link
                  to="/support"
                  state={{
                    modelName: modelData.name,
                    modelNo: modelData.name,
                    specs: Object.fromEntries(modelData.specs.map((s) => [s.label, s.value])),
                    source: 'model',
                  }}
                  className="flex items-center gap-3 p-3 rounded-sm bg-surface-container-high hover:bg-surface-container-highest transition-colors group"
                >
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
      <DetailEditDialog
        open={editOpen}
        modelId={modelData.id}
        modelName={modelData.name}
        thumbnailUrl={modelData.thumbnailUrl ?? null}
        drawingUrl={modelData.drawingUrl ?? null}
        categoryId={modelData.categoryId}
        categories={categoryTree || []}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          mutate();
          globalMutate((k: string) => typeof k === 'string' && k.startsWith('/models'));
        }}
        onDelete={async () => {
          await modelApi.delete(modelData.id);
          globalMutate(
            (k: string) => typeof k === 'string' && k.includes('/models/infinite'),
            (pages: any[] | undefined) => {
              if (!pages) return pages;
              return pages.map((p: any) => ({
                ...p,
                items: p.items?.filter((m: any) => m.id !== modelData.id),
                total: Math.max(0, (p.total ?? 0) - (p.items?.some((m: any) => m.id === modelData.id) ? 1 : 0)),
              }));
            },
            false,
          );
          await Promise.all([
            globalMutate('/models/count'),
            globalMutate(
              (k: string) => typeof k === 'string' && (k.startsWith('/categories') || k.includes('/categories')),
            ),
          ]);
          handleBack();
        }}
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
                <button
                  onClick={() => setLoginPromptOpen(false)}
                  className="flex-1 py-2.5 text-sm text-on-surface-variant border border-outline-variant/30 rounded-lg hover:bg-surface-container-highest transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    setLoginPromptOpen(false);
                    navigate('/login');
                  }}
                  className="flex-1 py-2.5 text-sm font-medium text-on-primary bg-primary-container rounded-lg hover:opacity-90 transition-opacity"
                >
                  前往登录
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </PublicPageShell>
  );
}
