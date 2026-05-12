import { AnimatePresence, motion } from 'framer-motion';
import { useState, useCallback, useMemo } from 'react';
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

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return '今天';
  if (diffDays === 1) return '昨天';
  if (diffDays < 7) return `${diffDays}天前`;
  return d.toLocaleDateString('zh-CN');
}

function EmptyState() {
  return (
    <AdminEmptyState
      icon="download"
      title="尚未下载任何模型"
      description="下载过的模型会保留在这里，方便你重新下载和清理记录。"
      action={
        <Link
          to="/"
          className="rounded-md bg-primary-container px-5 py-2.5 text-sm font-semibold text-on-primary transition-opacity hover:opacity-90"
        >
          浏览模型库
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
  return (
    <motion.div
      variants={toolbarMotion}
      initial="initial"
      animate="animate"
      exit="exit"
      className="bg-surface-container-high border border-outline-variant/20 rounded-lg px-4 py-3 flex items-center gap-3 shadow-lg"
    >
      <span className="text-sm text-on-surface font-medium">已选 {selectedCount} 个</span>
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
        {downloading ? '打包中...' : '打包下载'}
      </button>
      <button
        onClick={onDelete}
        disabled={downloading}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-error bg-error/10 rounded-sm border border-error/20 hover:bg-error/20 disabled:cursor-not-allowed disabled:opacity-60 transition-colors"
      >
        <Icon name="delete" size={14} />
        删除历史
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
        toast('下载已开始', 'success');
      } catch (err: unknown) {
        toast(getErrorMessage(err, '下载失败'), 'error');
      }
    },
    [toast],
  );

  const handleDeleteOne = useCallback(
    async (id: string) => {
      try {
        await downloadsApi.deleteOne(id);
        mutate();
        toast('已删除', 'success');
      } catch {
        toast('删除失败', 'error');
      }
    },
    [mutate, toast],
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
      toast(`已删除 ${selected.size} 条记录`, 'success');
    } catch {
      toast('删除失败', 'error');
    }
  }, [selected, mutate, toast]);

  const handleBatchDownload = useCallback(async () => {
    if (selected.size === 0 || batchDownloading) return;
    const ids = Array.from(selected);
    const count = ids.length;
    setBatchDownloading(true);
    toast(`正在打包 ${count} 条下载记录，请稍候...`, 'info');
    try {
      const result = await downloadsApi.batchDownload(ids);
      toast(`下载已提交，浏览器正在接收 ${result.fileCount} 个文件`, 'success');
    } catch (err: unknown) {
      toast(getErrorMessage(err, '打包下载失败'), 'error');
    } finally {
      setBatchDownloading(false);
    }
  }, [batchDownloading, selected, toast]);

  if (isLoading) {
    return (
      <AdminManagementPage title="下载历史" description="查看和管理你下载过的模型文件">
        <AdminLoadingState variant="list" media label="下载历史加载中" />
      </AdminManagementPage>
    );
  }

  if (error) {
    return (
      <AdminManagementPage title="下载历史" description="查看和管理你下载过的模型文件">
        <AdminErrorState
          title="下载历史加载失败"
          description="请稍后重试，或检查当前登录状态。"
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
            {allSelected ? '取消全选' : '全选'}
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
          {selectMode ? '取消选择' : '批量操作'}
        </button>
      </>
    ) : null;

  return (
    <AdminManagementPage
      title="下载历史"
      meta={`${downloads.length} 条记录`}
      description="查看和管理你下载过的模型文件"
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
          <span className="text-sm text-primary">正在打包下载，请稍候...</span>
        </div>
      )}

      {downloads.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex flex-col">
          {visibleDownloads.map((item) => (
            <div
              key={item.id}
              className={`flex items-center gap-0 border-b border-outline-variant/10 last:border-b-0 ${
                selectMode && selected.has(item.id) ? 'bg-primary-container/8 ring-1 ring-primary/20' : ''
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
                state={{ modelName: item.model?.name || '未知模型' }}
                onPointerDown={() => cacheModelDetailTitle(item.modelId, item.model?.name || '未知模型')}
                onFocus={() => cacheModelDetailTitle(item.modelId, item.model?.name || '未知模型')}
                className="min-w-0 flex-1 flex items-center gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-surface-container/45 md:px-4 md:py-3 md:gap-4"
              >
                <div className="w-14 h-14 bg-surface-container-lowest shrink-0 flex items-center justify-center p-1 rounded-md overflow-hidden">
                  <ModelThumbnail src={item.model?.thumbnail_url} alt="" className="w-full h-full object-contain" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-medium text-on-surface truncate">{item.model?.name || '未知模型'}</h3>
                  <div className="flex gap-3 text-xs text-on-surface-variant mt-1">
                    <span>{item.format?.toUpperCase() || '-'}</span>
                    <span>{formatFileSize(item.fileSize)}</span>
                    <span>{formatDate(item.createdAt)}</span>
                  </div>
                </div>
              </Link>
              <div className="flex shrink-0 items-center gap-1.5 pr-4">
                <button
                  onClick={() => handleDownload(item.modelId)}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-on-primary bg-primary-container rounded-sm hover:opacity-90 transition-opacity"
                >
                  <Icon name="download" size={14} />
                  重新下载
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
        title="确认删除历史"
        description={`确定要删除选中的 ${selected.size} 条下载历史吗？`}
        confirmLabel="删除历史"
      />
    </AdminManagementPage>
  );
}

function MobileContent() {
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
        toast('下载已开始', 'success');
      } catch (err: unknown) {
        toast(getErrorMessage(err, '下载失败'), 'error');
      }
    },
    [toast],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await downloadsApi.deleteOne(id);
        mutate();
        toast('已删除', 'success');
      } catch {
        toast('删除失败', 'error');
      }
    },
    [mutate, toast],
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
      toast(`已删除 ${selected.size} 条记录`, 'success');
    } catch {
      toast('删除失败', 'error');
    }
  }, [selected, mutate, toast]);

  const handleBatchDownload = useCallback(async () => {
    if (selected.size === 0 || batchDownloading) return;
    const ids = Array.from(selected);
    const count = ids.length;
    setBatchDownloading(true);
    toast(`正在打包 ${count} 条下载记录，请稍候...`, 'info');
    try {
      const result = await downloadsApi.batchDownload(ids);
      toast(`下载已提交，浏览器正在接收 ${result.fileCount} 个文件`, 'success');
    } catch (err: unknown) {
      toast(getErrorMessage(err, '打包下载失败'), 'error');
    } finally {
      setBatchDownloading(false);
    }
  }, [batchDownloading, selected, toast]);

  return (
    <AdminManagementPage
      title="下载历史"
      meta={`${downloads.length} 条记录`}
      description="查看和管理你下载过的模型文件"
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
            {selectMode ? '取消' : '批量操作'}
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
              {allSelected ? '取消全选' : '全选'}
            </button>
            <div className="flex-1" />
            <span className="text-xs text-on-surface-variant">{selected.size} 已选</span>
            <button
              onClick={handleBatchDownload}
              disabled={selected.size === 0 || batchDownloading}
              className="flex items-center gap-1 text-xs text-on-surface-variant hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-60 px-2 py-1"
            >
              {batchDownloading && <Icon name="progress_activity" size={12} className="animate-spin" />}
              {batchDownloading ? '打包中...' : '打包下载'}
            </button>
            <button
              disabled={selected.size === 0 || batchDownloading}
              onClick={handleBatchDelete}
              className="text-xs text-error disabled:cursor-not-allowed disabled:opacity-60 px-2 py-1"
            >
              删除历史
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
          <span className="text-xs text-primary">正在打包下载，请稍候...</span>
        </div>
      )}

      {isLoading ? (
        <AdminLoadingState variant="list" rows={5} media label="下载历史加载中" />
      ) : error ? (
        <AdminErrorState
          title="下载历史加载失败"
          description="请稍后重试，或检查当前登录状态。"
          onRetry={() => mutate()}
        />
      ) : downloads.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex flex-col gap-2.5">
          {visibleDownloads.map((item) => (
            <div
              key={item.id}
              className={`bg-surface-container-high rounded-xl border overflow-hidden ${
                selectMode && selected.has(item.id)
                  ? 'border-primary ring-2 ring-primary/30'
                  : 'border-outline-variant/10'
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
                state={{ modelName: item.model?.name || '未知模型' }}
                onPointerDown={() => cacheModelDetailTitle(item.modelId, item.model?.name || '未知模型')}
                onFocus={() => cacheModelDetailTitle(item.modelId, item.model?.name || '未知模型')}
                className="flex h-20"
              >
                <div className="w-20 h-20 bg-surface-container-lowest shrink-0 overflow-hidden">
                  <ModelThumbnail src={item.model?.thumbnail_url} alt="" className="w-full h-full object-cover" />
                </div>
                <div className="flex-1 min-w-0 px-3 pt-2.5 pb-2 flex flex-col justify-between">
                  <h3 className="text-sm text-on-surface leading-snug line-clamp-1">
                    {item.model?.name || '未知模型'}
                  </h3>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-on-surface-variant/50">
                      {formatFileSize(item.fileSize)} · {formatDate(item.createdAt)}
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
        title="确认删除历史"
        description={`确定要删除选中的 ${selected.size} 条下载历史吗？`}
        confirmLabel="删除历史"
      />
    </AdminManagementPage>
  );
}

export default function DownloadsPage() {
  useDocumentTitle('下载历史');
  const isDesktop = useMediaQuery('(min-width: 768px)');

  return <AdminPageShell>{isDesktop ? <DesktopContent /> : <MobileContent />}</AdminPageShell>;
}
