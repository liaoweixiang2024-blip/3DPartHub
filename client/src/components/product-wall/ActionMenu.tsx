import { type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../shared/Icon';

const btnBase =
  'product-wall-action inline-flex h-8 items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-container/35 disabled:cursor-not-allowed disabled:opacity-45';
const btnSecondary = `${btnBase} px-3 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface`;
const divider = 'w-px h-5 bg-outline-variant/20 shrink-0';

function MenuItem({
  icon,
  label,
  disabled,
  danger,
  onClick,
}: {
  icon: string;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex h-10 w-full items-center gap-2.5 px-3 text-left text-sm transition-colors disabled:opacity-45 ${danger ? 'text-red-600 hover:bg-red-500/6' : 'text-on-surface hover:bg-surface-container-high'}`}
    >
      <Icon name={icon} size={16} />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

function MenuDivider() {
  return <div className="my-1 border-t border-outline-variant/12" />;
}

export interface ActionMenuProps {
  variant: 'mobile' | 'desktop';
  isAdmin: boolean;
  uploading: boolean;
  uploadDisabled: boolean;
  wallEditMode: boolean;
  selectionMode: boolean;
  selectedCount: number;
  selectableVisibleItems: unknown[];
  manageMenuOpen: boolean;
  setManageMenuOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  folderInputRef: RefObject<HTMLInputElement | null>;
  onToggleEditMode: () => void;
  onToggleSelectionMode: () => void;
  onSelectAll: () => void;
  onDeleteSelected: () => void;
  onClearSelection: () => void;
  onOpenManagement: () => void;
}

export default function ProductWallActionMenu({
  variant,
  isAdmin,
  uploading,
  uploadDisabled,
  wallEditMode,
  selectionMode,
  selectedCount,
  selectableVisibleItems,
  manageMenuOpen,
  setManageMenuOpen,
  fileInputRef,
  folderInputRef,
  onToggleEditMode,
  onToggleSelectionMode,
  onSelectAll,
  onDeleteSelected,
  onClearSelection,
  onOpenManagement,
}: ActionMenuProps) {
  const { t } = useTranslation();
  const openUpload = () => {
    setManageMenuOpen(false);
    fileInputRef.current?.click();
  };

  const adminItems = isAdmin && (
    <>
      <MenuItem
        icon={wallEditMode ? 'close' : 'edit'}
        label={wallEditMode ? t('productWall.actions.exitEdit') : t('productWall.actions.edit')}
        disabled={!selectableVisibleItems.length}
        onClick={onToggleEditMode}
      />
      <MenuItem
        icon={selectionMode ? 'close' : 'delete'}
        label={selectionMode ? t('productWall.actions.exitBatch') : t('productWall.actions.batchDelete')}
        disabled={!selectableVisibleItems.length}
        onClick={onToggleSelectionMode}
      />
      {selectionMode && (
        <>
          <MenuDivider />
          <MenuItem
            icon="check"
            label={t('productWall.actions.selectCurrent')}
            disabled={!selectableVisibleItems.length}
            onClick={onSelectAll}
          />
          <MenuItem
            icon="delete"
            label={t('productWall.actions.deleteSelected', {
              suffix: selectedCount ? ` (${selectedCount})` : '',
            })}
            disabled={!selectedCount}
            danger
            onClick={onDeleteSelected}
          />
          <MenuItem icon="close" label={t('productWall.actions.clearSelection')} onClick={onClearSelection} />
        </>
      )}
      <MenuDivider />
      <MenuItem icon="settings" label={t('productWall.actions.imageManagement')} onClick={onOpenManagement} />
      <MenuItem
        icon="folder"
        label={t('productWall.actions.uploadFolder')}
        disabled={uploadDisabled}
        onClick={() => {
          setManageMenuOpen(false);
          folderInputRef.current?.click();
        }}
      />
    </>
  );

  if (variant === 'mobile') {
    return (
      <div
        className="product-wall-action relative flex items-center gap-1 md:hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          disabled={uploadDisabled}
          onClick={openUpload}
          className={`${btnBase} bg-primary-container/12 px-3 font-semibold text-primary-container hover:bg-primary-container/18 disabled:opacity-55`}
        >
          <Icon name={uploading ? 'sync' : 'cloud_upload'} size={16} />
          {t('productWall.actions.upload')}
        </button>
        {isAdmin && (
          <>
            <button
              type="button"
              onClick={() => setManageMenuOpen((v) => !v)}
              className={`${btnBase} border border-outline-variant/24 px-3 text-on-surface hover:bg-surface-container-high`}
            >
              <Icon name="settings" size={16} />
              {t('productWall.actions.admin')}
            </button>
            {manageMenuOpen && (
              <div className="fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[10001] overflow-hidden rounded-xl border border-outline-variant/14 bg-surface shadow-elevated">
                {adminItems}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="hidden items-center justify-end gap-1 border-l border-outline-variant/16 pl-3 md:flex">
      <button
        type="button"
        disabled={uploadDisabled}
        onClick={openUpload}
        className={`${btnBase} bg-primary-container/12 px-3 font-semibold text-primary-container hover:bg-primary-container/18 disabled:opacity-55`}
        aria-label={t('productWall.actions.upload')}
        data-tooltip-ignore
      >
        <Icon name={uploading ? 'sync' : 'cloud_upload'} size={16} />
        {t('productWall.actions.upload')}
      </button>

      {isAdmin && (
        <>
          <div className={divider} />
          <div className="product-wall-action relative" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setManageMenuOpen((v) => !v)}
              className={`${btnSecondary} ${wallEditMode || selectionMode ? 'text-primary-container' : ''}`}
              data-tooltip-ignore
            >
              <Icon name="settings" size={16} />
              {t('productWall.actions.admin')}
            </button>
            {manageMenuOpen && (
              <div className="absolute right-0 top-11 z-30 w-44 overflow-hidden rounded-md border border-outline-variant/18 bg-surface shadow-dialog">
                {adminItems}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
