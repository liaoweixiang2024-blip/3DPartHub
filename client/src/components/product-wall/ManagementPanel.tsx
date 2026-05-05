import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProductWallItem, ProductWallCategory, ProductWallKind, ProductWallStatus } from '../../api/productWall';
import { useImeSafeSearchInput } from '../../hooks/useImeSafeSearchInput';
import Icon from '../shared/Icon';

type ReviewFilter = 'all' | 'approved' | 'pending' | 'rejected';
type ManagementKindFilter = '全部' | ProductWallKind;

interface ManagementPanelProps {
  items: ProductWallItem[];
  categories: ProductWallCategory[];
  reviewFilter: ReviewFilter;
  setReviewFilter: (v: ReviewFilter) => void;
  managementKindFilter: ManagementKindFilter;
  setManagementKindFilter: (v: ManagementKindFilter) => void;
  managementQuery: string;
  setManagementQuery: (v: string) => void;
  managementRenderCount: number;
  setManagementRenderCount: (v: number | ((prev: number) => number)) => void;
  canManageItem: (item: ProductWallItem) => boolean;
  close: () => void;
  onReview: (id: string, input: { status: 'approved' | 'rejected'; rejectReason?: string }) => void;
  onUpdateItem: (id: string) => void;
  onDeleteItem: (id: string) => void;
  onSaveCategory: (name: string) => void;
  onRenameCategory: (id: string, name: string) => void;
  onDeleteCategory: (id: string) => void;
  editingItem: ProductWallItem | null;
  setEditingItem: (item: ProductWallItem | null) => void;
  editForm: { title: string; description?: string; kind: ProductWallKind; tags: string };
  setEditForm: (form: { title: string; description?: string; kind: ProductWallKind; tags: string }) => void;
  saveEdit: () => void;
  resolvedFilters: string[];
}

function StatusBadge({ status }: { status: ProductWallStatus }) {
  const config: Record<string, { label: string; className: string }> = {
    approved: { label: '已通过', className: 'bg-green-100 text-green-700' },
    pending: { label: '待审核', className: 'bg-yellow-100 text-yellow-700' },
    rejected: { label: '已拒绝', className: 'bg-red-100 text-red-700' },
  };
  const { label, className } = config[status] || { label: status, className: 'bg-gray-100 text-gray-700' };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}

function normalizeProductWallImageUrl(src?: string) {
  if (!src) return '';
  if (/^(https?:|data:|blob:)/i.test(src)) return src;
  return src.startsWith('/') ? src : `/${src}`;
}

const REVIEW_FILTERS: { key: ReviewFilter; label: string }[] = [
  { key: 'approved', label: '已通过' },
  { key: 'pending', label: '待审核' },
  { key: 'rejected', label: '已拒绝' },
  { key: 'all', label: '全部' },
];

