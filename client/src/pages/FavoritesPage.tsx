import { useState, useCallback, memo } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import { motion, AnimatePresence } from 'framer-motion';
import { useMediaQuery } from '../layouts/hooks/useMediaQuery';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import TopNav from '../components/shared/TopNav';
import BottomNav from '../components/shared/BottomNav';
import AppSidebar from '../components/shared/Sidebar';
import MobileNavDrawer from '../components/shared/MobileNavDrawer';
import Icon from '../components/shared/Icon';
import Tooltip from '../components/shared/Tooltip';
import { useToast } from '../components/shared/Toast';
import client from '../api/client';
import { favoriteApi } from '../api/favorites';
import { getAccessToken } from '../stores';
import { useFavoriteStore } from '../stores/useFavoriteStore';
import type { FavoriteItem } from '../api/favorites';

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

function EmptyState({ message, actionLabel, actionHref }: { message: string; actionLabel: string; actionHref: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4">
      <Icon name="star" size={64} className="text-on-surface-variant/20" />
      <p className="text-on-surface-variant text-sm">{message}</p>
      <Link
        to={actionHref}
        className="bg-primary-container text-on-primary px-6 py-2.5 rounded-sm text-sm font-bold uppercase tracking-wider hover:opacity-90 transition-opacity"
      >
        {actionLabel}
      </Link>
    </div>
  );
}

// Batch action toolbar
function BatchToolbar({ selectedCount, onDownload, onRemove, onCancel }: {
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
        <Icon name="download" size={14} />下载 STEP
      </button>
      <button
        onClick={onRemove}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-error bg-error/10 rounded-sm border border-error/20 hover:bg-error/20 transition-colors"
      >
        <Icon name="star_off" size={14} />取消收藏
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

const ModelCard = memo(function ModelCard({ model, selected, onSelect, onRemove, onDownload, showCheckbox }: {
  model: FavoriteModel; selected: boolean; onSelect: (id: string) => void; onRemove: (id: string) => void; onDownload: (id: string) => void; showCheckbox: boolean;
}) {
  return (
    <div className={`bg-surface-container-high rounded-sm group relative transition-all flex flex-col ${selected ? 'ring-2 ring-primary shadow-[0_0_0_1px_var(--color-primary)]' : 'hover:shadow-[0_12px_24px_rgba(0,0,0,0.4)]'}`}>
      <div className="aspect-[4/3] bg-surface-container-lowest w-full relative overflow-hidden flex items-center justify-center">
        <Link to={`/model/${model.id}`} className="absolute inset-0 z-0">
          {model.thumbnailUrl ? (
            <img src={model.thumbnailUrl} alt={model.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Icon name="view_in_ar" size={48} className="text-on-surface-variant/30" />
            </div>
          )}
        </Link>
        {showCheckbox && (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSelect(model.id); }}
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
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(model.id); }}
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
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDownload(model.id); }}
            className="flex-1 bg-primary-container text-on-primary rounded-sm py-1.5 px-3 text-xs font-medium hover:opacity-90 flex items-center justify-center gap-1"
          >
            <Icon name="download" size={14} />
            下载
          </button>
          <Link to={`/model/${model.id}`} className="flex-1 border border-outline-variant/40 text-on-surface-variant hover:text-on-surface rounded-sm py-1.5 px-3 text-xs text-center flex items-center justify-center gap-1">
            <Icon name="visibility" size={14} />
            预览
          </Link>
        </div>
      </div>
    </div>
  );
});

const MobileModelCard = memo(function MobileModelCard({ model, selected, onSelect, onRemove, onDownload, showCheckbox }: {
  model: FavoriteModel; selected: boolean; onSelect: (id: string) => void; onRemove: (id: string) => void; onDownload: (id: string) => void; showCheckbox: boolean;
}) {
  return (
    <div className={`bg-surface-container-high rounded-lg border shadow-sm relative transition-all ${selected ? 'border-primary ring-2 ring-primary/30' : 'border-outline-variant/10'}`}>
      {showCheckbox && (
        <button
          onClick={() => onSelect(model.id)}
          className={`absolute top-2 left-2 z-10 w-6 h-6 rounded-sm border-2 flex items-center justify-center transition-all ${
            selected ? 'bg-primary border-primary' : 'bg-surface/80 border-outline-variant/40'
          }`}
        >
          {selected && <Icon name="check" size={14} className="text-on-primary" />}
        </button>
      )}
      <Link to={`/model/${model.id}`} className="flex items-center">
        <div className="w-20 h-20 bg-surface-container-lowest flex-shrink-0 flex items-center justify-center overflow-hidden rounded-l-lg">
          {model.thumbnailUrl ? (
            <img src={model.thumbnailUrl} alt={model.name} className="w-full h-full object-cover" />
          ) : (
            <Icon name="view_in_ar" size={36} className="text-on-surface-variant/20" />
          )}
        </div>
        <div className="flex-1 min-w-0 p-2.5 flex flex-col gap-1.5">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-bold tracking-widest uppercase text-primary bg-primary/10 px-1.5 py-0.5 rounded-sm">
                {model.format.toUpperCase()}
              </span>
              <span className="text-[11px] text-on-surface-variant">
                {new Date(model.createdAt).toLocaleDateString('zh-CN')}
              </span>
            </div>
            <h3 className="text-sm font-semibold text-on-surface leading-snug line-clamp-2">{model.name}</h3>
          </div>
          <div className="flex items-center gap-2 mt-auto">
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDownload(model.id); }}
              className="flex items-center gap-1 bg-primary-container text-on-primary rounded-sm py-1.5 px-3 text-xs font-medium hover:opacity-90 transition-opacity"
            >
              <Icon name="download" size={13} />
              下载
            </button>
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(model.id); }}
              className="flex items-center gap-1 border border-outline-variant/30 text-on-surface-variant rounded-sm py-1.5 px-3 text-xs hover:text-error hover:border-error/30 transition-colors"
            >
              <Icon name="star_off" size={13} />
              取消收藏
            </button>
          </div>
        </div>
      </Link>
    </div>
  );
});

