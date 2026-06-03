import { motion, AnimatePresence } from 'framer-motion';
import { useState, useCallback, memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import client from '../api/client';
import { downloadModelFile, isDownloadAuthRequiredError } from '../api/downloads';
import { favoriteApi } from '../api/favorites';
import type { FavoriteItem } from '../api/favorites';
import {
  AdminEmptyState,
  AdminErrorState,
  AdminLoadingState,
  AdminManagementPage,
} from '../components/shared/AdminManagementPage';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import Icon from '../components/shared/Icon';
import LoginConfirmDialog from '../components/shared/LoginConfirmDialog';
import ModelThumbnail from '../components/shared/ModelThumbnail';
import { useToast } from '../components/shared/Toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useMediaQuery } from '../layouts/hooks/useMediaQuery';
import { cacheModelDetailTitle } from '../lib/modelDetailTitleCache';
import { toolbarMotion } from '../lib/motion';
import { useFavoriteStore } from '../stores/useFavoriteStore';

interface FavoriteModel {
  id: string;
  name: string;
  format: string;
  thumbnailUrl: string | null;
  createdAt: string;
}

function mapFavorites(items: FavoriteItem[], fallbackName: string): FavoriteModel[] {
  return items.map((item) => ({
    id: item.model?.model_id || item.modelId,
    name: item.model?.name || fallbackName,
    format: item.model?.format || '',
    thumbnailUrl: item.model?.thumbnail_url || null,
    createdAt: item.createdAt,
  }));
}

function EmptyState({
  message,
  actionLabel,
  actionHref,
}: {
  message: string;
  actionLabel: string;
  actionHref: string;
}) {
  const { t } = useTranslation();

  return (
    <AdminEmptyState
      icon="star"
      title={message}
      description={t('favorites.emptyDescription')}
      action={
        <Link
          to={actionHref}
          className="rounded-md bg-primary-container px-5 py-2.5 text-sm font-semibold text-on-primary transition-opacity hover:opacity-90"
        >
          {actionLabel}
        </Link>
      }
    />
  );
}

// Batch action toolbar
function BatchToolbar({
  selectedCount,
  onDownload,
  onRemove,
  onCancel,
  downloading,
}: {
  selectedCount: number;
  onDownload: () => void;
  onRemove: () => void;
  onCancel: () => void;
  downloading?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <motion.div
      variants={toolbarMotion}
      initial="initial"
      animate="animate"
      exit="exit"
      className="bg-surface-container-high border border-outline-variant/20 rounded-lg px-4 py-3 flex items-center gap-3 shadow-lg"
    >
      <span className="text-sm text-on-surface font-medium">
        {t('favorites.selectedCount', { count: selectedCount })}
      </span>
      <div className="flex-1" />
      <button
        onClick={onDownload}
        disabled={downloading}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-on-primary bg-primary-container rounded-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70 transition-opacity"
      >
        <Icon
          name={downloading ? 'progress_activity' : 'download'}
          size={14}
          className={downloading ? 'animate-spin' : ''}
        />
        {downloading ? t('favorites.packing') : t('favorites.batchDownload')}
      </button>
      <button
        onClick={onRemove}
        disabled={downloading}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-error bg-error/10 rounded-sm border border-error/20 hover:bg-error/20 disabled:cursor-not-allowed disabled:opacity-60 transition-colors"
      >
        <Icon name="star_off" size={14} />
        {t('favorites.removeFavorite')}
      </button>
      <button
        onClick={onCancel}
        disabled={downloading}
        className="flex items-center justify-center w-7 h-7 text-on-surface-variant hover:text-on-surface rounded-sm hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-60 transition-colors"
      >
        <Icon name="close" size={16} />
      </button>
    </motion.div>
  );
}

function RemoveFavoriteIcon({ bumpKey, size }: { bumpKey: number; size: number }) {
  return (
    <motion.span
      key={bumpKey}
      className="inline-flex"
      initial={bumpKey > 0 ? { y: 0, scale: 1 } : false}
      animate={bumpKey > 0 ? { y: [0, -3, 0], scale: [1, 1.14, 1] } : { y: 0, scale: 1 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
    >
      <Icon name="star_off" size={size} />
    </motion.span>
  );
}

const ModelCard = memo(function ModelCard({
  model,
  selected,
  onSelect,
  onRemove,
  onDownload,
  showCheckbox,
}: {
  model: FavoriteModel;
  selected: boolean;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onDownload: (id: string) => void;
  showCheckbox: boolean;
}) {
  const { t } = useTranslation();
  const [removeBumpKey, setRemoveBumpKey] = useState(0);
  const rememberDetailTitle = useCallback(() => {
    cacheModelDetailTitle(model.id, model.name);
  }, [model.id, model.name]);

  return (
    <div
      className={`bg-surface-container-high rounded-sm group relative transition-[box-shadow] duration-200 ease-out flex flex-col ${selected ? 'ring-2 ring-primary shadow-[0_0_0_1px_var(--color-primary)]' : 'hover:shadow-card'}`}
    >
      <div className="aspect-[4/3] bg-surface-container-lowest w-full relative overflow-hidden flex items-center justify-center">
        <Link
          to={`/model/${model.id}`}
          state={{ modelName: model.name }}
          onPointerDown={rememberDetailTitle}
          onFocus={rememberDetailTitle}
          className="absolute inset-0 z-0"
        >
          <ModelThumbnail
            src={model.thumbnailUrl}
            alt={model.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        </Link>
        {showCheckbox && (
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onSelect(model.id);
            }}
            className={`absolute top-2 left-2 z-10 w-6 h-6 rounded-sm border-2 flex items-center justify-center transition-[background-color,border-color,opacity] duration-150 ease-out ${
              selected ? 'bg-primary border-primary' : 'bg-surface/80 border-outline-variant/40 hover:border-primary'
            }`}
          >
            {selected && <Icon name="check" size={14} className="text-on-primary" />}
          </button>
        )}
        <span className="absolute bottom-2 left-2 z-10 bg-surface-container-highest/80 backdrop-blur-md px-1.5 py-0.5 text-[9px] text-on-surface-variant font-mono rounded-sm border border-outline-variant/30">
          {model.format.toUpperCase()}
        </span>
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setRemoveBumpKey((key) => key + 1);
            onRemove(model.id);
          }}
          aria-label={t('productCard.unfavorite')}
          className="absolute top-2 right-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-surface/80 text-on-surface-variant opacity-0 backdrop-blur-sm transition-[background-color,color,opacity,transform] duration-150 hover:bg-error/20 hover:text-error group-hover:opacity-100"
        >
          <RemoveFavoriteIcon bumpKey={removeBumpKey} size={14} />
        </button>
      </div>
      <div className="flex-1 flex flex-col p-2.5">
        <Link
          to={`/model/${model.id}`}
          state={{ modelName: model.name }}
          onPointerDown={rememberDetailTitle}
          onFocus={rememberDetailTitle}
        >
          <h4 className="text-xs font-headline text-on-surface leading-tight line-clamp-2">{model.name}</h4>
        </Link>
        <div className="flex items-center gap-2 mt-auto pt-2">
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDownload(model.id);
            }}
            className="flex-1 bg-primary-container text-on-primary rounded-sm py-1.5 px-3 text-xs font-medium hover:opacity-90 flex items-center justify-center gap-1"
          >
            <Icon name="download" size={14} />
            {t('common.download')}
          </button>
          <Link
            to={`/model/${model.id}`}
            state={{ modelName: model.name }}
            onPointerDown={rememberDetailTitle}
            onFocus={rememberDetailTitle}
            className="flex-1 border border-outline-variant/40 text-on-surface-variant hover:text-on-surface rounded-sm py-1.5 px-3 text-xs text-center flex items-center justify-center gap-1"
          >
            <Icon name="visibility" size={14} />
            {t('common.preview')}
          </Link>
        </div>
      </div>
    </div>
  );
});

