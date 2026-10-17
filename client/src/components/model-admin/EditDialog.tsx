import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { type CategoryItem } from '../../api/categories';
import { openModelDrawing } from '../../api/downloads';
import { modelApi, type DrawingRef, type ServerModelListItem } from '../../api/models';
import { AdminButton, AdminIconButton } from '../../components/shared/AdminControls';
import CategorySelect from '../../components/shared/CategorySelect';
import DialogOverlay from '../../components/shared/DialogOverlay';
import { AppFormLabel, AppTextArea, AppTextInput } from '../../components/shared/FormControls';
import Icon from '../../components/shared/Icon';
import ModelThumbnail from '../../components/shared/ModelThumbnail';
import { useToast } from '../../components/shared/Toast';
import { getBusinessConfig } from '../../lib/businessConfig';
import { MODEL_SOURCE_ACCEPT, MODEL_SOURCE_FORMATS, MODEL_SOURCE_LABEL } from './shared';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [thumbnailUploading, setThumbnailUploading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [drawingUploading, setDrawingUploading] = useState(false);
  const [drawings, setDrawings] = useState<DrawingRef[]>([]);
  const [fileReplacing, setFileReplacing] = useState(false);
  const { uploadPolicy } = getBusinessConfig();
  const imageMaxBytes = Math.max(1, Number(uploadPolicy.productWallImageMaxSizeMb) || 8) * 1024 * 1024;
  const drawingMaxBytes = Math.max(1, Number(uploadPolicy.modelDrawingMaxSizeMb) || 500) * 1024 * 1024;

  useEffect(() => {
    if (model) {
      setName(model.name || '');
      setDescription('');
      setCategoryId(model.category_id || '');
      setThumbnailUrl(model.thumbnail_url);
      setDrawings(model.drawings || []);
    }
  }, [model]);

  if (!open || !model) return null;

  const handleSave = async () => {
    if (!name.trim()) {
      toast(t('modelAdminComp.nameRequired'), 'error');
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
      toast(t('modelAdminComp.saveSuccess'), 'success');
      ok = true;
    } catch {
      toast(t('modelAdminComp.saveFail'), 'error');
    } finally {
      setSaving(false);
    }
    if (ok) {
      onSaved();
      onClose();
    }
  };

  const handleThumbnailUpload = async (file: File) => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      toast(t('modelAdminComp.imageTypeInvalid'), 'error');
      return;
    }
    if (file.size > imageMaxBytes) {
      toast(t('modelAdminComp.imageTooLarge', { mb: uploadPolicy.productWallImageMaxSizeMb }), 'error');
      return;
    }
    setThumbnailUploading(true);
    let ok = false;
    try {
      const result = await modelApi.uploadThumbnail(model.model_id, file);
      setThumbnailUrl(result.thumbnail_url);
      toast(t('modelAdminComp.thumbnailUpdated'), 'success');
      ok = true;
    } catch {
      toast(t('modelAdminComp.thumbnailUploadFail'), 'error');
    } finally {
      setThumbnailUploading(false);
    }
    if (ok) onSaved();
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    let ok = false;
    try {
      const { jobId } = await modelApi.reconvert(model.model_id);
      let final: Awaited<ReturnType<typeof modelApi.reconvertProgress>> | null = null;
      for (let i = 0; i < 900; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const job = await modelApi.reconvertProgress(jobId);
        if (job.stage === 'done') {
          final = job;
          break;
        }
        if (job.stage === 'error') throw new Error(job.error || t('modelAdminComp.regenFail'));
      }
      if (!final) throw new Error(t('modelAdminComp.convertTimeout'));
      if (final.result?.thumbnail_url) setThumbnailUrl(final.result.thumbnail_url);
      toast(
        final.result?.thumbnail_warning || t('modelAdminComp.thumbnailRegenerated'),
        final.result?.thumbnail_warning ? 'info' : 'success',
      );
      ok = true;
    } catch (err) {
      // 带上真实原因（如「转换子进程异常退出」「gmsh 转换失败」），只弹「重新生成失败」无法定位
      toast(err instanceof Error && err.message ? err.message : t('modelAdminComp.regenFail'), 'error');
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
              <h3 className="font-headline text-lg font-semibold text-on-surface">
                {t('modelAdminComp.editModelTitle')}
              </h3>
              <AdminIconButton icon="close" onClick={onClose} variant="ghost" aria-label={t('common.close')} />
            </div>
            <div className="space-y-4">
              <div className="flex flex-col gap-1.5">
                <AppFormLabel uppercase className="mb-0">
                  {t('modelAdminComp.previewImageLabel')}
                </AppFormLabel>
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
                    <AdminButton
                      onClick={() => document.getElementById('thumb-upload')?.click()}
                      disabled={thumbnailUploading}
                      icon="upload"
                      size="sm"
                      variant="secondary"
                      className="w-full sm:w-auto"
                    >
                      {thumbnailUploading ? t('modelAdminComp.uploading') : t('modelAdminComp.uploadImage')}
                    </AdminButton>
                    <AdminButton
                      onClick={handleRegenerate}
                      disabled={regenerating}
                      icon="refresh"
                      size="sm"
                      variant="secondary"
                      className="w-full sm:w-auto"
                    >
                      {regenerating ? t('modelAdminComp.generating') : t('modelAdminComp.regenFromModel')}
                    </AdminButton>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <AppFormLabel uppercase className="mb-0">
                  {t('modelAdminComp.nameLabel')}
                </AppFormLabel>
                <AppTextInput value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <AppFormLabel uppercase className="mb-0">
                  {t('modelAdminComp.descriptionLabel')}
                </AppFormLabel>
                <AppTextArea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
              </div>
              <div className="flex flex-col gap-1.5">
                <AppFormLabel uppercase className="mb-0">
                  {t('modelAdminComp.categoryLabel')}
                </AppFormLabel>
                <CategorySelect
                  categories={categories}
                  value={categoryId}
                  onChange={setCategoryId}
                  placeholder={t('modelAdminComp.selectCategory')}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <AppFormLabel uppercase className="mb-0">
                  {t('modelAdminComp.drawingTitle')}
                </AppFormLabel>
                <div className="flex flex-col gap-2 min-w-0">
                  {drawings.map((drawing) => (
                    <div key={drawing.id} className="flex items-center gap-2 min-w-0">
                      <Icon name="description" size={20} className="text-primary shrink-0" />
                      <span className="text-sm text-on-surface truncate flex-1" title={drawing.name}>
                        {drawing.name}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          void openModelDrawing(model.model_id, drawing.id).catch(() =>
                            toast(t('modelAdminComp.openDrawingFail'), 'error'),
                          )
                        }
                        className="text-xs text-primary hover:underline shrink-0"
                      >
                        {t('modelAdminComp.view')}
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            const r = await modelApi.deleteDrawing(model.model_id, drawing.id);
                            setDrawings(r.drawings);
                            toast(t('modelAdminComp.drawingDeleted'), 'success');
                            onSaved();
                          } catch {
                            toast(t('modelAdminComp.deleteFail'), 'error');
                          }
                        }}
                        className="text-xs text-error hover:underline shrink-0"
                      >
                        {t('common.delete')}
                      </button>
                    </div>
                  ))}
                  <input
                    type="file"
                    accept="application/pdf"
                    className="hidden"
                    id="drawing-upload"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      if (f.type !== 'application/pdf') {
                        toast(t('modelAdminComp.pdfOnly'), 'error');
                        e.target.value = '';
                        return;
                      }
                      if (f.size > drawingMaxBytes) {
                        toast(t('modelAdminComp.pdfTooLarge', { mb: uploadPolicy.modelDrawingMaxSizeMb }), 'error');
                        e.target.value = '';
                        return;
                      }
                      setDrawingUploading(true);
                      try {
                        const r = await modelApi.uploadDrawing(model.model_id, f);
                        setDrawings(r.drawings);
                        toast(t('modelAdminComp.drawingUploadSuccess'), 'success');
                        onSaved();
                      } catch {
                        toast(t('modelAdminComp.uploadFail'), 'error');
                      } finally {
                        setDrawingUploading(false);
                      }
                      e.target.value = '';
                    }}
                  />
                  <AdminButton
                    onClick={() => document.getElementById('drawing-upload')?.click()}
                    disabled={drawingUploading}
                    icon="upload_file"
                    size="sm"
                    variant="secondary"
                    className="w-full justify-center"
                  >
                    {drawingUploading
                      ? t('modelAdminComp.uploading')
                      : drawings.length > 0
                        ? t('modelAdminComp.continueAddDrawing')
                        : t('modelAdminComp.uploadDrawing')}
                  </AdminButton>
                </div>
              </div>
              <div className="border-t border-outline-variant/20 pt-4 mt-1">
                <AppFormLabel uppercase>{t('modelAdminComp.replaceFileTitle')}</AppFormLabel>
                <p className="text-[10px] text-on-surface-variant/60 mt-1 mb-2">
                  {t('modelAdminComp.replaceFileHint')}
                </p>
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
                      toast(t('modelAdminComp.sourceFormatOnly', { formats: MODEL_SOURCE_LABEL }), 'error');
                      return;
                    }
                    setFileReplacing(true);
                    let ok = false;
                    try {
                      const result = await modelApi.replaceFile(model.model_id, f);
                      toast(
                        result.status === 'completed'
                          ? t('modelAdminComp.fileUpdated')
                          : t('modelAdminComp.fileUploadedConverting'),
                        'success',
                      );
                      ok = true;
                    } catch {
                      toast(t('modelAdminComp.replaceFileFail'), 'error');
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
                <AdminButton
                  onClick={() => document.getElementById('replace-file-upload')?.click()}
                  disabled={fileReplacing}
                  icon="swap_horiz"
                  size="sm"
                  variant="secondary"
                  className="w-full"
                >
                  {fileReplacing ? t('modelAdminComp.uploading') : t('modelAdminComp.chooseNewFile')}
                </AdminButton>
              </div>
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3 pt-2">
                <AdminButton onClick={onClose} variant="secondary">
                  {t('common.cancel')}
                </AdminButton>
                <AdminButton onClick={handleSave} disabled={saving} variant="primary">
                  {saving ? t('modelAdminComp.saving') : t('common.save')}
                </AdminButton>
              </div>
            </div>
          </motion.div>
        </DialogOverlay>
      )}
    </AnimatePresence>
  );
}