function DesktopContent() {
  const { data, error, isLoading, mutate } = useSWR<FavoriteItem[]>('/favorites', () =>
    client.get('/favorites').then((r) => r.data?.data || r.data)
  );
  const { toast } = useToast();
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);

  const handleRemove = useCallback(async (modelId: string) => {
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
  }, [mutate, toast]);

  const toggleSelect = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (!data) return;
    setSelected(new Set(mapFavorites(data).map(m => m.id)));
  }, [data]);

  const handleBatchRemove = useCallback(async () => {
    if (selected.size === 0) return;
    try {
      await favoriteApi.batchRemove(Array.from(selected));
      const store = useFavoriteStore.getState();
      const updated = new Set(store.favoriteIds);
      selected.forEach(id => updated.delete(id));
      useFavoriteStore.setState({ favoriteIds: updated });
      setSelected(new Set());
      setSelectMode(false);
      mutate();
      toast(`已取消收藏 ${selected.size} 个模型`, 'success');
    } catch {
      toast('批量取消收藏失败', 'error');
    }
  }, [selected, mutate, toast]);

  const handleBatchDownload = useCallback(async (format: string = "original") => {
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
  }, [selected, toast]);

  const handleSingleDownload = useCallback(async (modelId: string) => {
    const token = getAccessToken();
    try {
      const res = await fetch(`/api/models/${modelId}/download?format=original`, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (!res.ok) {
        toast('下载失败', 'error');
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get("content-disposition");
      const match = cd?.match(/filename"?(.+?)"?$/);
      const filename = match?.[1] || `${modelId}.step`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      toast('下载失败，请检查网络', 'error');
    }
  }, [toast]);

  const models = data ? mapFavorites(data) : [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Icon name="progress_activity" size={32} className="text-on-surface-variant animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <Icon name="error" size={48} className="text-error" />
        <p className="text-on-surface-variant text-sm">加载收藏失败</p>
        <button onClick={() => location.reload()} className="text-primary text-sm hover:underline">重试</button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-end mb-6">
        <div>
          <h2 className="font-headline text-2xl font-bold tracking-tight text-on-surface uppercase">我的收藏</h2>
          <p className="text-sm text-on-surface-variant mt-1">{models.length} 个模型</p>
          {models.length > 1 && (
            <p className="text-xs text-on-surface-variant/60 mt-1">点击「批量操作」可多选后一键下载 STEP 文件</p>
          )}
        </div>
        {models.length > 0 && (
          <div className="flex items-center gap-2">
            {selectMode ? (
              <button onClick={selectAll} className="text-sm text-primary hover:underline">
                {selected.size === models.length ? '取消全选' : '全选'}
              </button>
            ) : null}
            <button
              onClick={() => { setSelectMode(!selectMode); setSelected(new Set()); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-sm border transition-colors ${
                selectMode ? 'text-primary border-primary/30 bg-primary-container/10' : 'text-on-surface-variant border-outline-variant/20 hover:text-on-surface hover:border-outline-variant/40'
              }`}
            >
              <Icon name={selectMode ? "close" : "checklist"} size={16} />
              {selectMode ? '取消选择' : '批量操作'}
            </button>
          </div>
        )}
      </div>

      {/* Batch toolbar */}
      <AnimatePresence>
        {selectMode && selected.size > 0 && !downloading && (
          <div className="mb-4">
            <BatchToolbar
              selectedCount={selected.size}
              onDownload={() => handleBatchDownload("original")}
              onRemove={handleBatchRemove}
              onCancel={() => { setSelectMode(false); setSelected(new Set()); }}
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
          <Link to="/" className="bg-surface-container-lowest border border-outline-variant/20 border-dashed rounded-sm group cursor-pointer hover:border-primary/50 hover:bg-surface-container-low transition-all flex flex-col items-center justify-center min-h-[200px]">
            <div className="w-12 h-12 rounded-sm bg-surface-container-high flex items-center justify-center mb-3 group-hover:text-primary transition-colors text-on-surface-variant">
              <Icon name="search" size={32} />
            </div>
            <span className="font-headline text-sm font-semibold text-on-surface">浏览模型库</span>
            <span className="text-xs text-on-secondary-container mt-1">发现更多模型</span>
          </Link>
        </div>
      )}
    </div>
  );
}

function MobileContent() {
  const { data, error, isLoading, mutate } = useSWR<FavoriteItem[]>('/favorites', () =>
    client.get('/favorites').then((r) => r.data?.data || r.data)
  );
  const { toast } = useToast();
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);

  const handleRemove = useCallback(async (modelId: string) => {
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
  }, [mutate, toast]);

  const toggleSelect = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const models = data ? mapFavorites(data) : [];

  const selectAll = useCallback(() => {
    setSelected(new Set(models.map(m => m.id)));
  }, [models]);

  const handleBatchRemove = useCallback(async () => {
    if (selected.size === 0) return;
    try {
      await favoriteApi.batchRemove(Array.from(selected));
      const store = useFavoriteStore.getState();
      const updated = new Set(store.favoriteIds);
      selected.forEach(id => updated.delete(id));
      useFavoriteStore.setState({ favoriteIds: updated });
      setSelected(new Set());
      setSelectMode(false);
      mutate();
      toast(`已取消收藏 ${selected.size} 个模型`, 'success');
    } catch {
      toast('批量取消收藏失败', 'error');
    }
  }, [selected, mutate, toast]);

  const handleBatchDownload = useCallback(async (format: string = "original") => {
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
  }, [selected, toast]);

  const handleSingleDownload = useCallback(async (modelId: string) => {
    const token = getAccessToken();
    try {
      const res = await fetch(`/api/models/${modelId}/download?format=original`, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (!res.ok) {
        toast('下载失败', 'error');
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get("content-disposition");
      const match = cd?.match(/filename"?(.+?)"?$/);
      const filename = match?.[1] || `${modelId}.step`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      toast('下载失败，请检查网络', 'error');
    }
  }, [toast]);

  return (
    <div className="px-4 py-5 pb-6">
      <div className="mb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-on-surface">我的收藏</h1>
            <p className="text-xs text-on-surface-variant mt-0.5">{models.length} 个模型</p>
          </div>
          {models.length > 0 && (
            <button
              onClick={() => { setSelectMode(!selectMode); setSelected(new Set()); }}
              className={`text-xs px-2.5 py-1 rounded-sm border transition-colors ${
                selectMode ? 'text-primary border-primary/30' : 'text-on-surface-variant border-outline-variant/20'
              }`}
            >
              {selectMode ? '取消' : '批量操作'}
            </button>
          )}
        </div>
      </div>

      {/* Mobile batch toolbar */}
      <AnimatePresence>
        {selectMode && !downloading && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="mb-3 flex items-center gap-2 bg-surface-container-high rounded-lg px-3 py-2.5 border border-outline-variant/10"
          >
            <button onClick={selectAll} className="text-xs text-primary">全选</button>
            <div className="flex-1" />
            <span className="text-xs text-on-surface-variant">{selected.size} 已选</span>
            <button onClick={() => handleBatchDownload("original")} className="text-xs text-on-surface-variant hover:text-on-surface px-2 py-1">
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
        <div className="flex items-center justify-center py-16">
          <Icon name="progress_activity" size={32} className="text-on-surface-variant animate-spin" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 py-16">
          <Icon name="error" size={40} className="text-error" />
          <p className="text-on-surface-variant text-sm">加载失败</p>
        </div>
      ) : models.length === 0 ? (
        <EmptyState message="尚未收藏任何模型" actionLabel="浏览模型库" actionHref="/" />
      ) : (
        <div className="flex flex-col gap-3">
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
    </div>
  );
}

export default function FavoritesPage() {
  useDocumentTitle("我的收藏");
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [navOpen, setNavOpen] = useState(false);

  if (isDesktop) {
    return (
      <div className="flex flex-col h-screen overflow-hidden">
        <TopNav />
        <div className="flex flex-1 overflow-hidden">
          <AppSidebar />
          <main className="flex-1 overflow-y-auto p-8 scrollbar-hidden bg-surface-dim">
            <DesktopContent />
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-dvh bg-surface">
      <TopNav compact onMenuToggle={() => setNavOpen(prev => !prev)} />
      <MobileNavDrawer open={navOpen} onClose={() => setNavOpen(false)} />
      <main className="flex-1 overflow-y-auto scrollbar-hidden bg-surface-dim">
        <MobileContent />
      </main>
      <BottomNav />
    </div>
  );
}
