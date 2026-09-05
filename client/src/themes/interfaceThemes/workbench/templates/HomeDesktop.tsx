import { Fragment, useEffect, useRef, useState, type ChangeEvent, type CompositionEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AnnouncementBanner, SkeletonCard, SkeletonListCard } from '../../../../components/home/HomeDesktopShared';
import type { Category } from '../../../../components/home/homeTypes';
import Icon from '../../../../components/shared/Icon';
import InfiniteLoadTrigger from '../../../../components/shared/InfiniteLoadTrigger';
import { PageTitle } from '../../../../components/shared/PagePrimitives';
import Pagination from '../../../../components/shared/Pagination';
import SearchField from '../../../../components/shared/SearchField';
import VirtualProductGrid, { useGridColumnCount } from '../../../../components/shared/VirtualProductGrid';
import type { DesktopHomeThemeProps } from '../../types';

const GRID_CARD_HEIGHT = 260;
const LIST_CARD_HEIGHT = 80;

const WORKBENCH_TITLE_SEARCH_DEBOUNCE_MS = 280;

const WORKBENCH_SORT_OPTIONS = [
  { value: 'created_at', labelKey: 'home.sortLatest' },
  { value: 'name', labelKey: 'home.sortName' },
] as const;

function clampTitleSearchInput(value: string, maxLength: number) {
  return Array.from(value).slice(0, maxLength).join('');
}

