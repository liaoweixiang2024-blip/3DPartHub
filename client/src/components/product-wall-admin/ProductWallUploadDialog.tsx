import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../shared/Icon';

export function ProductWallUploadDialog({
  pendingUploadFiles,
  uploadTitle,
  uploadDescription,
  uploadKind,
  fileInputRef,
  folderInputRef,
  setUploadTitle,
  setUploadDescription,
  onCancel,
  onSubmit,
}: {
  pendingUploadFiles: File[];
  uploadTitle: string;
  uploadDescription: string;
  uploadKind: string;
  fileInputRef: RefObject<HTMLInputElement | null>;
  folderInputRef: RefObject<HTMLInputElement | null>;
  setUploadTitle: (value: string) => void;
  setUploadDescription: (value: string) => void;
  onCancel: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const { t } = useTranslation();

  return (
    <div
      className="fixed inset-0 z-[10003] flex items-center justify-center bg-black/42 px-4 py-6 backdrop-blur-md"
      onClick={() => {
        onCancel();
        if (fileInputRef.current) fileInputRef.current.value = '';
        if (folderInputRef.current) folderInputRef.current.value = '';
      }}
    >
      <form
        className="w-full max-w-md overflow-hidden rounded-xl border border-outline-variant/16 bg-surface shadow-heavy"
        onClick={(event) => event.stopPropagation()}
        onSubmit={onSubmit}
      >
        <div className="border-b border-outline-variant/12 px-5 py-4">
          <p className="text-xs font-semibold tracking-[0.16em] text-primary-container">UPLOAD INFO</p>
          <h2 className="mt-1 text-lg font-bold text-on-surface">{t('productWall.uploadDialog.title')}</h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            {t('productWall.uploadDialog.description', { count: pendingUploadFiles.length, kind: uploadKind })}
          </p>
        </div>
        <div className="space-y-4 px-5 py-5">
          <label className="block">
            <span className="text-xs font-medium text-on-surface-variant">
              {t('productWall.uploadDialog.titleLabel')} <span className="text-red-500">*</span>
            </span>
            <input
              value={uploadTitle}
              onChange={(event) => setUploadTitle(event.target.value)}
              className="mt-1 h-10 w-full border-b border-outline-variant/35 bg-transparent text-sm text-on-surface outline-none transition-colors focus:border-primary-container"
              placeholder={t('productWall.uploadDialog.titlePlaceholder')}
              autoFocus
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-on-surface-variant">
              {t('productWall.uploadDialog.descriptionLabel')} <span className="text-red-500">*</span>
            </span>
            <textarea
              value={uploadDescription}
              onChange={(event) => setUploadDescription(event.target.value)}
              rows={4}
              className="mt-1 w-full resize-none rounded-md border border-outline-variant/24 bg-surface-container-lowest px-3 py-2 text-sm leading-6 text-on-surface outline-none transition-colors focus:border-primary-container"
              placeholder={t('productWall.uploadDialog.descriptionPlaceholder')}
            />
          </label>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-outline-variant/12 bg-surface-container-low/60 px-5 py-4">
          <button
            type="button"
            onClick={() => {
              onCancel();
              if (fileInputRef.current) fileInputRef.current.value = '';
              if (folderInputRef.current) folderInputRef.current.value = '';
            }}
            className="inline-flex h-9 items-center justify-center rounded-sm px-4 text-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-sm bg-primary-container px-4 text-sm font-semibold text-on-primary-container transition-colors hover:bg-primary-container/90"
          >
            <Icon name="cloud_upload" size={16} />
            {t('productWall.uploadDialog.submit')}
          </button>
        </div>
      </form>
    </div>
  );
}
