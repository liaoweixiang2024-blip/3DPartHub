import { Fragment, useEffect, useRef, useState, type ChangeEvent, type CompositionEvent } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../../../components/shared/Icon';
import { PageTitle } from '../../../../components/shared/PagePrimitives';
import Pagination from '../../../../components/shared/Pagination';
import SearchField from '../../../../components/shared/SearchField';
import { AnnouncementBanner, SkeletonCard, SkeletonListCard } from '../../shared/HomeDesktopShared';
import type { Category } from '../../shared/homeTypes';
import type { DesktopHomeThemeProps } from '../../types';

const WORKBENCH_TITLE_SEARCH_DEBOUNCE_MS = 280;

function clampTitleSearchInput(value: string, maxLength: number) {
  return Array.from(value).slice(0, maxLength).join('');
}

function WorkbenchCategorySidebar({
  activeCategory,
  categories: categoriesData,
  totalCount,
  onSelect,
}: {
  activeCategory: string;
  categories: Category[];
  totalCount: number;
  onSelect: (id: string) => void;
}) {
  const activeParent = categoriesData.find(
    (category) =>
      category.id === activeCategory || (category.children?.some((child) => child.id === activeCategory) ?? false),
  );
  const allCount = totalCount || categoriesData.reduce((sum, category) => sum + category.count, 0);

  return (
    <aside className="home-workbench-category-sidebar" aria-label="分类筛选">
      <div className="home-workbench-category-sidebar-header">
        <span className="home-workbench-category-title">模型分类</span>
        <span className="home-workbench-category-current">当前：{activeParent ? activeParent.name : '全部模型'}</span>
      </div>
      <div className="home-workbench-sidebar-list scrollbar-hidden">
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSelect('all')}
          className={`home-workbench-sidebar-item ${
            activeCategory === 'all' ? 'home-workbench-sidebar-item-active' : ''
          }`}
        >
          <Icon name="category_all" size={16} />
          <span>全部模型</span>
          <span className="home-workbench-filter-count">{allCount}</span>
        </button>
        {categoriesData.map((category) => {
          const active =
            activeCategory === category.id ||
            (category.children?.some((child) => child.id === activeCategory) ?? false);
          const visibleChildren = active ? category.children || [] : [];
          return (
            <Fragment key={category.id}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelect(category.id)}
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
                      onClick={() => onSelect(child.id)}
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
        'aria-label': '模型搜索',
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
      placeholder="搜索型号、名称、规格..."
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
}: {
  contactAddress: string;
  contactEmail: string;
  contactPhone: string;
  footerCopyright: string;
  footerLinks: { label: string; url: string }[];
}) {
  return (
    <footer className="home-workbench-footer">
      <div className="flex min-w-0 flex-col gap-2">
        <p className="text-[11px] text-on-surface-variant/45">{footerCopyright}</p>
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
          <nav aria-label="相关链接" className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-[10px] font-medium text-on-surface-variant/35">相关链接</span>
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
  breadcrumb,
  categories,
  contactAddress,
  contactEmail,
  contactPhone,
  displayTotalItems,
  footerCopyright,
  footerLinks,
  homePageSizeOptions,
  homeSearchMaxLength,
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
  totalItems,
  totalModelCount,
  totalPages,
  viewMode,
  onHeroSearch,
  onPageChange,
  onPageSizeChange,
  onSelectCategory,
  onSortChange,
  onViewModeChange,
}: DesktopHomeThemeProps) {
  return (
    <div className="home-page-desktop flex flex-1 overflow-hidden" data-home-theme="workbench">
      <main
        ref={scrollContainerRef}
        className="home-scroll-container home-desktop-content model-list-scrollbar flex-1 bg-surface-dim p-6 relative"
      >
        <AnnouncementBanner />

        <div className="home-workbench-layout">
          <WorkbenchCategorySidebar
            activeCategory={activeCategory}
            categories={categories}
            totalCount={totalModelCount}
            onSelect={onSelectCategory}
          />

          <section className="home-workbench-results-panel" aria-label="模型列表">
            <div ref={resultsAnchorRef} className="home-workbench-results-anchor" />
            <div className="home-title-toolbar flex flex-col gap-2.5 mb-6 border-b border-surface-container-low pb-3">
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
                <div className="home-title-mainbar flex items-center gap-3">
                  <div className="home-title-mainline flex items-center gap-3">
                    <PageTitle>零件模型库</PageTitle>
                    <span className="home-title-count-badge rounded-sm border border-outline-variant/20 bg-surface-container-high px-2 py-0.5 text-xs text-on-surface-variant">
                      {displayTotalItems} 个模型
                    </span>
                  </div>
                  <div className="home-title-search-wrap">
                    <WorkbenchTitleSearch
                      query={searchQuery}
                      maxLength={homeSearchMaxLength}
                      normalizeQuery={normalizeSearchQuery}
                      onSearch={onHeroSearch}
                    />
                  </div>
                  <div className="home-toolbar-actions ml-auto flex items-center gap-3">
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
                <div
                  className={`home-model-grid grid gap-3 ${
                    viewMode === 'grid'
                      ? 'home-model-grid-grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'
                      : 'home-model-grid-list grid-cols-1 gap-2'
                  }`}
                >
                  {products.map(renderProductCard)}
                </div>

                {products.length === 0 && !showHomeListSkeleton && (
                  <div className="home-model-empty-state flex flex-col items-center justify-center gap-4 py-20">
                    <Icon name="search_off" size={48} className="text-on-surface-variant/30" />
                    <div className="text-center">
                      <p className="text-on-surface-variant">没有找到匹配的模型</p>
                      {searchQuery.trim() && (
                        <p className="mt-1 text-xs text-on-surface-variant/60">
                          可以提交需求，请管理员补充或完善模型库。
                        </p>
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

                <div className="home-workbench-list-spacer" aria-hidden="true" />
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
                <WorkbenchHomeFooter
                  contactAddress={contactAddress}
                  contactEmail={contactEmail}
                  contactPhone={contactPhone}
                  footerCopyright={footerCopyright}
                  footerLinks={footerLinks}
                />
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
