import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AnnouncementBanner, SkeletonCard, SkeletonListCard } from '../../../../components/home/HomeDesktopShared';
import Icon from '../../../../components/shared/Icon';
import InfiniteLoadTrigger from '../../../../components/shared/InfiniteLoadTrigger';
import { PageTitle } from '../../../../components/shared/PagePrimitives';
import Pagination from '../../../../components/shared/Pagination';
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
  homePageSizeOptions,
  isLoadingMore,
  listLoadingMode,
  page,
  pageSize,
  products,
  renderProductCard,
  scrollContainerRef,
  searchQuery,
  showHomeListSkeleton,
  sortBy,
  totalItems,
  totalModelCount,
  totalPages,
  viewMode,
  onLoadMore,
  onPageChange,
  onPageSizeChange,
  onSelectCategory,
  onSortChange,
  onToggleCategory,
  onViewModeChange,
}: DesktopHomeThemeProps) {
  const { t } = useTranslation();
  const gridCols = useGridColumnCount();
  const isEmpty = products.length === 0 && !showHomeListSkeleton;
  const gridClasses = `home-model-grid grid gap-3 ${
    viewMode === 'grid'
      ? 'home-model-grid-grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'
      : 'home-model-grid-list grid-cols-1 gap-2'
  }`;

  return (
    <div className="home-page-desktop flex flex-1 overflow-hidden bg-surface-dim" data-home-theme="classic">
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
        className={`home-scroll-container home-desktop-content relative flex-1 overflow-y-auto bg-surface-dim p-6 model-list-scrollbar ${isEmpty ? 'home-desktop-content-empty flex flex-col' : ''}`}
      >
        <AnnouncementBanner />
        <div className="home-title-toolbar mb-6 flex shrink-0 flex-wrap items-end justify-between gap-3 border-b border-surface-container-low pb-3">
          <div>
            <div className="home-breadcrumb flex items-center gap-2 text-sm mb-1.5">
              <button
                type="button"
                onClick={() => onSelectCategory('all')}
                className="text-on-surface-variant hover:text-on-surface cursor-pointer transition-colors"
              >
                {t('home.home')}
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
              <PageTitle>{t('home.modelLibrary')}</PageTitle>
              <span className="bg-surface-container-high px-2 py-0.5 text-xs text-on-surface-variant rounded-sm border border-outline-variant/20">
                {t('home.modelCount', { count: displayTotalItems })}
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
                <option value="created_at">{t('home.sortLatest')}</option>
                <option value="name">{t('home.sortName')}</option>
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
                aria-label={t('home.gridView')}
                title={t('home.gridView')}
                className={`px-2.5 py-1.5 transition-colors ${viewMode === 'grid' ? 'bg-surface-container-high text-on-surface' : 'text-on-surface-variant hover:text-on-surface'}`}
              >
                <Icon name="grid_view" size={18} />
              </button>
              <button
                onClick={() => onViewModeChange('list')}
                aria-label={t('home.listView')}
                title={t('home.listView')}
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

            {isEmpty && (
              <div className="home-model-empty-state home-model-empty-state-classic flex flex-1 flex-col items-center justify-center gap-4 py-12">
                <Icon name="search_off" size={48} className="text-on-surface-variant/30" />
                <div className="text-center">
                  <p className="text-on-surface-variant">{t('home.emptyTitle')}</p>
                  {searchQuery.trim() && (
                    <p className="mt-1 text-xs text-on-surface-variant/60">{t('home.emptyDescription')}</p>
                  )}
                </div>
                {searchQuery.trim() && (
                  <Link
                    to="/support"
                    state={{
                      source: 'model_search',
                      searchQuery: searchQuery.trim(),
                      sourceUrl: `/?q=${encodeURIComponent(searchQuery.trim())}`,
                      classification: 'novel',
                      description: t('home.requestDescription', { query: searchQuery.trim() }),
                    }}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary-container px-4 py-2 text-sm font-bold text-on-primary transition-opacity hover:opacity-90"
                  >
                    <Icon name="assignment_add" size={16} />
                    {t('home.requestModel')}
                  </Link>
                )}
              </div>
            )}

            {products.length > 0 && listLoadingMode === 'pagination' ? (
              <Pagination
                page={page}
                totalPages={totalPages}
                totalItems={totalItems}
                pageSize={pageSize}
                pageSizeOptions={homePageSizeOptions}
                onPageChange={onPageChange}
                onPageSizeChange={onPageSizeChange}
              />
            ) : products.length > 0 ? (
              <InfiniteLoadTrigger
                hasMore={hasMore}
                isLoading={isLoadingMore}
                onLoadMore={onLoadMore}
                buttonless
                idleLabel={null}
              />
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