export default memo(function ProductWallManagementPanel({
  items,
  categories,
  reviewFilter,
  setReviewFilter,
  managementKindFilter,
  setManagementKindFilter,
  managementQuery,
  setManagementQuery,
  managementRenderCount,
  setManagementRenderCount,
  canManageItem,
  close,
  onReview,
  onUpdateItem,
  onDeleteItem,
  onSaveCategory,
  onRenameCategory,
  onDeleteCategory,
  editingItem,
  setEditingItem,
  editForm,
  setEditForm,
  saveEdit,
  resolvedFilters,
}: ManagementPanelProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef<HTMLButtonElement | null>(null);
  const {
    draftValue: managementQueryInputValue,
    inputProps: managementQueryInputProps,
    setValue: setManagementQueryInternal,
  } = useImeSafeSearchInput({
    initialValue: managementQuery,
    onCommit: setManagementQuery,
  });
  const [localRenderCount, setLocalRenderCount] = useState(managementRenderCount);
  const renderedItems = useMemo(() => items.slice(0, localRenderCount), [items, localRenderCount]);
  const hasMore = localRenderCount < items.length;
  const loadMoreItems = useCallback(() => {
    setLocalRenderCount((count) => Math.min(count + 24, items.length));
  }, [items.length]);
  const handleListScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el || !hasMore) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 420) loadMoreItems();
  }, [hasMore, loadMoreItems]);

  useEffect(() => {
    setLocalRenderCount(Math.min(24, Math.max(items.length, 24)));
    scrollerRef.current?.scrollTo({ top: 0 });
  }, [reviewFilter, managementKindFilter, managementQuery, items.length]);

  useEffect(() => {
    setManagementRenderCount(localRenderCount);
  }, [localRenderCount, setManagementRenderCount]);

  useEffect(() => {
    if (!hasMore) return;
    const target = loadMoreRef.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        loadMoreItems();
      },
      { root: scrollerRef.current, rootMargin: '360px 0px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, loadMoreItems]);

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/35 px-3 py-4 backdrop-blur-sm md:px-6 md:py-8"
      onClick={close}
    >
      <section
        className="flex h-[92dvh] w-full max-w-7xl flex-col overflow-hidden rounded-lg border border-outline-variant/16 bg-surface shadow-[0_28px_100px_rgba(0,0,0,0.28)]"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="border-b border-outline-variant/14 px-4 py-4 md:px-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-on-surface">图片管理</h2>
            <button
              type="button"
              onClick={close}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high"
            >
              <Icon name="close" size={18} />
            </button>
          </div>
        </header>

        <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
          {/* Sidebar: categories */}
          <div className="hidden w-56 shrink-0 flex-col border-r border-outline-variant/12 md:flex">
            <div className="border-b border-outline-variant/12 px-3 py-3">
              <button
                type="button"
                onClick={() => {
                  const name = prompt('新分类名称');
                  if (name?.trim()) onSaveCategory(name.trim());
                }}
                className="flex h-8 w-full items-center justify-center gap-1 rounded-md border border-dashed border-outline-variant/28 text-xs font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high"
              >
                <Icon name="add" size={14} />
                添加分类
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-2">
              {/* All items */}
              <button
                type="button"
                onClick={() => setManagementKindFilter('全部')}
                className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  managementKindFilter === '全部' ? 'bg-primary-container/8' : 'hover:bg-surface-container-high'
                }`}
              >
                <Icon
                  name="apps"
                  size={16}
                  className={managementKindFilter === '全部' ? 'text-primary-container' : 'text-on-surface-variant'}
                />
                <span
                  className={managementKindFilter === '全部' ? 'font-medium text-primary-container' : 'text-on-surface'}
                >
                  全部
                </span>
                {managementKindFilter === '全部' && (
                  <span className="ml-auto text-xs text-on-surface-variant">{items.length}</span>
                )}
              </button>
              {categories.map((category) => {
                const activeCategory = managementKindFilter === category.name;
                return (
                  <div key={category.id} className="group relative flex items-center">
                    <button
                      type="button"
                      onClick={() => setManagementKindFilter(category.name)}
                      className={`flex flex-1 items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                        activeCategory ? 'bg-primary-container/8' : 'hover:bg-surface-container-high'
                      }`}
                    >
                      <Icon
                        name="folder"
                        size={16}
                        className={activeCategory ? 'text-primary-container' : 'text-on-surface-variant'}
                      />
                      <span
                        className={`truncate ${activeCategory ? 'font-medium text-primary-container' : 'text-on-surface'}`}
                      >
                        {category.name}
                      </span>
                    </button>
                    <div className="absolute right-1 hidden group-hover:flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          const name = prompt('重命名分类', category.name);
                          if (name?.trim() && name.trim() !== category.name) onRenameCategory(category.id, name.trim());
                        }}
                        className="h-6 w-6 rounded text-on-surface-variant/55 hover:bg-surface-container-high hover:text-on-surface"
                      >
                        <Icon name="edit" size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(`确定删除分类「${category.name}」？`)) onDeleteCategory(category.id);
                        }}
                        className="h-6 w-6 rounded text-on-surface-variant/55 hover:bg-red-50 hover:text-red-500"
                      >
                        <Icon name="close" size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Main content */}
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-2 border-b border-outline-variant/12 px-4 py-3">
              <div className="flex rounded-md border border-outline-variant/18 overflow-hidden">
                {REVIEW_FILTERS.map((item) => {
                  const activeReview = item.key === reviewFilter;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setReviewFilter(item.key)}
                      className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                        activeReview
                          ? 'bg-primary-container/12 text-primary-container'
                          : 'text-on-surface-variant hover:bg-surface-container-high'
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
              {/* Mobile category filter */}
              <select
                value={managementKindFilter}
                onChange={(e) => setManagementKindFilter(e.target.value as ManagementKindFilter)}
                className="rounded-md border border-outline-variant/18 bg-surface px-2 py-1.5 text-xs text-on-surface md:hidden"
              >
                <option value="全部">全部分类</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
              <div className="relative flex-1 min-w-[140px] max-w-xs">
                <Icon
                  name="search"
                  size={14}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant/50"
                />
                <input
                  type="text"
                  placeholder="搜索标题、分类..."
                  {...managementQueryInputProps}
                  className="w-full rounded-md border border-outline-variant/18 bg-surface py-1.5 pl-8 pr-3 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-1 focus:ring-primary-container/35"
                />
              </div>
              {managementQueryInputValue && (
                <button
                  type="button"
                  onClick={() => setManagementQueryInternal('')}
                  className="text-xs text-primary-container hover:underline"
                >
                  清空搜索
                </button>
              )}
            </div>

            {/* Image grid */}
            <div ref={scrollerRef} onScroll={handleListScroll} className="flex-1 overflow-y-auto px-4 py-3">
              {items.length > 0 ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                  {renderedItems.map((item) => {
                    const imageSrc = normalizeProductWallImageUrl(item.previewImage || item.image);
                    const fallbackSrc = normalizeProductWallImageUrl(item.image);
                    return (
                      <div
                        key={item.id}
                        className="product-wall-management-card group relative overflow-hidden rounded-lg border border-outline-variant/12 bg-surface-container-low/50"
                      >
                        <div className="aspect-square overflow-hidden">
                          <img
                            src={imageSrc}
                            alt={item.title}
                            className="h-full w-full object-cover transition-transform group-hover:scale-105"
                            loading="eager"
                            decoding="async"
                            onError={(event) => {
                              const img = event.currentTarget;
                              if (!fallbackSrc || img.dataset.fallback === '1' || img.src.endsWith(fallbackSrc)) return;
                              img.dataset.fallback = '1';
                              img.src = fallbackSrc;
                            }}
                          />
                        </div>
                        <div className="p-2">
                          <p className="truncate text-xs font-medium text-on-surface">{item.title}</p>
                          <p className="mt-0.5 truncate text-[10px] text-on-surface-variant">
                            {item.description || item.kind}
                          </p>
                          <div className="mt-1 flex items-center justify-between">
                            <StatusBadge status={item.status} />
                            {canManageItem(item) && (
                              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                {item.status === 'pending' && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => onReview(item.id, { status: 'approved' })}
                                      className="h-5 w-5 rounded text-green-600 hover:bg-green-50"
                                    >
                                      <Icon name="check" size={12} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const reason = prompt('拒绝原因');
                                        if (reason) onReview(item.id, { status: 'rejected', rejectReason: reason });
                                      }}
                                      className="h-5 w-5 rounded text-red-500 hover:bg-red-50"
                                      title="拒绝"
                                    >
                                      <Icon name="close" size={12} />
                                    </button>
                                  </>
                                )}
                                <button
                                  type="button"
                                  onClick={() => onUpdateItem(item.id)}
                                  className="h-5 w-5 rounded text-on-surface-variant hover:bg-surface-container-high"
                                  title="编辑"
                                >
                                  <Icon name="edit" size={12} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onDeleteItem(item.id)}
                                  className="h-5 w-5 rounded text-red-500 hover:bg-red-50"
                                  title="删除"
                                >
                                  <Icon name="delete" size={12} />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex h-full min-h-[280px] flex-col items-center justify-center text-center text-on-surface-variant">
                  <Icon name="image" size={36} className="mb-3 opacity-45" />
                  <p className="text-sm font-medium">暂无匹配图片</p>
                  <p className="mt-1 text-xs">可以切换审核状态或清空搜索条件。</p>
                </div>
              )}
              {hasMore && (
                <button
                  type="button"
                  ref={loadMoreRef}
                  onClick={loadMoreItems}
                  className="flex h-12 w-full items-center justify-center text-xs text-on-surface-variant transition-colors hover:text-primary-container"
                >
                  继续下拉加载更多
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Edit modal */}
        {editingItem && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center bg-black/20"
            onClick={() => setEditingItem(null)}
          >
            <div
              className="w-full max-w-md rounded-lg border border-outline-variant/16 bg-surface p-4 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-sm font-semibold text-on-surface">编辑图片</h3>
              <div className="mt-3 space-y-3">
                <div>
                  <label className="text-xs text-on-surface-variant">标题</label>
                  <input
                    type="text"
                    value={editForm.title}
                    onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                    className="mt-1 w-full rounded-md border border-outline-variant/18 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary-container/35"
                  />
                </div>
                <div>
                  <label className="text-xs text-on-surface-variant">描述</label>
                  <textarea
                    value={editForm.description || ''}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    rows={3}
                    className="mt-1 w-full resize-none rounded-md border border-outline-variant/18 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary-container/35"
                  />
                </div>
                <div>
                  <label className="text-xs text-on-surface-variant">分类</label>
                  <select
                    value={editForm.kind}
                    onChange={(e) => setEditForm({ ...editForm, kind: e.target.value as ProductWallKind })}
                    className="mt-1 w-full rounded-md border border-outline-variant/18 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary-container/35"
                  >
                    {resolvedFilters.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-on-surface-variant">标签（逗号分隔）</label>
                  <input
                    type="text"
                    value={editForm.tags}
                    onChange={(e) => setEditForm({ ...editForm, tags: e.target.value })}
                    className="mt-1 w-full rounded-md border border-outline-variant/18 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary-container/35"
                  />
                </div>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="rounded-md px-3 py-1.5 text-sm text-on-surface-variant hover:bg-surface-container-high"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={saveEdit}
                  className="rounded-md bg-primary-container px-3 py-1.5 text-sm font-medium text-on-primary-container hover:bg-primary-container/90"
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
});