const MobileModelCard = memo(function MobileModelCard({
  model,
  selected,
  onSelect,
  onRemove,
  onDownload,
  showCheckbox,
}: {
  model: FavoriteModel;
  selected: boolean;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onDownload: (id: string) => void;
  showCheckbox: boolean;
}) {
  const { i18n, t } = useTranslation();
  const [removeBumpKey, setRemoveBumpKey] = useState(0);
  const rememberDetailTitle = useCallback(() => {
    cacheModelDetailTitle(model.id, model.name);
  }, [model.id, model.name]);

  return (
    <div
      className={`bg-surface-container-high rounded-xl border relative transition-[border-color,box-shadow] duration-200 ease-out overflow-hidden ${selected ? 'border-primary ring-2 ring-primary/30' : 'border-outline-variant/10'}`}
    >
      {showCheckbox && (
        <button
          onClick={() => onSelect(model.id)}
          className={`absolute top-2 left-2 z-10 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-[background-color,border-color,opacity] duration-150 ease-out ${
            selected ? 'bg-primary border-primary' : 'bg-surface/80 border-outline-variant/40'
          }`}
        >
          {selected && <Icon name="check" size={12} className="text-on-primary" />}
        </button>
      )}
      <Link
        to={`/model/${model.id}`}
        state={{ modelName: model.name }}
        onPointerDown={rememberDetailTitle}
        onFocus={rememberDetailTitle}
        className="flex h-20"
      >
        <div className="w-20 h-20 bg-surface-container-lowest flex-shrink-0 overflow-hidden">
          <ModelThumbnail src={model.thumbnailUrl} alt={model.name} className="w-full h-full object-cover" />
        </div>
        <div className="flex-1 min-w-0 px-3 pt-3 pb-2 flex flex-col justify-between">
          <h3 className="text-sm text-on-surface leading-snug line-clamp-1">{model.name}</h3>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-on-surface-variant/50">
              {model.format.toUpperCase()} · {new Date(model.createdAt).toLocaleDateString(i18n.language)}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDownload(model.id);
                }}
                className="flex items-center justify-center w-7 h-7 rounded-lg text-on-surface-variant active:scale-[0.95] transition-transform"
                aria-label={t('common.download')}
              >
                <Icon name="download" size={16} />
              </button>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setRemoveBumpKey((key) => key + 1);
                  onRemove(model.id);
                }}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:text-error"
                aria-label={t('productCard.unfavorite')}
              >
                <RemoveFavoriteIcon bumpKey={removeBumpKey} size={16} />
              </button>
            </div>
          </div>
        </div>
      </Link>
    </div>
  );
});

