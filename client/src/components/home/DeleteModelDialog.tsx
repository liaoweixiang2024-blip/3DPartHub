import { motion, AnimatePresence } from 'framer-motion';
import Icon from '../shared/Icon';
import ModelThumbnail from '../shared/ModelThumbnail';
import type { Product } from './homeTypes';

export default function DeleteModelDialog({
  target,
  deleting,
  onCancel,
  onConfirm,
}: {
  target: Product | null;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AnimatePresence>
      {target && (
        <motion.div
          key="model-delete-dialog"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[250] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => !deleting && onCancel()}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.16 }}
            className="w-full max-w-lg overflow-hidden rounded-lg border border-outline-variant/20 bg-surface-container-high shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex gap-4 border-b border-outline-variant/10 bg-error-container/10 p-5">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md border border-error/20 bg-surface-container-lowest">
                <ModelThumbnail src={target.thumbnailUrl} alt={target.name} className="h-full w-full object-cover" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-2 text-error">
                  <Icon name="warning" size={18} />
                  <h3 className="font-headline text-base font-bold">确认删除模型</h3>
                </div>
                <p className="line-clamp-2 text-sm font-medium text-on-surface">{target.name}</p>
                <p className="mt-1 text-xs text-on-surface-variant">这个操作会立即删除模型资产与数据库关联记录。</p>
              </div>
            </div>
            <div className="space-y-4 p-5">
              <div className="rounded-md border border-error/20 bg-error-container/10 px-3 py-2.5 text-sm leading-relaxed text-on-surface">
                删除后无法恢复，请确认当前模型不再需要展示、下载或作为变体使用。
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-on-surface-variant">
                {['STEP/原始文件', '生成预览文件', '缩略图与图纸', '版本文件', '收藏/下载等关联', '数据库模型记录'].map(
                  (item) => (
                    <div key={item} className="flex items-center gap-2 rounded-md bg-surface-container-low px-2.5 py-2">
                      <Icon name="check" size={13} className="text-error" />
                      <span className="min-w-0 truncate">{item}</span>
                    </div>
                  ),
                )}
              </div>
              <div className="flex justify-end gap-3 pt-1">
                <button
                  onClick={onCancel}
                  disabled={deleting}
                  className="rounded-md border border-outline-variant/30 px-4 py-2 text-sm text-on-surface-variant transition-colors hover:bg-surface-container-highest disabled:opacity-50"
                >
                  先不删除
                </button>
                <button
                  onClick={onConfirm}
                  disabled={deleting}
                  className="flex items-center gap-2 rounded-md bg-error px-4 py-2 text-sm font-medium text-on-error transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {deleting && <Icon name="progress_activity" size={15} className="animate-spin" />}
                  {deleting ? '正在删除...' : '确认永久删除'}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
