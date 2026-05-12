import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect } from 'react';
import { type CategoryItem } from '../../api/categories';
import { openModelDrawing } from '../../api/downloads';
import { modelApi } from '../../api/models';
import CategorySelect from '../shared/CategorySelect';
import DialogOverlay from '../shared/DialogOverlay';
import Icon from '../shared/Icon';
import ModelThumbnail from '../shared/ModelThumbnail';
import { useToast } from '../shared/Toast';

export function DetailEditDialog({
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
        <DialogOverlay
          onClose={onClose}
          zIndex={120}
          backdropClassName="bg-surface-dim/70 backdrop-blur-sm"
          bottomOnMobile
          safeArea
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
        </DialogOverlay>
      )}
    </AnimatePresence>
  );
}