function WorkbenchCategorySidebar({
  activeCategory,
  categories: categoriesData,
  totalCount,
  categoryNavEnabled,
  onSelect,
}: {
  activeCategory: string;
  categories: Category[];
  totalCount: number;
  /** 系统选型导航入口显隐（标题旁图标，跟功能开关走） */
  categoryNavEnabled: boolean;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(null);
  const allCount = totalCount || categoriesData.reduce((sum, category) => sum + category.count, 0);
  const categorySummary = t('home.categorySummary', { categories: categoriesData.length, count: allCount });

  useEffect(() => {
    if (activeCategory === 'all') {
      setExpandedCategoryId(null);
      return;
    }

    const parentWithActiveChild = categoriesData.find((category) =>
      category.children?.some((child) => child.id === activeCategory),
    );
    if (parentWithActiveChild) {
      setExpandedCategoryId(parentWithActiveChild.id);
    }
  }, [activeCategory, categoriesData]);

  return (
    <aside className="home-workbench-category-sidebar" aria-label={t('home.categoryFilter')}>
      <div className="home-workbench-category-sidebar-header">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="home-workbench-category-title">{t('home.categoryFilter')}</span>
          {/* 系统选型导航入口：分类筛选标题旁，跟功能开关走 */}
          {categoryNavEnabled ? (
            <Link
              to="/category-nav"
              aria-label={t('nav.categoryNav')}
              title={t('nav.categoryNav')}
              className="home-workbench-category-nav-entry"
            >
              <Icon name="account_tree" size={14} />
            </Link>
          ) : null}
        </div>
        <span className="home-workbench-category-current">{categorySummary}</span>
      </div>
      <div className="home-workbench-sidebar-list scrollbar-hidden">
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setExpandedCategoryId(null);
            onSelect('all');
          }}
          className={`home-workbench-sidebar-item ${
            activeCategory === 'all' ? 'home-workbench-sidebar-item-active' : ''
          }`}
        >
          <Icon name="category_all" size={16} />
          <span>{t('home.allModels')}</span>
          <span className="home-workbench-filter-count">{allCount}</span>
        </button>
        {categoriesData.map((category) => {
          const active =
            activeCategory === category.id ||
            (category.children?.some((child) => child.id === activeCategory) ?? false);
          const hasChildren = (category.children?.length ?? 0) > 0;
          const expanded = expandedCategoryId === category.id;
          const visibleChildren = expanded ? category.children || [] : [];
          return (
            <Fragment key={category.id}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                aria-expanded={hasChildren ? expanded : undefined}
                onClick={() => {
                  setExpandedCategoryId((current) => (hasChildren && current !== category.id ? category.id : null));
                  onSelect(category.id);
                }}
                className={`home-workbench-sidebar-item ${active ? 'home-workbench-sidebar-item-active' : ''}`}
              >
                <Icon name={category.icon} size={16} />
                <span>{category.name}</span>
                <span className="home-workbench-filter-count">{category.count}</span>
              </button>
              {visibleChildren.length > 0 && (
                <div className="home-workbench-sidebar-children">
                  {visibleChildren.map((child) => (
                    <button
                      key={child.id}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setExpandedCategoryId(category.id);
                        onSelect(child.id);
                      }}
                      className={`home-workbench-sidebar-child ${
                        activeCategory === child.id ? 'home-workbench-sidebar-child-active' : ''
                      }`}
                    >
                      {child.name}
                      <span>{child.count}</span>
                    </button>
                  ))}
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
    </aside>
  );
}

function WorkbenchSortControl({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedOption = WORKBENCH_SORT_OPTIONS.find((option) => option.value === value) || WORKBENCH_SORT_OPTIONS[0];

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="home-sort-control relative">
      <button
        type="button"
        className="home-sort-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="filter_list" size={14} className="home-sort-icon" />
        <span>{t(selectedOption.labelKey)}</span>
        <Icon name="expand_more" size={12} className="home-sort-chevron" />
      </button>
      {open && (
        <div className="home-sort-menu" role="listbox" aria-label={t('home.sortLabel')}>
          {WORKBENCH_SORT_OPTIONS.map((option) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                className={`home-sort-option ${selected ? 'home-sort-option-active' : ''}`}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <span>{t(option.labelKey)}</span>
                {selected && <Icon name="check" size={14} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function WorkbenchTitleSearch({
  query,
  maxLength,
  normalizeQuery,
  onSearch,
}: {
  query: string;
  maxLength: number;
  normalizeQuery: (query: string) => string;
  onSearch: (query: string) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(query);
  const debounceRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const composingRef = useRef(false);
  const lastSearchRef = useRef(normalizeQuery(query));

  useEffect(() => {
    setDraft(query);
    lastSearchRef.current = normalizeQuery(query);
  }, [normalizeQuery, query]);

  useEffect(
    () => () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    },
    [],
  );

  const clearSearchDebounce = () => {
    if (!debounceRef.current) return;
    window.clearTimeout(debounceRef.current);
    debounceRef.current = null;
  };

  const runSearch = (value: string) => {
    const normalized = normalizeQuery(value);
    if (normalized === lastSearchRef.current) return;
    lastSearchRef.current = normalized;
    onSearch(normalized);
  };

  const scheduleSearch = (value: string) => {
    clearSearchDebounce();
    const nextValue = clampTitleSearchInput(value, maxLength);
    if (!nextValue.trim()) {
      runSearch('');
      return;
    }
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      runSearch(nextValue);
    }, WORKBENCH_TITLE_SEARCH_DEBOUNCE_MS);
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = clampTitleSearchInput(event.currentTarget.value, maxLength);
    setDraft(nextValue);
    if (composingRef.current) {
      clearSearchDebounce();
      return;
    }
    scheduleSearch(nextValue);
  };

  const handleCompositionStart = () => {
    composingRef.current = true;
    clearSearchDebounce();
  };

  const handleCompositionUpdate = (event: CompositionEvent<HTMLInputElement>) => {
    setDraft(clampTitleSearchInput(event.currentTarget.value, maxLength));
    clearSearchDebounce();
  };

  const handleCompositionEnd = (event: CompositionEvent<HTMLInputElement>) => {
    composingRef.current = false;
    const nextValue = clampTitleSearchInput(event.currentTarget.value, maxLength);
    setDraft(nextValue);
    scheduleSearch(nextValue);
  };

  return (
    <SearchField
      inputProps={{
        'aria-label': t('home.modelSearch'),
        value: draft,
        onChange: handleChange,
        onCompositionStart: handleCompositionStart,
        onCompositionUpdate: handleCompositionUpdate,
        onCompositionEnd: handleCompositionEnd,
        maxLength,
        enterKeyHint: 'done',
        autoComplete: 'off',
        spellCheck: false,
      }}
      value={draft}
      onClear={() => {
        setDraft('');
        clearSearchDebounce();
        runSearch('');
      }}
      placeholder={t('home.searchPlaceholder')}
      className="home-workbench-title-search"
    />
  );
}

function WorkbenchHomeFooter({
  contactAddress,
  contactEmail,
  contactPhone,
  footerCopyright,
  footerLinks,
  icpNumber = '',
  policeNumber = '',
  policeUrl = '',
}: {
  contactAddress: string;
  contactEmail: string;
  contactPhone: string;
  footerCopyright: string;
  footerLinks: { label: string; url: string }[];
  icpNumber?: string;
  policeNumber?: string;
  policeUrl?: string;
}) {
  const { t } = useTranslation();
  const hasFiling = Boolean(icpNumber || policeNumber);
  return (
    <footer className="home-workbench-footer">
      <div className="flex min-w-0 flex-col gap-2">
        <p className="text-[11px] text-on-surface-variant/45">{footerCopyright}</p>
        {hasFiling && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-on-surface-variant/40">
            {icpNumber && (
              <a
                href="https://beian.miit.gov.cn/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline-offset-4 transition-colors hover:text-primary hover:underline"
              >
                {icpNumber}
              </a>
            )}
            {policeNumber &&
              (policeUrl ? (
                <a
                  href={policeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline-offset-4 transition-colors hover:text-primary hover:underline"
                >
                  {policeNumber}
                </a>
              ) : (
                <span>{policeNumber}</span>
              ))}
          </div>
        )}
        {contactAddress && (
          <span className="inline-flex items-center gap-1 text-[11px] text-on-surface-variant/40">
            <Icon name="domain" size={12} />
            {contactAddress}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-start gap-x-4 gap-y-1 md:justify-end">
        {contactEmail && (
          <a
            href={`mailto:${contactEmail}`}
            className="inline-flex items-center gap-1.5 text-[11px] text-on-surface-variant/50 transition-colors hover:text-primary"
          >
            <Icon name="mail" size={13} />
            <span>{contactEmail}</span>
          </a>
        )}
        {contactPhone && (
          <a
            href={`tel:${contactPhone}`}
            className="inline-flex items-center gap-1.5 text-[11px] text-on-surface-variant/50 transition-colors hover:text-primary"
          >
            <Icon name="phone" size={13} />
            <span>{contactPhone}</span>
          </a>
        )}
        {footerLinks.length > 0 && (
          <nav aria-label={t('home.footerLinks')} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-[10px] font-medium text-on-surface-variant/35">{t('home.footerLinks')}</span>
            {footerLinks.map((link, index) => (
              <a
                key={`${link.label}-${index}`}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] leading-5 text-on-surface-variant/50 underline-offset-4 transition-colors hover:text-primary hover:underline"
              >
                {link.label}
              </a>
            ))}
          </nav>
        )}
      </div>
    </footer>
  );
}

export default function WorkbenchHomeDesktop({
  activeCategory,
  categories,
  contactAddress,
  contactEmail,
  contactPhone,
  displayTotalItems,
  footerCopyright,
  footerLinks,
  footerIcpNumber,
  footerPoliceNumber,
  footerPoliceUrl,
  hasMore,
  homePageSizeOptions,
  homeSearchMaxLength,
  isLoadingMore,
  listLoadingMode,
  normalizeSearchQuery,
  page,
  pageSize,
  products,
  renderProductCard,
  resultsAnchorRef,
  scrollContainerRef,
  searchQuery,
  showHomeListSkeleton,
  sortBy,
  supportEnabled,
  categoryNavEnabled,
  totalItems,
  totalModelCount,
  totalPages,
  viewMode,
  onHeroSearch,
  onLoadMore,
  onPageChange,
  onPageSizeChange,
  onSelectCategory,
  onSortChange,
  onViewModeChange,
}: DesktopHomeThemeProps) {
  const { t } = useTranslation();
  const gridCols = useGridColumnCount();

  return (
    <div className="home-page-desktop flex flex-1 overflow-hidden" data-home-theme="workbench">
      <main
        ref={scrollContainerRef}
        className="home-scroll-container home-desktop-content model-list-scrollbar flex-1 bg-surface p-6 relative"
      >
        <AnnouncementBanner />

        <div className="home-workbench-layout">
          <WorkbenchCategorySidebar
            activeCategory={activeCategory}
            categories={categories}
            totalCount={totalModelCount}
            categoryNavEnabled={categoryNavEnabled}
            onSelect={onSelectCategory}
          />

          <section className="home-workbench-results-panel" aria-label={t('home.modelList')}>
            <div ref={resultsAnchorRef} className="home-workbench-results-anchor" />
            <div className="home-title-toolbar flex flex-col gap-2.5 mb-6 border-b border-surface-container-low pb-3">
              <div>
                <div className="home-title-mainbar flex items-center gap-3">
                  <div className="home-title-mainline flex items-center gap-3">
                    <PageTitle className="home-title-heading">{t('home.modelLibrary')}</PageTitle>
                    <span className="home-title-count-badge rounded-sm border border-outline-variant/20 bg-surface-container-high px-2 py-0.5 text-xs text-on-surface-variant">
                      {t('home.modelCount', { count: displayTotalItems })}
                    </span>
                  </div>
                  <div className="home-title-controls">
                    <div className="home-title-search-wrap">
                      <WorkbenchTitleSearch
                        query={searchQuery}
                        maxLength={homeSearchMaxLength}
                        normalizeQuery={normalizeSearchQuery}
                        onSearch={onHeroSearch}
                      />
                    </div>
                    <div className="home-toolbar-actions ml-auto flex items-center gap-3">
                      <WorkbenchSortControl value={sortBy} onChange={onSortChange} />
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
              <div className="home-workbench-list-body">
                <VirtualProductGrid
                  products={products}
                  columns={viewMode === 'grid' ? gridCols : 1}
                  rowHeight={viewMode === 'grid' ? GRID_CARD_HEIGHT : LIST_CARD_HEIGHT}
                  gap={viewMode === 'grid' ? 12 : 8}
                  renderCard={renderProductCard}
                  scrollRef={scrollContainerRef}
                  gridClassName={`home-model-grid grid gap-3 ${
                    viewMode === 'grid'
                      ? 'home-model-grid-grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'
                      : 'home-model-grid-list grid-cols-1 gap-2'
                  }`}
                />

                {products.length === 0 && !showHomeListSkeleton && (
                  <div className="home-model-empty-state flex flex-col items-center justify-center gap-4 py-20">
                    <Icon name="search_off" size={48} className="text-on-surface-variant/30" />
                    <div className="text-center">
                      <p className="text-on-surface-variant">{t('home.emptyTitle')}</p>
                      {searchQuery.trim() && (
                        <p className="mt-1 text-xs text-on-surface-variant/60">{t('home.emptyDescription')}</p>
                      )}
                    </div>
                    {searchQuery.trim() && supportEnabled && (
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

                {products.length > 0 ? <div className="home-workbench-list-spacer" aria-hidden="true" /> : null}
                {listLoadingMode === 'pagination' ? (
                  <Pagination
                    page={page}
                    totalPages={totalPages}
                    totalItems={totalItems}
                    pageSize={pageSize}
                    pageSizeOptions={homePageSizeOptions}
                    onPageChange={onPageChange}
                    onPageSizeChange={onPageSizeChange}
                    className="home-workbench-pagination"
                  />
                ) : (
                  <InfiniteLoadTrigger
                    hasMore={hasMore}
                    isLoading={isLoadingMore}
                    onLoadMore={onLoadMore}
                    buttonless
                    idleLabel={null}
                  />
                )}
                <WorkbenchHomeFooter
                  contactAddress={contactAddress}
                  contactEmail={contactEmail}
                  contactPhone={contactPhone}
                  footerCopyright={footerCopyright}
                  footerLinks={footerLinks}
                  icpNumber={footerIcpNumber}
                  policeNumber={footerPoliceNumber}
                  policeUrl={footerPoliceUrl}
                />
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
