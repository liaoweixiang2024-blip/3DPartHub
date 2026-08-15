import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { type CategoryItem } from '../../api/categories';
import { AdminButton, AdminIconButton } from '../shared/AdminControls';
import CategorySelect from '../shared/CategorySelect';
import DialogOverlay from '../shared/DialogOverlay';
import { AppFormLabel } from '../shared/FormControls';

export default function BatchCategoryDialog({
  open,
  saving,
  categories,
  count,
  allMatching,
  onClose,
  onConfirm,
}: {
  open: boolean;
  saving: boolean;
  categories: CategoryItem[];
  count: number;
  allMatching: boolean;
  onClose: () => void;
  onConfirm: (categoryId: string) => void;
}) {
  const [categoryId, setCategoryId] = useState('');

  useEffect(() => {
    if (open) setCategoryId('');
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <DialogOverlay
          onClose={saving ? undefined : onClose}
          zIndex={50}
          backdropClassName="bg-surface-dim/70 backdrop-blur-sm"
          bottomOnMobile
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-t-2xl border border-outline-variant/20 bg-surface-container-low p-4 shadow-xl sm:rounded-lg sm:p-6"
          >
            <div className="mb-5 flex items-center justify-between">
              <h3 className="font-headline text-lg font-semibold text-on-surface">批量修改分类</h3>
              <AdminIconButton icon="close" onClick={onClose} variant="ghost" aria-label="关闭" />
            </div>
            <div className="space-y-4">
              <p className="text-sm leading-6 text-on-surface-variant">
                将修改 <strong className="text-primary">{count}</strong> 个模型的分类
                {allMatching && '（按当前分类和搜索条件匹配的全部模型）'}。已在目标分类下的模型会自动跳过。
              </p>
              <div className="flex flex-col gap-1.5">
                <AppFormLabel uppercase className="mb-0">
                  目标分类
                </AppFormLabel>
                <CategorySelect
                  categories={categories}
                  value={categoryId}
                  onChange={setCategoryId}
                  placeholder="选择分类"
                />
              </div>
              <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end sm:gap-3">
                <AdminButton onClick={onClose} disabled={saving} variant="secondary">
                  取消
                </AdminButton>
                <AdminButton
                  onClick={() => categoryId && onConfirm(categoryId)}
                  disabled={!categoryId || saving}
                  variant="primary"
                >
                  {saving ? '修改中...' : '确认修改'}
                </AdminButton>
              </div>
            </div>
          </motion.div>
        </DialogOverlay>
      )}
    </AnimatePresence>
  );
}
