import { useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import useSWR from 'swr';
import { useMediaQuery } from '../layouts/hooks/useMediaQuery';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { SkeletonList } from '../components/shared/Skeleton';
import Icon from '../components/shared/Icon';
import ModelThumbnail from '../components/shared/ModelThumbnail';
import InfiniteLoadTrigger from '../components/shared/InfiniteLoadTrigger';
import { AdminPageShell } from "../components/shared/AdminPageShell";
import { AdminEmptyState, AdminManagementPage } from "../components/shared/AdminManagementPage";
import { useToast } from '../components/shared/Toast';
import { downloadsApi } from '../api/downloads';
import { getErrorMessage } from '../lib/errorNotifications';
import { useVisibleItems } from '../hooks/useVisibleItems';

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
      action={(
        <Link
          to="/"
          className="rounded-md bg-primary-container px-5 py-2.5 text-sm font-semibold text-on-primary transition-opacity hover:opacity-90"
        >
          浏览模型库
        </Link>
      )}
    />
  );
}

// Desktop batch toolbar
function BatchToolbar({ selectedCount, onDelete, onCancel }: {
  selectedCount: number;
  onDelete: () => void;
  onCancel: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className="bg-surface-container-high border border-outline-variant/20 rounded-lg px-4 py-3 flex items-center gap-3 shadow-lg"
    >
      <span className="text-sm text-on-surface font-medium">已选 {selectedCount} 条</span>
      <div className="flex-1" />
      <button
        onClick={onDelete}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-error bg-error/10 rounded-sm border border-error/20 hover:bg-error/20 transition-colors"
      >
        <Icon name="delete" size={14} />删除所选
      </button>
      <button
        onClick={onCancel}
        className="flex items-center justify-center w-7 h-7 text-on-surface-variant hover:text-on-surface rounded-sm hover:bg-surface-container-high transition-colors"
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

  const downloads = useMemo(() => data || [], [data]);
  const { visibleItems: visibleDownloads, hasMore, loadMore } = useVisibleItems(downloads, 60, String(downloads.length));

  const toggleSelect = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(downloads.map(d => d.id)));
  }, [downloads]);

  const handleDownload = useCallback(async (modelId: string) => {
    try {
      await downloadsApi.downloadFile(modelId, 'original');
      toast('下载已开始', 'success');
    } catch (err: unknown) {
      toast(getErrorMessage(err, '下载失败'), 'error');
    }
  }, [toast]);

  const handleDeleteOne = useCallback(async (id: string) => {
    try {
      await downloadsApi.deleteOne(id);
      mutate();
      toast('已删除', 'success');
    } catch {
      toast('删除失败', 'error');
    }
  }, [mutate, toast]);

  const handleBatchDelete = useCallback(async () => {
    if (selected.size === 0) return;
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

  const handleClearAll = useCallback(async () => {
    if (!window.confirm('确定要清空所有下载记录吗？')) return;
    try {
      await downloadsApi.clearAll();
      setSelected(new Set());
      setSelectMode(false);
      mutate();
      toast('已清空下载记录', 'success');
    } catch {
      toast('清空失败', 'error');
    }
  }, [mutate, toast]);

  if (isLoading) {
    return <SkeletonList rows={6} />;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <Icon name="error" size={48} className="text-error" />
        <p className="text-on-surface-variant text-sm">加载下载历史失败</p>
        <button onClick={() => location.reload()} className="text-primary text-sm hover:underline">重试</button>
      </div>
    );
  }

  const headerActions = downloads.length > 0 ? (
    <>
      {selectMode && (
        <button onClick={selectAll} className="text-sm text-primary hover:underline">
          {selected.size === downloads.length ? '取消全选' : '全选'}
        </button>
      )}
      <button
        onClick={() => { setSelectMode(!selectMode); setSelected(new Set()); }}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-sm border transition-colors ${
          selectMode ? 'text-primary border-primary/30 bg-primary-container/10' : 'text-on-surface-variant border-outline-variant/20 hover:text-on-surface hover:border-outline-variant/40'
        }`}
      >
        <Icon name={selectMode ? "close" : "checklist"} size={16} />
        {selectMode ? '取消选择' : '批量操作'}
      </button>
      {!selectMode && (
        <button
          onClick={handleClearAll}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-sm border border-error/20 text-error/70 hover:text-error hover:border-error/40 transition-colors"
        >
          <Icon name="delete" size={14} />
          清空
        </button>
      )}
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
          <div className="flex items-center gap-2">
            <BatchToolbar
              selectedCount={selected.size}
              onDelete={handleBatchDelete}
              onCancel={() => { setSelectMode(false); setSelected(new Set()); }}
            />
          </div>
        )}
      </AnimatePresence>

      {downloads.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex flex-col gap-2">
          {visibleDownloads.map((item) => (
            <div
              key={item.id}
              className={`bg-surface-container-low rounded-lg border transition-all flex items-center gap-4 ${
                selectMode && selected.has(item.id) ? 'border-primary ring-1 ring-primary/30' : 'border-outline-variant/10 hover:bg-surface-container-high'
              }`}
            >
              {selectMode && (
                <button
                  onClick={() => toggleSelect(item.id)}
                  className={`ml-3 shrink-0 w-5 h-5 rounded-sm border-2 flex items-center justify-center transition-all ${
                    selected.has(item.id) ? 'bg-primary border-primary' : 'bg-surface/80 border-outline-variant/40 hover:border-primary'
                  }`}
                >
                  {selected.has(item.id) && <Icon name="check" size={12} className="text-on-primary" />}
                </button>
              )}
              <div className="w-16 h-16 bg-surface-container-lowest shrink-0 flex items-center justify-center p-1 rounded-md overflow-hidden m-3">
                <ModelThumbnail src={item.model?.thumbnail_url} alt="" className="w-full h-full object-contain" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-medium text-on-surface truncate">{item.model?.name || '未知模型'}</h3>
                <div className="flex gap-3 text-xs text-on-surface-variant mt-1">
                  <span>{item.format?.toUpperCase() || '-'}</span>
                  <span>{formatFileSize(item.fileSize)}</span>
                  <span>{formatDate(item.createdAt)}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 pr-4">
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
                    title="删除"
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
    </AdminManagementPage>
  );
}

function MobileContent() {
  const { data, error, isLoading, mutate } = useSWR('/downloads', () => downloadsApi.list());
  const { toast } = useToast();
  const downloads = data || [];
  const { visibleItems: visibleDownloads, hasMore, loadMore } = useVisibleItems(downloads, 40, String(downloads.length));

  const handleDownload = useCallback(async (modelId: string) => {
    try {
      await downloadsApi.downloadFile(modelId, 'original');
      toast('下载已开始', 'success');
    } catch (err: unknown) {
      toast(getErrorMessage(err, '下载失败'), 'error');
    }
  }, [toast]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await downloadsApi.deleteOne(id);
      mutate();
      toast('已删除', 'success');
    } catch {
      toast('删除失败', 'error');
    }
  }, [mutate, toast]);

  const handleClearAll = useCallback(async () => {
    if (!window.confirm('确定要清空所有下载记录吗？')) return;
    try {
      await downloadsApi.clearAll();
      mutate();
      toast('已清空', 'success');
    } catch {
      toast('清空失败', 'error');
    }
  }, [mutate, toast]);

  return (
    <AdminManagementPage
      title="下载历史"
      meta={`${downloads.length} 条记录`}
      description="查看和管理你下载过的模型文件"
      actions={downloads.length > 0 ? (
          <button
            onClick={handleClearAll}
            className="text-xs text-error/70 hover:text-error px-2.5 py-1 border border-error/20 rounded-sm transition-colors"
          >
            清空
          </button>
      ) : null}
    >

      {isLoading ? (
        <SkeletonList rows={6} />
      ) : error ? (
        <div className="flex flex-col items-center gap-3 py-16">
          <Icon name="error" size={40} className="text-error" />
          <p className="text-on-surface-variant text-sm">加载失败</p>
        </div>
      ) : downloads.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-2">
          {visibleDownloads.map((item) => (
            <div key={item.id} className="rounded-lg bg-surface-container-high p-3 flex items-center gap-3">
              <div className="w-12 h-12 bg-surface-container-lowest shrink-0 rounded-md flex items-center justify-center overflow-hidden">
                <ModelThumbnail src={item.model?.thumbnail_url} alt="" className="w-full h-full object-cover" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-on-surface line-clamp-2 break-words">{item.model?.name || '未知模型'}</p>
                <p className="text-[11px] text-on-surface-variant mt-0.5 truncate">
                  {formatDate(item.createdAt)} · {formatFileSize(item.fileSize)}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => handleDownload(item.modelId)}
                  className="p-2 text-on-primary bg-primary-container rounded-sm"
                >
                  <Icon name="download" size={16} />
                </button>
                <button
                  onClick={() => handleDelete(item.id)}
                  className="p-2 text-on-surface-variant/50 hover:text-error rounded-sm hover:bg-error/10 transition-colors"
                >
                  <Icon name="delete" size={16} />
                </button>
              </div>
            </div>
          ))}
          <InfiniteLoadTrigger hasMore={hasMore} isLoading={false} onLoadMore={loadMore} />
        </div>
      )}
    </AdminManagementPage>
  );
}

export default function DownloadsPage() {
  useDocumentTitle("下载历史");
  const isDesktop = useMediaQuery('(min-width: 768px)');

  return (
    <AdminPageShell>
      {isDesktop ? <DesktopContent /> : <MobileContent />}
    </AdminPageShell>
  );
}
