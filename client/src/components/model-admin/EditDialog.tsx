import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { type CategoryItem } from '../../api/categories';
import { openModelDrawing } from '../../api/downloads';
import { modelApi, type ServerModelListItem } from '../../api/models';
import CategorySelect from '../../components/shared/CategorySelect';
import DialogOverlay from '../../components/shared/DialogOverlay';
import Icon from '../../components/shared/Icon';
import ModelThumbnail from '../../components/shared/ModelThumbnail';
import { useToast } from '../../components/shared/Toast';
import { MODEL_SOURCE_ACCEPT, MODEL_SOURCE_FORMATS, MODEL_SOURCE_LABEL } from './shared';

export default function EditDialog({
  open,
  model,
  categories,
  onClose,
  onSaved,
}: {
  open: boolean;
  model: ServerModelListItem | null;
  categories: CategoryItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [thumbnailUploading, setThumbnailUploading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [drawingUploading, setDrawingUploading] = useState(false);
  const [drawingUrl, setDrawingUrl] = useState<string | null>(null);
  const [fileReplacing, setFileReplacing] = useState(false);

  useEffect(() => {
    if (model) {
      setName(model.name || '');
      setDescription('');
      setCategoryId(model.category_id || '');
      setThumbnailUrl(model.thumbnail_url);
      setDrawingUrl(model.drawing_url || null);
    }
  }, [model]);

  if (!open || !model) return null;

  const handleSave = async () => {
    if (!name.trim()) {
      toast('名称不能为空', 'error');
      return;
    }
    setSaving(true);
    let ok = false;
    try {
      await modelApi.update(model.model_id, {
        name: name.trim(),
        description: description.trim() || undefined,
        categoryId: categoryId || null,
      });
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

  const handleThumbnailUpload = async (file: File) => {
    setThumbnailUploading(true);
    let ok = false;
    try {
      const result = await modelApi.uploadThumbnail(model.model_id, file);
      setThumbnailUrl(result.thumbnail_url);
      toast('预览图已更新', 'success');
      ok = true;
    } catch {
      toast('上传预览图失败', 'error');
    } finally {
      setThumbnailUploading(false);
    }
    if (ok) onSaved();
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    let ok = false;
    try {
      const result = await modelApi.reconvert(model.model_id);
      setThumbnailUrl(result.thumbnail_url);
      toast('预览图已重新生成', 'success');
      ok = true;
    } catch {
      toast('重新生成失败', 'error');
    } finally {
      setRegenerating(false);
    }
    if (ok) onSaved();
  };

  return (
    <AnimatePresence>
      {open && (
        <DialogOverlay
          onClose={onClose}
          zIndex={50}
          backdropClassName="bg-surface-dim/70 backdrop-blur-sm"
          bottomOnMobile
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-surface-container-low rounded-t-2xl sm:rounded-lg shadow-xl border border-outline-variant/20 w-full max-w-md p-4 sm:p-6 max-h-[calc(100dvh-1rem)] sm:max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-headline text-lg font-semibold text-on-surface">编辑模型</h3>
              <button onClick={onClose} className="p-1 text-on-surface-variant hover:text-on-surface transition-colors">
                <Icon name="close" size={20} />
              </button>
            </div>
            <div className="space-y-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs uppercase tracking-wider text-on-surface-variant">预览图</label>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="w-16 h-16 rounded-sm bg-surface-container-highest shrink-0 overflow-hidden">
                    <ModelThumbnail src={thumbnailUrl} alt="" className="w-full h-full object-cover" />
                  </div>
                  <div className="flex flex-col gap-1.5 w-full sm:w-auto">
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      id="thumb-upload"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleThumbnailUpload(f);
                        e.target.value = '';
                      }}
                    />
                    <button
                      onClick={() => document.getElementById('thumb-upload')?.click()}
                      disabled={thumbnailUploading}
                      className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-sm transition-colors border border-outline-variant/20 disabled:opacity-50"
                    >
                      <Icon name="upload" size={14} />
                      {thumbnailUploading ? '上传中...' : '上传图片'}
                    </button>
                    <button
                      onClick={handleRegenerate}
                      disabled={regenerating}
                      className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-sm transition-colors border border-outline-variant/20 disabled:opacity-50"
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
                <label className="text-xs uppercase tracking-wider text-on-surface-variant">描述</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="w-full bg-surface-container-lowest text-on-surface border border-outline-variant/30 focus:border-primary px-3 py-2 text-sm rounded-sm outline-none resize-none"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs uppercase tracking-wider text-on-surface-variant">分类</label>
                <CategorySelect
                  categories={categories}
                  value={categoryId}
                  onChange={setCategoryId}
                  placeholder="选择分类"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs uppercase tracking-wider text-on-surface-variant">产品图纸 (PDF)</label>
                <div className="flex items-center gap-3 min-w-0">
                  {drawingUrl ? (
                    <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
                      <Icon name="description" size={20} className="text-primary shrink-0" />
                      <span className="text-sm text-on-surface truncate flex-1">已上传</span>
                      <button
                        type="button"
                        onClick={() =>
                          void openModelDrawing(model.model_id).catch(() => toast('打开图纸失败', 'error'))
                        }
                        className="text-xs text-primary hover:underline"
                      >
                        查看
                      </button>
                      <button
                        onClick={async () => {
                          let ok = false;
                          try {
                            await modelApi.deleteDrawing(model.model_id);
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
                        id="drawing-upload"
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
                            const r = await modelApi.uploadDrawing(model.model_id, f);
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
                        onClick={() => document.getElementById('drawing-upload')?.click()}
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
                  accept={MODEL_SOURCE_ACCEPT}
                  className="hidden"
                  id="replace-file-upload"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const ext = f.name.split('.').pop()?.toLowerCase() || '';
                    if (!MODEL_SOURCE_FORMATS.includes(ext)) {
                      toast(`仅支持 ${MODEL_SOURCE_LABEL} 格式`, 'error');
                      return;
                    }
                    setFileReplacing(true);
                    let ok = false;
                    try {
                      const result = await modelApi.replaceFile(model.model_id, f);
                      toast(result.status === 'completed' ? '文件已更新' : '文件已上传，正在转换中...', 'success');
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
                  onClick={() => document.getElementById('replace-file-upload')?.click()}
                  disabled={fileReplacing}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-sm transition-colors border border-outline-variant/20 disabled:opacity-50 w-full justify-center"
                >
                  <Icon name="swap_horiz" size={14} />
                  {fileReplacing ? '上传中...' : '选择新模型文件'}
                </button>
              </div>
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3 pt-2">
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
