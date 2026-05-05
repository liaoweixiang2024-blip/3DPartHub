import { motion, AnimatePresence } from 'framer-motion';
import { useState, useCallback, memo, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import client from '../api/client';
import { downloadModelFile, isDownloadAuthRequiredError } from '../api/downloads';
import { favoriteApi } from '../api/favorites';
import type { FavoriteItem } from '../api/favorites';
import { AdminEmptyState, AdminManagementPage } from '../components/shared/AdminManagementPage';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import Icon from '../components/shared/Icon';
import LoginConfirmDialog from '../components/shared/LoginConfirmDialog';
import { isLoginDialogEnabled } from '../components/shared/ProtectedLink';
import ModelThumbnail from '../components/shared/ModelThumbnail';
import { SkeletonGrid } from '../components/shared/Skeleton';
import { useToast } from '../components/shared/Toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useMediaQuery } from '../layouts/hooks/useMediaQuery';
import { useFavoriteStore } from '../stores/useFavoriteStore';

interface FavoriteModel {
  id: string;
  name: string;
  format: string;
  thumbnailUrl: string | null;
  createdAt: string;
}

function mapFavorites(items: any[]): FavoriteModel[] {
  return items.map((item) => ({
    id: item.model?.id || item.modelId,
    name: item.model?.name || '未命名模型',
    format: item.model?.format || '',
    thumbnailUrl: item.model?.thumbnailUrl || item.model?.thumbnail_url || null,
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
  return (
    <AdminEmptyState
      icon="star"
      title={message}
      description="收藏后的模型会集中显示在这里，方便后续查看和下载。"
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
}: {
  selectedCount: number;
  onDownload: () => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="bg-surface-container-high border border-outline-variant/20 rounded-lg px-4 py-3 flex items-center gap-3 shadow-lg"
    >
      <span className="text-sm text-on-surface font-medium">已选 {selectedCount} 个</span>
      <div className="flex-1" />
      <button
        onClick={onDownload}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-on-primary bg-primary-container rounded-sm hover:opacity-90 transition-opacity"
      >
        <Icon name="download" size={14} />
        下载 STEP
      </button>
      <button
        onClick={onRemove}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-error bg-error/10 rounded-sm border border-error/20 hover:bg-error/20 transition-colors"
      >
        <Icon name="star_off" size={14} />
        取消收藏
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
  return (
    <div
      className={`bg-surface-container-high rounded-sm group relative transition-all flex flex-col ${selected ? 'ring-2 ring-primary shadow-[0_0_0_1px_var(--color-primary)]' : 'hover:shadow-[0_12px_24px_rgba(0,0,0,0.4)]'}`}
    >
      <div className="aspect-[4/3] bg-surface-container-lowest w-full relative overflow-hidden flex items-center justify-center">
        <Link to={`/model/${model.id}`} className="absolute inset-0 z-0">
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
            className={`absolute top-2 left-2 z-10 w-6 h-6 rounded-sm border-2 flex items-center justify-center transition-all ${
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
            onRemove(model.id);
          }}
          className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity w-7 h-7 flex items-center justify-center rounded-full bg-surface/80 backdrop-blur-sm text-on-surface-variant hover:text-error hover:bg-error/20"
        >
          <Icon name="star_off" size={14} />
        </button>
      </div>
      <div className="flex-1 flex flex-col p-2.5">
        <Link to={`/model/${model.id}`}>
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
            下载
          </button>
          <Link
            to={`/model/${model.id}`}
            className="flex-1 border border-outline-variant/40 text-on-surface-variant hover:text-on-surface rounded-sm py-1.5 px-3 text-xs text-center flex items-center justify-center gap-1"
          >
            <Icon name="visibility" size={14} />
            预览
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
  return (
    <div
      className={`bg-surface-container-high rounded-xl border relative transition-all overflow-hidden ${selected ? 'border-primary ring-2 ring-primary/30' : 'border-outline-variant/10'}`}
    >
      {showCheckbox && (
        <button
          onClick={() => onSelect(model.id)}
          className={`absolute top-2 left-2 z-10 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
            selected ? 'bg-primary border-primary' : 'bg-surface/80 border-outline-variant/40'
          }`}
        >
          {selected && <Icon name="check" size={12} className="text-on-primary" />}
        </button>
      )}
      <Link to={`/model/${model.id}`} className="flex h-20">
        <div className="w-20 h-20 bg-surface-container-lowest flex-shrink-0 overflow-hidden">
          <ModelThumbnail src={model.thumbnailUrl} alt={model.name} className="w-full h-full object-cover" />
        </div>
        <div className="flex-1 min-w-0 px-3 pt-3 pb-2 flex flex-col justify-between">
          <h3 className="text-sm text-on-surface leading-snug line-clamp-1">{model.name}</h3>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-on-surface-variant/50">
              {model.format.toUpperCase()} · {new Date(model.createdAt).toLocaleDateString('zh-CN')}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDownload(model.id);
                }}
                className="flex items-center justify-center w-7 h-7 rounded-lg text-on-surface-variant active:scale-[0.95] transition-transform"
                aria-label="下载"
              >
                <Icon name="download" size={16} />
              </button>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onRemove(model.id);
                }}
                className="flex items-center justify-center w-7 h-7 rounded-lg text-on-surface-variant hover:text-error transition-colors"
                aria-label="取消收藏"
              >
                <Icon name="star_off" size={16} />
              </button>
            </div>
          </div>
        </div>
      </Link>
    </div>
  );
});

function DesktopContent() {
  const navigate = useNavigate();
  const { data, error, isLoading, mutate } = useSWR<FavoriteItem[]>('/favorites', () =>
    client.get('/favorites').then((r) => r.data?.data || r.data),
  );
  const { toast } = useToast();
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);

  const handleRemove = useCallback(
    async (modelId: string) => {
      try {
        await favoriteApi.remove(modelId);
        const store = useFavoriteStore.getState();
        const updated = new Set(store.favoriteIds);
        updated.delete(modelId);
        useFavoriteStore.setState({ favoriteIds: updated });
        mutate();
        toast('已取消收藏', 'success');
      } catch {
        toast('取消收藏失败，请重试', 'error');
      }
    },
    [mutate, toast],
  );

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (!data) return;
    setSelected(new Set(mapFavorites(data).map((m) => m.id)));
  }, [data]);

  const handleBatchRemove = useCallback(async () => {
    if (selected.size === 0) return;
    try {
      await favoriteApi.batchRemove(Array.from(selected));
      const store = useFavoriteStore.getState();
      const updated = new Set(store.favoriteIds);
      selected.forEach((id) => updated.delete(id));
      useFavoriteStore.setState({ favoriteIds: updated });
      setSelected(new Set());
      setSelectMode(false);
      mutate();
      toast(`已取消收藏 ${selected.size} 个模型`, 'success');
    } catch {
      toast('批量取消收藏失败', 'error');
    }
  }, [selected, mutate, toast]);

  const handleBatchDownload = useCallback(
    async (format: string = 'original') => {
      if (selected.size === 0) return;
      setDownloading(true);
      try {
        await favoriteApi.batchDownload(Array.from(selected), format);
        toast('下载已开始', 'success');
      } catch (err: any) {
        toast(err.message || '下载失败', 'error');
      } finally {
        setDownloading(false);
      }
    },
    [selected, toast],
  );

  const handleSingleDownload = useCallback(
    async (modelId: string) => {
      try {
        await downloadModelFile(modelId, 'original');
      } catch (error) {
        if (isDownloadAuthRequiredError(error)) {
          if (isLoginDialogEnabled()) {
            setLoginDialogOpen(true);
          } else {
            navigate('/login', { state: { from: '/favorites' } });
          }
        } else {
          toast('下载失败', 'error');
        }
      }
    },
    [toast],
  );

  const models = useMemo(() => (data ? mapFavorites(data) : []), [data]);

  if (isLoading) {
    return <SkeletonGrid count={8} />;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <Icon name="error" size={48} className="text-error" />
        <p className="text-on-surface-variant text-sm">加载收藏失败</p>
        <button onClick={() => location.reload()} className="text-primary text-sm hover:underline">
          重试
        </button>
      </div>
    );
  }

  const headerActions =
    models.length > 0 ? (
      <>
        {selectMode ? (
          <button onClick={selectAll} className="text-sm text-primary hover:underline">
            {selected.size === models.length ? '取消全选' : '全选'}
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
          {selectMode ? '取消选择' : '批量操作'}
        </button>
      </>
    ) : null;

  return (
    <AdminManagementPage
      title="我的收藏"
      meta={`${models.length} 个模型`}
      description={models.length > 1 ? '点击「批量操作」可多选后一键下载 STEP 文件' : '管理你收藏的模型'}
      actions={headerActions}
    >
      {/* Batch toolbar */}
      <AnimatePresence>
        {selectMode && selected.size > 0 && !downloading && (
          <div className="mb-4">
            <BatchToolbar
              selectedCount={selected.size}
              onDownload={() => handleBatchDownload('original')}
              onRemove={handleBatchRemove}
              onCancel={() => {
                setSelectMode(false);
                setSelected(new Set());
              }}
            />
          </div>
        )}
      </AnimatePresence>

      {downloading && (
        <div className="mb-4 flex items-center gap-2 px-4 py-3 bg-primary-container/10 rounded-lg border border-primary/20">
          <Icon name="progress_activity" size={18} className="text-primary animate-spin" />
          <span className="text-sm text-primary">正在打包下载...</span>
        </div>
      )}

      {models.length === 0 ? (
        <EmptyState message="尚未收藏任何模型" actionLabel="浏览模型库" actionHref="/" />
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
            className="bg-surface-container-lowest border border-outline-variant/20 border-dashed rounded-sm group cursor-pointer hover:border-primary/50 hover:bg-surface-container-low transition-all flex flex-col items-center justify-center min-h-[200px]"
          >
            <div className="w-12 h-12 rounded-sm bg-surface-container-high flex items-center justify-center mb-3 group-hover:text-primary transition-colors text-on-surface-variant">
              <Icon name="search" size={32} />
            </div>
            <span className="font-headline text-sm font-semibold text-on-surface">浏览模型库</span>
            <span className="text-xs text-on-secondary-container mt-1">发现更多模型</span>
          </Link>
        </div>
      )}
      <LoginConfirmDialog open={loginDialogOpen} onClose={() => setLoginDialogOpen(false)} reason="下载模型" />
    </AdminManagementPage>
  );
}

function MobileContent() {
  const navigate = useNavigate();
  const { data, error, isLoading, mutate } = useSWR<FavoriteItem[]>('/favorites', () =>
    client.get('/favorites').then((r) => r.data?.data || r.data),
  );
  const { toast } = useToast();
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);

  const handleRemove = useCallback(
    async (modelId: string) => {
      try {
        await favoriteApi.remove(modelId);
        const store = useFavoriteStore.getState();
        const updated = new Set(store.favoriteIds);
        updated.delete(modelId);
        useFavoriteStore.setState({ favoriteIds: updated });
        mutate();
        toast('已取消收藏', 'success');
      } catch {
        toast('取消收藏失败，请重试', 'error');
      }
    },
    [mutate, toast],
  );

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const models = useMemo(() => (data ? mapFavorites(data) : []), [data]);

  const selectAll = useCallback(() => {
    setSelected(new Set(models.map((m) => m.id)));
  }, [models]);

  const handleBatchRemove = useCallback(async () => {
    if (selected.size === 0) return;
    try {
      await favoriteApi.batchRemove(Array.from(selected));
      const store = useFavoriteStore.getState();
      const updated = new Set(store.favoriteIds);
      selected.forEach((id) => updated.delete(id));
      useFavoriteStore.setState({ favoriteIds: updated });
      setSelected(new Set());
      setSelectMode(false);
      mutate();
      toast(`已取消收藏 ${selected.size} 个模型`, 'success');
    } catch {
      toast('批量取消收藏失败', 'error');
    }
  }, [selected, mutate, toast]);

  const handleBatchDownload = useCallback(
    async (format: string = 'original') => {
      if (selected.size === 0) return;
      setDownloading(true);
      try {
        await favoriteApi.batchDownload(Array.from(selected), format);
        toast('下载已开始', 'success');
      } catch (err: any) {
        toast(err.message || '下载失败', 'error');
      } finally {
        setDownloading(false);
      }
    },
    [selected, toast],
  );

  const handleSingleDownload = useCallback(
    async (modelId: string) => {
      try {
        await downloadModelFile(modelId, 'original');
      } catch (error) {
        if (isDownloadAuthRequiredError(error)) {
          if (isLoginDialogEnabled()) {
            setLoginDialogOpen(true);
          } else {
            navigate('/login', { state: { from: '/favorites' } });
          }
        } else {
          toast('下载失败', 'error');
        }
      }
    },
    [toast],
  );

  return (
    <AdminManagementPage
      title="我的收藏"
      meta={`${models.length} 个模型`}
      description="管理你收藏的模型"
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
            {selectMode ? '取消' : '批量操作'}
          </button>
        ) : null
      }
    >
      {/* Mobile batch toolbar */}
      <AnimatePresence>
        {selectMode && !downloading && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="mb-3 flex items-center gap-2 bg-surface-container-high rounded-lg px-3 py-2.5 border border-outline-variant/10"
          >
            <button onClick={selectAll} className="text-xs text-primary">
              全选
            </button>
            <div className="flex-1" />
            <span className="text-xs text-on-surface-variant">{selected.size} 已选</span>
            <button
              onClick={() => handleBatchDownload('original')}
              className="text-xs text-on-surface-variant hover:text-on-surface px-2 py-1"
            >
              下载 STEP
            </button>
            <button onClick={handleBatchRemove} className="text-xs text-error px-2 py-1">
              取消收藏
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {downloading && (
        <div className="mb-3 flex items-center gap-2 px-3 py-2 bg-primary-container/10 rounded-lg border border-primary/20">
          <Icon name="progress_activity" size={14} className="text-primary animate-spin" />
          <span className="text-xs text-primary">正在打包下载...</span>
        </div>
      )}

      {isLoading ? (
        <SkeletonGrid compact count={6} />
      ) : error ? (
        <div className="flex flex-col items-center gap-3 py-16">
          <Icon name="error" size={40} className="text-error" />
          <p className="text-on-surface-variant text-sm">加载失败</p>
        </div>
      ) : models.length === 0 ? (
        <EmptyState message="尚未收藏任何模型" actionLabel="浏览模型库" actionHref="/" />
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
      <LoginConfirmDialog open={loginDialogOpen} onClose={() => setLoginDialogOpen(false)} reason="下载模型" />
    </AdminManagementPage>
  );
}

export default function FavoritesPage() {
  useDocumentTitle('我的收藏');
  const isDesktop = useMediaQuery('(min-width: 768px)');

  return <AdminPageShell>{isDesktop ? <DesktopContent /> : <MobileContent />}</AdminPageShell>;
}
