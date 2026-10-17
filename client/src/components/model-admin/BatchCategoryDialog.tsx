import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
              <h3 className="font-headline text-lg font-semibold text-on-surface">
                {t('modelAdminComp.batchCategoryTitle')}
              </h3>
              <AdminIconButton icon="close" onClick={onClose} variant="ghost" aria-label={t('common.close')} />
            </div>
            <div className="space-y-4">
              <p className="text-sm leading-6 text-on-surface-variant">
                {t('modelAdminComp.batchCategoryPrefix')} <strong className="text-primary">{count}</strong>{' '}
                {t('modelAdminComp.batchCategorySuffix')}
                {allMatching && t('modelAdminComp.batchAllMatchingNote')}。{t('modelAdminComp.batchSkipNote')}
              </p>
              <div className="flex flex-col gap-1.5">
                <AppFormLabel uppercase className="mb-0">
                  {t('modelAdminComp.targetCategory')}
                </AppFormLabel>
                <CategorySelect
                  categories={categories}
                  value={categoryId}
                  onChange={setCategoryId}
                  placeholder={t('modelAdminComp.selectCategory')}
                />
              </div>
              <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end sm:gap-3">
                <AdminButton onClick={onClose} disabled={saving} variant="secondary">
                  {t('common.cancel')}
                </AdminButton>
                <AdminButton
                  onClick={() => categoryId && onConfirm(categoryId)}
                  disabled={!categoryId || saving}
                  variant="primary"
                >
                  {saving ? t('modelAdminComp.modifying') : t('modelAdminComp.confirmModify')}
                </AdminButton>
              </div>
            </div>
          </motion.div>
        </DialogOverlay>
      )}
    </AnimatePresence>
  );
}
