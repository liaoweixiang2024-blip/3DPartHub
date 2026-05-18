import { Link } from 'react-router-dom';
import { AnnouncementBanner, SkeletonCard, SkeletonListCard } from '../../../../components/home/HomeDesktopShared';
import Icon from '../../../../components/shared/Icon';
import InfiniteLoadTrigger from '../../../../components/shared/InfiniteLoadTrigger';
import { PageTitle } from '../../../../components/shared/PagePrimitives';
import VirtualProductGrid, { useGridColumnCount } from '../../../../components/shared/VirtualProductGrid';
import type { DesktopHomeThemeProps } from '../../types';
import CategorySidebar from '../components/CategorySidebar';

const GRID_CARD_HEIGHT = 260;
const LIST_CARD_HEIGHT = 80;

export default function ClassicHomeDesktop({
  activeCategory,
  breadcrumb,
  categories,
  displayTotalItems,
  expandedCategories,
  hasMore,
  isLoadingMore,
  products,
  renderProductCard,
  scrollContainerRef,
  searchQuery,
  showHomeListSkeleton,
  sortBy,
  totalModelCount,
  viewMode,
  onLoadMore,
  onSelectCategory,
  onSortChange,
  onToggleCategory,
  onViewModeChange,
}: DesktopHomeThemeProps) {
  const gridCols = useGridColumnCount();
  const gridClasses = `home-model-grid grid gap-3 ${
    viewMode === 'grid'
      ? 'home-model-grid-grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'
      : 'home-model-grid-list grid-cols-1 gap-2'
  }`;

  return (
    <div className="home-page-desktop flex flex-1 overflow-hidden" data-home-theme="classic">
      <CategorySidebar
        expandedCategories={expandedCategories}
        activeCategory={activeCategory}
        categories={categories}
        totalCount={totalModelCount}
        onToggle={onToggleCategory}
        onSelect={onSelectCategory}
      />
      <main
        ref={scrollContainerRef}
        className="home-scroll-container home-desktop-content flex-1 overflow-y-auto model-list-scrollbar bg-surface-dim p-6 relative"
      >
        <AnnouncementBanner />
        <div className="home-title-toolbar flex justify-between items-end mb-6 border-b border-surface-container-low pb-3 flex-wrap gap-3">
          <div>
            <div className="home-breadcrumb flex items-center gap-2 text-sm mb-1.5">
              <button
                type="button"
                onClick={() => onSelectCategory('all')}
                className="text-on-surface-variant hover:text-on-surface cursor-pointer transition-colors"
              >
                首页
              </button>
              <Icon name="chevron_right" size={12} className="text-on-surface-variant/40" />
              {breadcrumb.parent && !breadcrumb.child ? (
                <span className="text-primary font-medium">{breadcrumb.label}</span>
              ) : breadcrumb.parent && breadcrumb.child ? (
                <>
                  <span
                    className="text-on-surface-variant hover:text-on-surface cursor-pointer transition-colors"
                    onClick={() => {
                      const parent = categories.find((category) => category.name === breadcrumb.parent);
                      if (parent) onSelectCategory(parent.id);
                    }}
                  >
                    {breadcrumb.parent}
                  </span>
                  <Icon name="chevron_right" size={12} className="text-on-surface-variant/40" />
                  <span className="text-primary font-medium">{breadcrumb.child}</span>
                </>
              ) : (
                <span className="text-primary font-medium">{breadcrumb.label}</span>
              )}
            </div>
            <div className="home-title-mainline flex items-center gap-3">
              <PageTitle>零件模型库</PageTitle>
              <span className="bg-surface-container-high px-2 py-0.5 text-xs text-on-surface-variant rounded-sm border border-outline-variant/20">
                {displayTotalItems} 个模型
              </span>
            </div>
          </div>
          <div className="home-toolbar-actions flex items-center gap-3">
            <div className="relative">
              <select
                value={sortBy}
                onChange={(event) => onSortChange(event.target.value)}
                className="bg-surface-container-lowest text-sm text-on-surface rounded-sm pl-3 pr-8 py-1 border border-outline-variant/30 outline-none appearance-none cursor-pointer"
              >
                <option value="created_at">最新上传</option>
                <option value="name">名称排序</option>
              </select>
              <Icon
                name="expand_more"
                size={12}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none"
              />
            </div>
            <div className="flex rounded-sm border border-outline-variant/30 overflow-hidden">
              <button
                onClick={() => onViewModeChange('grid')}
                aria-label="网格视图"
                title="网格视图"
                className={`px-2.5 py-1.5 transition-colors ${viewMode === 'grid' ? 'bg-surface-container-high text-on-surface' : 'text-on-surface-variant hover:text-on-surface'}`}
              >
                <Icon name="grid_view" size={18} />
              </button>
              <button
                onClick={() => onViewModeChange('list')}
                aria-label="列表视图"
                title="列表视图"
                className={`px-2.5 py-1.5 transition-colors ${viewMode === 'list' ? 'bg-surface-container-high text-on-surface' : 'text-on-surface-variant hover:text-on-surface'}`}
              >
                <Icon name="view_list" size={18} />
              </button>
            </div>
          </div>
        </div>

        {showHomeListSkeleton ? (
          <div
            className={`home-model-grid grid gap-3 ${
              viewMode === 'grid'
                ? 'home-model-grid-grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'
                : 'home-model-grid-list grid-cols-1 gap-2'
            }`}
          >
            {Array.from({ length: viewMode === 'grid' ? 12 : 8 }).map((_, index) =>
              viewMode === 'grid' ? <SkeletonCard key={index} /> : <SkeletonListCard key={index} />,
            )}
          </div>
        ) : (
          <>
            <VirtualProductGrid
              products={products}
              columns={viewMode === 'grid' ? gridCols : 1}
              rowHeight={viewMode === 'grid' ? GRID_CARD_HEIGHT : LIST_CARD_HEIGHT}
              gap={viewMode === 'grid' ? 12 : 8}
              renderCard={renderProductCard}
              scrollRef={scrollContainerRef}
              gridClassName={gridClasses}
            />

            {products.length === 0 && !showHomeListSkeleton && (
              <div className="home-model-empty-state flex flex-col items-center justify-center gap-4 py-20">
                <Icon name="search_off" size={48} className="text-on-surface-variant/30" />
                <div className="text-center">
                  <p className="text-on-surface-variant">没有找到匹配的模型</p>
                  {searchQuery.trim() && (
                    <p className="mt-1 text-xs text-on-surface-variant/60">可以提交需求，请管理员补充或完善模型库。</p>
                  )}
                </div>
                {searchQuery.trim() && (
                  <Link
                    to="/support"
                    state={{
                      source: 'model_search',
                      searchQuery: searchQuery.trim(),
                      classification: 'novel',
                      description: `模型库未搜索到：${searchQuery.trim()}\n请协助补充或完善该模型。`,
                    }}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary-container px-4 py-2 text-sm font-bold text-on-primary transition-opacity hover:opacity-90"
                  >
                    <Icon name="assignment_add" size={16} />
                    申请完善模型
                  </Link>
                )}
              </div>
            )}

            <InfiniteLoadTrigger
              hasMore={hasMore}
              isLoading={isLoadingMore}
              onLoadMore={onLoadMore}
              buttonless
              idleLabel={null}
            />
          </>
        )}
      </main>
    </div>
  );
}