function DesktopContent() {
  const { t } = useTranslation();
  const { data, error, isLoading, mutate } = useSWR<FavoriteItem[]>('/favorites', () =>
    client.get('/favorites').then((r) => r.data?.data || r.data),
  );
  const { toast } = useToast();
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleRemove = useCallback(
    async (modelId: string) => {
      try {
        await favoriteApi.remove(modelId);
        const store = useFavoriteStore.getState();
        const updated = new Set(store.favoriteIds);
        updated.delete(modelId);
        useFavoriteStore.setState({ favoriteIds: updated });
        mutate();
        toast(t('productCard.unfavoriteSuccess'), 'success');
      } catch {
        toast(t('productCard.unfavoriteFail'), 'error');
      }
    },
    [mutate, t, toast],
  );

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const models = useMemo(() => (data ? mapFavorites(data, t('modelDetail.unnamed')) : []), [data, t]);
  const allSelected = models.length > 0 && models.every((model) => selected.has(model.id));

  const toggleSelectAll = useCallback(() => {
    setSelected((prev) => {
      const everySelected = models.length > 0 && models.every((model) => prev.has(model.id));
      return everySelected ? new Set() : new Set(models.map((model) => model.id));
    });
  }, [models]);

  const handleBatchRemove = useCallback(() => {
    if (selected.size === 0) return;
    setConfirmOpen(true);
  }, [selected]);

  const confirmBatchRemove = useCallback(async () => {
    setConfirmOpen(false);
    try {
      await favoriteApi.batchRemove(Array.from(selected));
      const store = useFavoriteStore.getState();
      const updated = new Set(store.favoriteIds);
      selected.forEach((id) => updated.delete(id));
      useFavoriteStore.setState({ favoriteIds: updated });
      setSelected(new Set());
      setSelectMode(false);
      mutate();
      toast(t('favorites.batchRemoveSuccess', { count: selected.size }), 'success');
    } catch {
      toast(t('favorites.batchRemoveFailed'), 'error');
    }
  }, [selected, mutate, t, toast]);

  const handleBatchDownload = useCallback(
    async (format: string = 'original') => {
      if (selected.size === 0 || downloading) return;
      const modelIds = Array.from(selected);
      const count = modelIds.length;
      setDownloading(true);
      toast(t('favorites.batchDownloadPreparing', { count }), 'info');
      try {
        const result = await favoriteApi.batchDownload(modelIds, format);
        toast(t('favorites.batchDownloadSubmitted', { count: result.fileCount }), 'success');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : t('favorites.downloadFailed');
        toast(msg || t('favorites.downloadFailed'), 'error');
      } finally {
        setDownloading(false);
      }
    },
    [downloading, selected, t, toast],
  );

  const handleSingleDownload = useCallback(
    async (modelId: string) => {
      try {
        await downloadModelFile(modelId, 'original');
      } catch (error) {
        if (isDownloadAuthRequiredError(error)) {
          setLoginDialogOpen(true);
        } else {
          toast(t('favorites.downloadFailed'), 'error');
        }
      }
    },
    [t, toast],
  );

  if (isLoading) {
    return (
      <AdminManagementPage title={t('favorites.title')} description={t('favorites.pageDescription')}>
        <AdminLoadingState variant="cards" label={t('favorites.loading')} />
      </AdminManagementPage>
    );
  }

  if (error) {
    return (
      <AdminManagementPage title={t('favorites.title')} description={t('favorites.pageDescription')}>
        <AdminErrorState
          title={t('favorites.loadFailed')}
          description={t('favorites.loadFailedDescription')}
          onRetry={() => mutate()}
        />
      </AdminManagementPage>
    );
  }

  const headerActions =
    models.length > 0 ? (
      <>
        {selectMode ? (
          <button onClick={toggleSelectAll} className="text-sm text-primary hover:underline">
            {allSelected ? t('favorites.unselectAll') : t('favorites.selectAll')}
          </button>
        ) : null}
        <button
          onClick={() => {
            setSelectMode(!selectMode);
            setSelected(new Set());
          }}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-sm border transition-colors ${
            selectMode
              ? 'text-primary border-primary/30 bg-primary-container/10'
              : 'text-on-surface-variant border-outline-variant/20 hover:text-on-surface hover:border-outline-variant/40'
          }`}
        >
          <Icon name={selectMode ? 'close' : 'checklist'} size={16} />
          {selectMode ? t('favorites.cancelSelect') : t('favorites.batchOperation')}
        </button>
      </>
    ) : null;

  return (
    <AdminManagementPage
      title={t('favorites.title')}
      meta={t('favorites.modelCount', { count: models.length })}
      description={models.length > 1 ? t('favorites.batchDescription') : t('favorites.pageDescription')}
      actions={headerActions}
    >
      {/* Batch toolbar */}
      <AnimatePresence>
        {selectMode && selected.size > 0 && (
          <div className="mb-4">
            <BatchToolbar
              selectedCount={selected.size}
              onDownload={() => handleBatchDownload('original')}
              onRemove={handleBatchRemove}
              downloading={downloading}
              onCancel={() => {
                setSelectMode(false);
                setSelected(new Set());
              }}
            />
          </div>
        )}
      </AnimatePresence>

      {downloading && (
        <div
          role="status"
          aria-live="polite"
          className="mb-4 flex items-center gap-2 px-4 py-3 bg-primary-container/10 rounded-lg border border-primary/20"
        >
          <Icon name="progress_activity" size={18} className="text-primary animate-spin" />
          <span className="text-sm text-primary">{t('favorites.batchDownloadingStatus')}</span>
        </div>
      )}

      {models.length === 0 ? (
        <EmptyState message={t('favorites.emptyTitle')} actionLabel={t('favorites.browseLibrary')} actionHref="/" />
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3 pb-20">
          {models.map((model) => (
            <ModelCard
              key={model.id}
              model={model}
              selected={selected.has(model.id)}
              onSelect={toggleSelect}
              onRemove={handleRemove}
              onDownload={handleSingleDownload}
              showCheckbox={selectMode}
            />
          ))}
          <Link
            to="/"
            className="bg-surface-container-lowest border border-outline-variant/20 border-dashed rounded-sm group cursor-pointer hover:border-primary/50 hover:bg-surface-container-low transition-[background-color,border-color] duration-150 ease-out flex flex-col items-center justify-center min-h-[200px]"
          >
            <div className="w-12 h-12 rounded-sm bg-surface-container-high flex items-center justify-center mb-3 group-hover:text-primary transition-colors text-on-surface-variant">
              <Icon name="search" size={32} />
            </div>
            <span className="font-headline text-sm font-semibold text-on-surface">{t('favorites.browseLibrary')}</span>
            <span className="text-xs text-on-secondary-container mt-1">{t('favorites.discoverMore')}</span>
          </Link>
        </div>
      )}
      <LoginConfirmDialog
        open={loginDialogOpen}
        onClose={() => setLoginDialogOpen(false)}
        reason={t('modelDetail.downloadModel')}
      />
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={confirmBatchRemove}
        icon="star_off"
        iconColor="text-warning"
        iconBg="bg-warning/15"
        title={t('favorites.confirmRemoveTitle')}
        description={t('favorites.confirmRemoveDescription', { count: selected.size })}
        confirmLabel={t('favorites.removeFavorite')}
        confirmClassName="flex-1 py-2.5 text-sm font-medium text-on-primary bg-primary-container rounded-lg hover:opacity-90 transition-opacity"
      />
    </AdminManagementPage>
  );
}

function MobileContent() {
  const { t } = useTranslation();
  const { data, error, isLoading, mutate } = useSWR<FavoriteItem[]>('/favorites', () =>
    client.get('/favorites').then((r) => r.data?.data || r.data),
  );
  const { toast } = useToast();
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleRemove = useCallback(
    async (modelId: string) => {
      try {
        await favoriteApi.remove(modelId);
        const store = useFavoriteStore.getState();
        const updated = new Set(store.favoriteIds);
        updated.delete(modelId);
        useFavoriteStore.setState({ favoriteIds: updated });
        mutate();
        toast(t('productCard.unfavoriteSuccess'), 'success');
      } catch {
        toast(t('productCard.unfavoriteFail'), 'error');
      }
    },
    [mutate, t, toast],
  );

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const models = useMemo(() => (data ? mapFavorites(data, t('modelDetail.unnamed')) : []), [data, t]);
  const allSelected = models.length > 0 && models.every((model) => selected.has(model.id));

  const toggleSelectAll = useCallback(() => {
    setSelected((prev) => {
      const everySelected = models.length > 0 && models.every((model) => prev.has(model.id));
      return everySelected ? new Set() : new Set(models.map((model) => model.id));
    });
  }, [models]);

  const handleBatchRemove = useCallback(() => {
    if (selected.size === 0) return;
    setConfirmOpen(true);
  }, [selected]);

  const confirmBatchRemove = useCallback(async () => {
    setConfirmOpen(false);
    try {
      await favoriteApi.batchRemove(Array.from(selected));
      const store = useFavoriteStore.getState();
      const updated = new Set(store.favoriteIds);
      selected.forEach((id) => updated.delete(id));
      useFavoriteStore.setState({ favoriteIds: updated });
      setSelected(new Set());
      setSelectMode(false);
      mutate();
      toast(t('favorites.batchRemoveSuccess', { count: selected.size }), 'success');
    } catch {
      toast(t('favorites.batchRemoveFailed'), 'error');
    }
  }, [selected, mutate, t, toast]);

  const handleBatchDownload = useCallback(
    async (format: string = 'original') => {
      if (selected.size === 0 || downloading) return;
      const modelIds = Array.from(selected);
      const count = modelIds.length;
      setDownloading(true);
      toast(t('favorites.batchDownloadPreparing', { count }), 'info');
      try {
        const result = await favoriteApi.batchDownload(modelIds, format);
        toast(t('favorites.batchDownloadSubmitted', { count: result.fileCount }), 'success');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : t('favorites.downloadFailed');
        toast(msg || t('favorites.downloadFailed'), 'error');
      } finally {
        setDownloading(false);
      }
    },
    [downloading, selected, t, toast],
  );

  const handleSingleDownload = useCallback(
    async (modelId: string) => {
      try {
        await downloadModelFile(modelId, 'original');
      } catch (error) {
        if (isDownloadAuthRequiredError(error)) {
          setLoginDialogOpen(true);
        } else {
          toast(t('favorites.downloadFailed'), 'error');
        }
      }
    },
    [t, toast],
  );

  return (
    <AdminManagementPage
      title={t('favorites.title')}
      meta={t('favorites.modelCount', { count: models.length })}
      description={t('favorites.pageDescription')}
      actions={
        models.length > 0 ? (
          <button
            onClick={() => {
              setSelectMode(!selectMode);
              setSelected(new Set());
            }}
            className={`text-xs px-2.5 py-1 rounded-sm border transition-colors ${
              selectMode ? 'text-primary border-primary/30' : 'text-on-surface-variant border-outline-variant/20'
            }`}
          >
            {selectMode ? t('favorites.cancel') : t('favorites.batchOperation')}
          </button>
        ) : null
      }
    >
      {/* Mobile batch toolbar */}
      <AnimatePresence>
        {selectMode && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="mb-3 flex items-center gap-2 bg-surface-container-high rounded-lg px-3 py-2.5 border border-outline-variant/10"
          >
            <button onClick={toggleSelectAll} className="text-xs text-primary">
              {allSelected ? t('favorites.unselectAll') : t('favorites.selectAll')}
            </button>
            <div className="flex-1" />
            <span className="text-xs text-on-surface-variant">
              {t('favorites.selectedShort', { count: selected.size })}
            </span>
            <button
              onClick={() => handleBatchDownload('original')}
              disabled={selected.size === 0 || downloading}
              className="flex items-center gap-1 text-xs text-on-surface-variant hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-60 px-2 py-1"
            >
              {downloading && <Icon name="progress_activity" size={12} className="animate-spin" />}
              {downloading ? t('favorites.packing') : t('favorites.batchDownload')}
            </button>
            <button
              disabled={selected.size === 0 || downloading}
              onClick={handleBatchRemove}
              className="text-xs text-error disabled:cursor-not-allowed disabled:opacity-60 px-2 py-1"
            >
              {t('favorites.removeFavorite')}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {downloading && (
        <div
          role="status"
          aria-live="polite"
          className="mb-3 flex items-center gap-2 px-3 py-2 bg-primary-container/10 rounded-lg border border-primary/20"
        >
          <Icon name="progress_activity" size={14} className="text-primary animate-spin" />
          <span className="text-xs text-primary">{t('favorites.batchDownloadingStatus')}</span>
        </div>
      )}

      {isLoading ? (
        <AdminLoadingState variant="list" rows={5} media label={t('favorites.loading')} />
      ) : error ? (
        <AdminErrorState
          title={t('favorites.loadFailed')}
          description={t('favorites.loadFailedDescription')}
          onRetry={() => mutate()}
        />
      ) : models.length === 0 ? (
        <EmptyState message={t('favorites.emptyTitle')} actionLabel={t('favorites.browseLibrary')} actionHref="/" />
      ) : (
        <div className="flex flex-col gap-2.5">
          {models.map((model) => (
            <MobileModelCard
              key={model.id}
              model={model}
              selected={selected.has(model.id)}
              onSelect={toggleSelect}
              onRemove={handleRemove}
              onDownload={handleSingleDownload}
              showCheckbox={selectMode}
            />
          ))}
        </div>
      )}
      <LoginConfirmDialog
        open={loginDialogOpen}
        onClose={() => setLoginDialogOpen(false)}
        reason={t('modelDetail.downloadModel')}
      />
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={confirmBatchRemove}
        icon="star_off"
        iconColor="text-warning"
        iconBg="bg-warning/15"
        title={t('favorites.confirmRemoveTitle')}
        description={t('favorites.confirmRemoveDescription', { count: selected.size })}
        confirmLabel={t('favorites.removeFavorite')}
        confirmClassName="flex-1 py-2.5 text-sm font-medium text-on-primary bg-primary-container rounded-lg hover:opacity-90 transition-opacity"
      />
    </AdminManagementPage>
  );
}

export default function FavoritesPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('favorites.title'));
  const isDesktop = useMediaQuery('(min-width: 768px)');

  return <AdminPageShell>{isDesktop ? <DesktopContent /> : <MobileContent />}</AdminPageShell>;
}
