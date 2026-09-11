import { motion } from 'framer-motion';
import { useCallback, useRef, useState } from 'react';
import { modelApi } from '../../api/models';
import { dialogPanelMotion } from '../../lib/motion';
import Icon from '../shared/Icon';
import { useToast } from '../shared/Toast';

/**
 * 离线转换产物导入弹窗：服务器内存不足转不动的模型，先在本地用
 * `npm run convert:offline -- <STEP>` 转出 .offline.zip，再在此上传，
 * 模型直接恢复为已完成，不经过服务器转换队列。
 */
export default function ImportPreviewDialog({
  model,
  onClose,
  onImported,
}: {
  model: { model_id: string; name: string };
  onClose: () => void;
  onImported: () => void;
}) {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleUpload = useCallback(async () => {
    if (!file || uploading) return;
    setUploading(true);
    setProgress(0);
    try {
      const result = await modelApi.importPreview(model.model_id, file, {
        onUploadProgress: (e) => {
          if (e.total) setProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
        },
      });
      toast(
        `已导入「${model.name}」${result.has_original ? '（含原始文件）' : '（未含原始文件，下载原件不可用）'}`,
        'success',
      );
      onImported();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : '导入失败', 'error');
      setUploading(false);
    }
  }, [file, model.model_id, model.name, onClose, onImported, toast, uploading]);

  return (
    <div
      className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={() => !uploading && onClose()}
    >
      <motion.div
        variants={dialogPanelMotion}
        initial="initial"
        animate="animate"
        exit="exit"
        className="flex max-h-[85dvh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-outline-variant/20 bg-surface-container-low shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-outline-variant/10 px-5 py-4">
          <h3 className="font-headline text-base font-bold text-on-surface">导入离线转换产物</h3>
          <button
            type="button"
            onClick={onClose}
            disabled={uploading}
            className="text-on-surface-variant hover:text-on-surface disabled:opacity-40"
            aria-label="关闭"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="text-sm font-medium text-on-surface">{model.name}</p>
          <div className="mt-3 rounded-sm bg-surface-container-high px-3 py-2.5 text-xs leading-relaxed text-on-surface-variant">
            <p className="mb-1 font-medium text-on-surface">操作步骤</p>
            <p>1. 在本地仓库 server 目录执行：</p>
            <code className="mt-1 block break-all rounded-sm bg-surface-container-highest px-2 py-1 font-mono text-[11px] text-on-surface">
              npm run convert:offline -- /path/模型文件.STEP
            </code>
            <p className="mt-1.5">2. 选择产出的 .offline.zip 上传，模型将直接恢复为可用。</p>
          </div>

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className={`mt-4 flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors ${
              file
                ? 'border-primary/50 bg-primary-container/5'
                : 'border-outline-variant/30 hover:border-primary/50 hover:bg-surface-container/50'
            } ${uploading ? 'pointer-events-none opacity-60' : ''}`}
          >
            <Icon
              name={file ? 'check_circle' : 'upload_file'}
              size={28}
              className={file ? 'text-primary' : 'text-on-surface-variant'}
            />
            {file ? (
              <span className="break-all text-sm font-medium text-on-surface">{file.name}</span>
            ) : (
              <span className="text-sm text-on-surface-variant">点击选择 .offline.zip 文件</span>
            )}
            <input
              ref={inputRef}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                e.target.value = '';
              }}
            />
          </button>

          {uploading && (
            <div className="mt-3">
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-container-highest">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
              </div>
              <p className="mt-1 text-center text-xs text-on-surface-variant">
                上传中 {progress}%，导入后服务器处理需几秒...
              </p>
            </div>
          )}
        </div>

        <div className="flex gap-2 border-t border-outline-variant/10 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={uploading}
            className="flex-1 rounded-sm border border-outline-variant/20 px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleUpload}
            disabled={!file || uploading}
            className="flex-1 rounded-sm bg-primary-container px-4 py-2 text-sm font-medium text-on-primary hover:opacity-90 disabled:opacity-50"
          >
            {uploading ? '导入中...' : '开始导入'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
