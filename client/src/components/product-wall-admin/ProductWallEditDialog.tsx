import type { ProductWallItem, ProductWallKind } from '../../api/productWall';
import { useTranslation } from 'react-i18next';
import DialogOverlay from '../shared/DialogOverlay';
import Icon from '../shared/Icon';
import SelectMenu from '../shared/SelectMenu';

type WallItem = ProductWallItem;

export function ProductWallEditDialog({
  editTitle,
  editDescription,
  editKind,
  editTags,
  categoryNames,
  setEditTitle,
  setEditDescription,
  setEditKind,
  setEditTags,
  onCancel,
  onSave,
}: {
  editingItem: WallItem;
  editTitle: string;
  editDescription: string;
  editKind: ProductWallKind;
  editTags: string;
  categoryNames: string[];
  setEditTitle: (value: string) => void;
  setEditDescription: (value: string) => void;
  setEditKind: (value: ProductWallKind) => void;
  setEditTags: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DialogOverlay
      onClose={onCancel}
      zIndex={10000}
      backdropClassName="bg-black/35 backdrop-blur-sm"
      animated={false}
      className="px-4 py-6"
    >
      <form
        className="w-full max-w-lg rounded-sm border border-outline-variant/18 bg-surface p-5 shadow-modal"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.18em] text-primary-container">IMAGE SETTINGS</p>
            <h2 className="mt-1 text-lg font-bold text-on-surface">{t('productWallAdmin.editTitle')}</h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
            aria-label={t('common.close')}
            data-tooltip-ignore
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="space-y-4">
          <label className="block">
            <span className="text-xs font-medium text-on-surface-variant">{t('productWallAdmin.fieldTitle')}</span>
            <input
              name="edit-title"
              value={editTitle}
              onChange={(event) => setEditTitle(event.target.value)}
              className="mt-1 h-10 w-full border-b border-outline-variant/35 bg-transparent text-sm text-on-surface outline-none transition-colors focus:border-primary-container"
              placeholder={t('productWallAdmin.titlePlaceholder')}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-on-surface-variant">
              {t('productWallAdmin.fieldDescription')}
            </span>
            <textarea
              name="edit-description"
              value={editDescription}
              onChange={(event) => setEditDescription(event.target.value)}
              rows={3}
              className="mt-1 w-full resize-none border-b border-outline-variant/35 bg-transparent py-2 text-sm text-on-surface outline-none transition-colors focus:border-primary-container"
              placeholder={t('productWallAdmin.descriptionPlaceholder')}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-on-surface-variant">{t('productWallAdmin.fieldCategory')}</span>
            <SelectMenu
              variant="field"
              className="mt-1"
              ariaLabel={t('productWallAdmin.fieldCategory')}
              value={editKind}
              onChange={(value) => setEditKind(value as ProductWallKind)}
              options={categoryNames.map((kind) => ({ value: kind, label: kind }))}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-on-surface-variant">{t('productWallAdmin.fieldTags')}</span>
            <input
              name="edit-tags"
              value={editTags}
              onChange={(event) => setEditTags(event.target.value)}
              className="mt-1 h-10 w-full border-b border-outline-variant/35 bg-transparent text-sm text-on-surface outline-none transition-colors focus:border-primary-container"
              placeholder={t('productWallAdmin.tagsPlaceholder')}
            />
          </label>
        </div>
        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-9 items-center justify-center rounded-sm px-3 text-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            className="inline-flex h-9 items-center justify-center rounded-sm bg-primary-container px-4 text-sm font-semibold text-on-primary-container transition-colors hover:bg-primary-container/90"
          >
            {t('common.save')}
          </button>
        </div>
      </form>
    </DialogOverlay>
  );
}
