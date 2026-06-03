import { AnimatePresence, motion } from 'framer-motion';
import type { TFunction } from 'i18next';
import { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import { downloadsApi } from '../api/downloads';
import {
  AdminEmptyState,
  AdminErrorState,
  AdminLoadingState,
  AdminManagementPage,
} from '../components/shared/AdminManagementPage';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import Icon from '../components/shared/Icon';
import InfiniteLoadTrigger from '../components/shared/InfiniteLoadTrigger';
import ModelThumbnail from '../components/shared/ModelThumbnail';
import { useToast } from '../components/shared/Toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useVisibleItems } from '../hooks/useVisibleItems';
import { useMediaQuery } from '../layouts/hooks/useMediaQuery';
import { getErrorMessage } from '../lib/errorNotifications';
import { cacheModelDetailTitle } from '../lib/modelDetailTitleCache';
import { toolbarMotion } from '../lib/motion';

function formatFileSize(bytes: number): string {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string, t: TFunction, locale: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return t('downloads.today');
  if (diffDays === 1) return t('downloads.yesterday');
  if (diffDays < 7) return t('downloads.daysAgo', { count: diffDays });
  return d.toLocaleDateString(locale);
}

function EmptyState() {
  const { t } = useTranslation();

  return (
    <AdminEmptyState
      icon="download"
      title={t('downloads.emptyTitle')}
      description={t('downloads.emptyDescription')}
      action={
        <Link
          to="/"
          className="rounded-md bg-primary-container px-5 py-2.5 text-sm font-semibold text-on-primary transition-opacity hover:opacity-90"
        >
          {t('downloads.browseLibrary')}
        </Link>
      }
    />
  );
}

// Desktop batch toolbar
function BatchToolbar({
  selectedCount,
  onDownload,
  onDelete,
  onCancel,
  downloading,
}: {
  selectedCount: number;
  onDownload: () => void;
  onDelete: () => void;
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
        {t('downloads.selectedCount', { count: selectedCount })}
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
        {downloading ? t('downloads.packing') : t('downloads.batchDownload')}
      </button>
      <button
        onClick={onDelete}
        disabled={downloading}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-error bg-error/10 rounded-sm border border-error/20 hover:bg-error/20 disabled:cursor-not-allowed disabled:opacity-60 transition-colors"
      >
        <Icon name="delete" size={14} />
        {t('downloads.deleteHistory')}
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

function DesktopContent() {
  const { i18n, t } = useTranslation();
  const { data, error, isLoading, mutate } = useSWR('/downloads', () => downloadsApi.list());
  const { toast } = useToast();
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchDownloading, setBatchDownloading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const downloads = useMemo(() => data || [], [data]);
  const {
    visibleItems: visibleDownloads,
    hasMore,
    loadMore,
  } = useVisibleItems(downloads, 60, String(downloads.length));

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allSelected = downloads.length > 0 && downloads.every((download) => selected.has(download.id));

  const toggleSelectAll = useCallback(() => {
    setSelected((prev) => {
      const everySelected = downloads.length > 0 && downloads.every((download) => prev.has(download.id));
      return everySelected ? new Set() : new Set(downloads.map((download) => download.id));
    });
  }, [downloads]);

  const handleDownload = useCallback(
    async (modelId: string) => {
      try {
        await downloadsApi.downloadFile(modelId, 'original');
        toast(t('downloads.downloadStarted'), 'success');
      } catch (err: unknown) {
        toast(getErrorMessage(err, t('downloads.downloadFailed')), 'error');
      }
    },
    [t, toast],
  );

  const handleDeleteOne = useCallback(
    async (id: string) => {
      try {
        await downloadsApi.deleteOne(id);
        mutate();
        toast(t('downloads.deleted'), 'success');
      } catch {
        toast(t('downloads.deleteFailed'), 'error');
      }
    },
    [mutate, t, toast],
  );

  const handleBatchDelete = useCallback(() => {
    if (selected.size === 0) return;
    setConfirmOpen(true);
  }, [selected]);

  const confirmBatchDelete = useCallback(async () => {
    setConfirmOpen(false);
    try {
      await downloadsApi.batchDelete(Array.from(selected));
      setSelected(new Set());
      setSelectMode(false);
      mutate();
      toast(t('downloads.batchDeleteSuccess', { count: selected.size }), 'success');
    } catch {
      toast(t('downloads.deleteFailed'), 'error');
    }
  }, [selected, mutate, t, toast]);

  const handleBatchDownload = useCallback(async () => {
    if (selected.size === 0 || batchDownloading) return;
    const ids = Array.from(selected);
    const count = ids.length;
    setBatchDownloading(true);
    toast(t('downloads.batchDownloadPreparing', { count }), 'info');
    try {
      const result = await downloadsApi.batchDownload(ids);
      toast(t('downloads.batchDownloadSubmitted', { count: result.fileCount }), 'success');
    } catch (err: unknown) {
      toast(getErrorMessage(err, t('downloads.batchDownloadFailed')), 'error');
    } finally {
      setBatchDownloading(false);
    }
  }, [batchDownloading, selected, t, toast]);

  if (isLoading) {
    return (
      <AdminManagementPage title={t('downloads.title')} description={t('downloads.description')}>
        <AdminLoadingState variant="list" media label={t('downloads.loading')} />
      </AdminManagementPage>
    );
  }

  if (error) {
    return (
      <AdminManagementPage title={t('downloads.title')} description={t('downloads.description')}>
        <AdminErrorState
          title={t('downloads.loadFailed')}
          description={t('downloads.loadFailedDescription')}
          onRetry={() => mutate()}
        />
      </AdminManagementPage>
    );
  }

  const headerActions =
    downloads.length > 0 ? (
      <>
        {selectMode && (
          <button onClick={toggleSelectAll} className="text-sm text-primary hover:underline">
            {allSelected ? t('downloads.unselectAll') : t('downloads.selectAll')}
          </button>
        )}
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
          {selectMode ? t('downloads.cancelSelect') : t('downloads.batchOperation')}
        </button>
      </>
    ) : null;

  return (
    <AdminManagementPage
      title={t('downloads.title')}
      meta={t('downloads.recordsCount', { count: downloads.length })}
      description={t('downloads.description')}
      actions={headerActions}
    >
      {/* Batch toolbar */}
      <AnimatePresence>
        {selectMode && selected.size > 0 && (
          <div className="mb-4">
            <BatchToolbar
              selectedCount={selected.size}
              onDownload={handleBatchDownload}
              onDelete={handleBatchDelete}
              downloading={batchDownloading}
              onCancel={() => {
                setSelectMode(false);
                setSelected(new Set());
              }}
            />
          </div>
        )}
      </AnimatePresence>

      {batchDownloading && (
        <div
          role="status"
          aria-live="polite"
          className="mb-4 flex items-center gap-2 px-4 py-3 bg-primary-container/10 rounded-lg border border-primary/20"
        >
          <Icon name="progress_activity" size={18} className="text-primary animate-spin" />
          <span className="text-sm text-primary">{t('downloads.batchDownloadingStatus')}</span>
        </div>
      )}

      {downloads.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex flex-col gap-2.5">
          {visibleDownloads.map((item) => (
            <div
              key={item.id}
              className={`flex items-center gap-0 rounded-lg border bg-surface-container-low shadow-[0_6px_18px_rgba(15,23,42,0.025)] transition-[background-color,border-color,box-shadow] duration-150 ${
                selectMode && selected.has(item.id)
                  ? 'border-primary/35 bg-primary-container/8 ring-1 ring-primary/20'
                  : 'border-outline-variant/16 hover:border-primary/22 hover:bg-surface-container hover:shadow-[0_8px_22px_rgba(15,23,42,0.04)]'
              }`}
            >
              {selectMode && (
                <button
                  onClick={() => toggleSelect(item.id)}
                  className={`ml-3 shrink-0 w-5 h-5 rounded-sm border-2 flex items-center justify-center transition-[background-color,border-color,opacity] duration-150 ease-out ${
                    selected.has(item.id)
                      ? 'bg-primary border-primary'
                      : 'bg-surface/80 border-outline-variant/40 hover:border-primary'
                  }`}
                >
                  {selected.has(item.id) && <Icon name="check" size={12} className="text-on-primary" />}
                </button>
              )}
              <Link
                to={`/model/${item.modelId}`}
                state={{ modelName: item.model?.name || t('downloads.unknownModel') }}
                onPointerDown={() =>
                  cacheModelDetailTitle(item.modelId, item.model?.name || t('downloads.unknownModel'))
                }
                onFocus={() => cacheModelDetailTitle(item.modelId, item.model?.name || t('downloads.unknownModel'))}
                className="min-w-0 flex-1 flex items-center gap-3 rounded-md px-3 py-2.5 transition-colors md:px-4 md:py-3 md:gap-4"
              >
                <div className="w-14 h-14 bg-surface-container-lowest shrink-0 flex items-center justify-center p-1 rounded-md overflow-hidden">
                  <ModelThumbnail src={item.model?.thumbnail_url} alt="" className="w-full h-full object-contain" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-medium text-on-surface truncate">
                    {item.model?.name || t('downloads.unknownModel')}
                  </h3>
                  <div className="flex gap-3 text-xs text-on-surface-variant mt-1">
                    <span>{item.format?.toUpperCase() || '-'}</span>
                    <span>{formatFileSize(item.fileSize)}</span>
                    <span>{formatDate(item.createdAt, t, i18n.language)}</span>
                  </div>
                </div>
              </Link>
              <div className="flex shrink-0 items-center gap-1.5 pr-4">
                <button
                  onClick={() => handleDownload(item.modelId)}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-on-primary bg-primary-container rounded-sm hover:opacity-90 transition-opacity"
                >
                  <Icon name="download" size={14} />
                  {t('downloads.downloadAgain')}
                </button>
                {!selectMode && (
                  <button
                    onClick={() => handleDeleteOne(item.id)}
                    className="p-1.5 text-on-surface-variant/40 hover:text-error rounded-sm hover:bg-error/10 transition-colors"
                  >
                    <Icon name="delete" size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
          <InfiniteLoadTrigger hasMore={hasMore} isLoading={false} onLoadMore={loadMore} />
        </div>
      )}
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={confirmBatchDelete}
        title={t('downloads.confirmDeleteTitle')}
        description={t('downloads.confirmDeleteDescription', { count: selected.size })}
        confirmLabel={t('downloads.deleteHistory')}
      />
    </AdminManagementPage>
  );
}

function MobileContent() {
  const { i18n, t } = useTranslation();
  const { data, error, isLoading, mutate } = useSWR('/downloads', () => downloadsApi.list());
  const { toast } = useToast();
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchDownloading, setBatchDownloading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const downloads = useMemo(() => data || [], [data]);
  const {
    visibleItems: visibleDownloads,
    hasMore,
    loadMore,
  } = useVisibleItems(downloads, 40, String(downloads.length));

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allSelected = downloads.length > 0 && downloads.every((download) => selected.has(download.id));

  const toggleSelectAll = useCallback(() => {
    setSelected((prev) => {
      const everySelected = downloads.length > 0 && downloads.every((download) => prev.has(download.id));
      return everySelected ? new Set() : new Set(downloads.map((download) => download.id));
    });
  }, [downloads]);

  const handleDownload = useCallback(
    async (modelId: string) => {
      try {
        await downloadsApi.downloadFile(modelId, 'original');
        toast(t('downloads.downloadStarted'), 'success');
      } catch (err: unknown) {
        toast(getErrorMessage(err, t('downloads.downloadFailed')), 'error');
      }
    },
    [t, toast],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await downloadsApi.deleteOne(id);
        mutate();
        toast(t('downloads.deleted'), 'success');
      } catch {
        toast(t('downloads.deleteFailed'), 'error');
      }
    },
    [mutate, t, toast],
  );

  const handleBatchDelete = useCallback(() => {
    if (selected.size === 0) return;
    setConfirmOpen(true);
  }, [selected]);

  const confirmBatchDelete = useCallback(async () => {
    setConfirmOpen(false);
    try {
      await downloadsApi.batchDelete(Array.from(selected));
      setSelected(new Set());
      setSelectMode(false);
      mutate();
      toast(t('downloads.batchDeleteSuccess', { count: selected.size }), 'success');
    } catch {
      toast(t('downloads.deleteFailed'), 'error');
    }
  }, [selected, mutate, t, toast]);

  const handleBatchDownload = useCallback(async () => {
    if (selected.size === 0 || batchDownloading) return;
    const ids = Array.from(selected);
    const count = ids.length;
    setBatchDownloading(true);
    toast(t('downloads.batchDownloadPreparing', { count }), 'info');
    try {
      const result = await downloadsApi.batchDownload(ids);
      toast(t('downloads.batchDownloadSubmitted', { count: result.fileCount }), 'success');
    } catch (err: unknown) {
      toast(getErrorMessage(err, t('downloads.batchDownloadFailed')), 'error');
    } finally {
      setBatchDownloading(false);
    }
  }, [batchDownloading, selected, t, toast]);

  return (
    <AdminManagementPage
      title={t('downloads.title')}
      meta={t('downloads.recordsCount', { count: downloads.length })}
      description={t('downloads.description')}
      actions={
        downloads.length > 0 ? (
          <button
            onClick={() => {
              setSelectMode(!selectMode);
              setSelected(new Set());
            }}
            className={`text-xs px-2.5 py-1 rounded-sm border transition-colors ${
              selectMode ? 'text-primary border-primary/30' : 'text-on-surface-variant border-outline-variant/20'
            }`}
          >
            {selectMode ? t('downloads.cancel') : t('downloads.batchOperation')}
          </button>
        ) : null
      }
    >
      {/* Mobile batch toolbar */}
      <AnimatePresence>
        {selectMode && (
          <motion.div
            variants={toolbarMotion}
            initial="initial"
            animate="animate"
            exit="exit"
            className="mb-3 flex items-center gap-2 bg-surface-container-high rounded-lg px-3 py-2.5 border border-outline-variant/10"
          >
            <button onClick={toggleSelectAll} className="text-xs text-primary">
              {allSelected ? t('downloads.unselectAll') : t('downloads.selectAll')}
            </button>
            <div className="flex-1" />
            <span className="text-xs text-on-surface-variant">
              {t('downloads.selectedShort', { count: selected.size })}
            </span>
            <button
              onClick={handleBatchDownload}
              disabled={selected.size === 0 || batchDownloading}
              className="flex items-center gap-1 text-xs text-on-surface-variant hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-60 px-2 py-1"
            >
              {batchDownloading && <Icon name="progress_activity" size={12} className="animate-spin" />}
              {batchDownloading ? t('downloads.packing') : t('downloads.batchDownload')}
            </button>
            <button
              disabled={selected.size === 0 || batchDownloading}
              onClick={handleBatchDelete}
              className="text-xs text-error disabled:cursor-not-allowed disabled:opacity-60 px-2 py-1"
            >
              {t('downloads.deleteHistory')}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {batchDownloading && (
        <div
          role="status"
          aria-live="polite"
          className="mb-3 flex items-center gap-2 px-3 py-2 bg-primary-container/10 rounded-lg border border-primary/20"
        >
          <Icon name="progress_activity" size={14} className="text-primary animate-spin" />
          <span className="text-xs text-primary">{t('downloads.batchDownloadingStatus')}</span>
        </div>
      )}

      {isLoading ? (
        <AdminLoadingState variant="list" rows={5} media label={t('downloads.loading')} />
      ) : error ? (
        <AdminErrorState
          title={t('downloads.loadFailed')}
          description={t('downloads.loadFailedDescription')}
          onRetry={() => mutate()}
        />
      ) : downloads.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex flex-col gap-3">
          {visibleDownloads.map((item) => (
            <div
              key={item.id}
              className={`relative overflow-hidden rounded-xl border bg-surface-container-low shadow-[0_6px_18px_rgba(15,23,42,0.03)] transition-[background-color,border-color,box-shadow] ${
                selectMode && selected.has(item.id)
                  ? 'border-primary/45 ring-2 ring-primary/25'
                  : 'border-outline-variant/16'
              }`}
            >
              {selectMode && (
                <button
                  onClick={() => toggleSelect(item.id)}
                  className={`absolute top-2 left-2 z-10 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-[background-color,border-color,opacity] duration-150 ease-out ${
                    selected.has(item.id) ? 'bg-primary border-primary' : 'bg-surface/80 border-outline-variant/40'
                  }`}
                >
                  {selected.has(item.id) && <Icon name="check" size={12} className="text-on-primary" />}
                </button>
              )}
              <Link
                to={`/model/${item.modelId}`}
                state={{ modelName: item.model?.name || t('downloads.unknownModel') }}
                onPointerDown={() =>
                  cacheModelDetailTitle(item.modelId, item.model?.name || t('downloads.unknownModel'))
                }
                onFocus={() => cacheModelDetailTitle(item.modelId, item.model?.name || t('downloads.unknownModel'))}
                className="flex h-20"
              >
                <div className="w-20 h-20 bg-surface-container-lowest shrink-0 overflow-hidden">
                  <ModelThumbnail src={item.model?.thumbnail_url} alt="" className="w-full h-full object-cover" />
                </div>
                <div className="flex-1 min-w-0 px-3 pt-2.5 pb-2 flex flex-col justify-between">
                  <h3 className="text-sm text-on-surface leading-snug line-clamp-1">
                    {item.model?.name || t('downloads.unknownModel')}
                  </h3>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-on-surface-variant/50">
                      {formatFileSize(item.fileSize)} · {formatDate(item.createdAt, t, i18n.language)}
                    </span>
                    {!selectMode && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleDownload(item.modelId);
                          }}
                          className="flex items-center justify-center w-7 h-7 rounded-lg text-on-surface-variant active:scale-[0.95] transition-transform"
                        >
                          <Icon name="download" size={16} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleDelete(item.id);
                          }}
                          className="flex items-center justify-center w-7 h-7 rounded-lg text-on-surface-variant hover:text-error transition-colors"
                        >
                          <Icon name="delete" size={16} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            </div>
          ))}
          <InfiniteLoadTrigger hasMore={hasMore} isLoading={false} onLoadMore={loadMore} />
        </div>
      )}
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={confirmBatchDelete}
        title={t('downloads.confirmDeleteTitle')}
        description={t('downloads.confirmDeleteDescription', { count: selected.size })}
        confirmLabel={t('downloads.deleteHistory')}
      />
    </AdminManagementPage>
  );
}

export default function DownloadsPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('downloads.title'));
  const isDesktop = useMediaQuery('(min-width: 768px)');

  return <AdminPageShell>{isDesktop ? <DesktopContent /> : <MobileContent />}</AdminPageShell>;
}
