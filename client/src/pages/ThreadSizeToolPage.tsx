import { useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import useSWR from 'swr';
import { threadSizeApi } from '../api/threadSize';
import { AdminContentPanel, AdminManagementPage } from '../components/shared/AdminManagementPage';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import Icon from '../components/shared/Icon';
import { PageRefreshIndicator } from '../components/shared/PageRefreshFallback';
import ResponsiveSectionTabs from '../components/shared/ResponsiveSectionTabs';
import SearchField from '../components/shared/SearchField';
import {
  CATEGORY_FILTERS,
  commonPipeNameAliases,
  compareFittingCodeAsc,
  compareHoseSizeAsc,
  comparePipeSizeAsc,
  compareThreadSizeAsc,
  detectToolTab,
  entryToFittingSpec,
  entryToHoseSpec,
  entryToPipeSpec,
  entryToThreadSpec,
  familyFromQuery,
  includesAnyAlias,
  normalizeText,
  parseMeasurementQuery,
  pitchToMm,
  queryAliases,
  rankedItems,
  threadAngleText,
  threadInnerValue,
  threadSizeTokens,
  threadTaperText,
  type ThreadFamily,
  type ThreadSizeResultReturnState,
  type ThreadSizeScrollPosition,
  type ToolTab,
} from '../components/thread-tool/threadSizeData';
import ThreadSizeManagementModal from '../components/thread-tool/ThreadSizeManagementModal';
import ThreadSizeResults from '../components/thread-tool/ThreadSizeResults';
import { getTableScrollPosition } from '../components/thread-tool/ThreadTableScroll';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useImeSafeSearchInput } from '../hooks/useImeSafeSearchInput';
import { useAuthStore } from '../stores/useAuthStore';

function ThreadSizeLoadingState() {
  return (
    <section className="flex h-full min-h-[320px]">
      <PageRefreshIndicator label="规格数据刷新中" />
    </section>
  );
}

export default function ThreadSizeToolPage() {
  useDocumentTitle('规格速查');
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'ADMIN';
  const [activeTab, setActiveTab] = useState<ToolTab>('thread');
  const [family, setFamily] = useState<'all' | ThreadFamily>('all');
  const [hoseKind, setHoseKind] = useState<'all' | 'hydraulic' | 'air'>('all');
  const [showGuide, setShowGuide] = useState(false);
  const resultSearchReturnRef = useRef<ThreadSizeResultReturnState | null>(null);
  const resultSearchValueRef = useRef('');
  const pendingScrollRestoreRef = useRef<ThreadSizeScrollPosition | null>(null);
  const [scrollRestoreKey, setScrollRestoreKey] = useState(0);
  const {
    value: query,
    draftValue: queryInputValue,
    setValue: setQuery,
    inputProps: queryInputProps,
  } = useImeSafeSearchInput({
    onDraftChange: (nextValue) => {
      setShowGuide(false);
      if (resultSearchValueRef.current && nextValue !== resultSearchValueRef.current) {
        resultSearchReturnRef.current = null;
        resultSearchValueRef.current = '';
      }
    },
  });
  const [managementOpen, setManagementOpen] = useState(false);

  const {
    data: publicData,
    error: publicError,
    isLoading: publicLoading,
    mutate: mutatePublicData,
  } = useSWR('thread-size-public', () => threadSizeApi.listPublic());
  const { data: managementData, mutate: mutateManagementData } = useSWR(
    isAdmin && managementOpen ? 'thread-size-admin' : null,
    () => threadSizeApi.listAdmin(),
  );

  const measurementQuery = useMemo(() => parseMeasurementQuery(query), [query]);
  const detectedTab = detectToolTab(query, activeTab);
  const visibleTab = query.trim() ? detectedTab : activeTab;
  const dbEntries = useMemo(() => publicData?.items || [], [publicData?.items]);
  const adminEntries = useMemo(() => managementData?.items || dbEntries, [dbEntries, managementData?.items]);
  const threadItems = useMemo(
    () => dbEntries.filter((item) => item.kind === 'thread').map(entryToThreadSpec),
    [dbEntries],
  );
  const pipeItems = useMemo(() => dbEntries.filter((item) => item.kind === 'pipe').map(entryToPipeSpec), [dbEntries]);
  const hoseItems = useMemo(() => dbEntries.filter((item) => item.kind === 'hose').map(entryToHoseSpec), [dbEntries]);
  const fittingItems = useMemo(
    () => dbEntries.filter((item) => item.kind === 'fitting').map(entryToFittingSpec),
    [dbEntries],
  );
  const hasTechnicalData =
    threadItems.length > 0 || pipeItems.length > 0 || hoseItems.length > 0 || fittingItems.length > 0;

  const refreshThreadSizeData = async () => {
    await Promise.all([mutatePublicData(), mutateManagementData()]);
  };

  // ── Filtered results ───────────────────────────────────────────────

  const filteredThreads = useMemo(() => {
    const aliases = measurementQuery.hasMeasurement ? [] : queryAliases(query);
    const commonNameAliases = commonPipeNameAliases(query)?.filter((alias) => !alias.startsWith('dn'));
    const items = threadItems.filter((item) => {
      const queryFamily = familyFromQuery(query);
      const activeFamily = query.trim() ? queryFamily : family;
      if (activeFamily !== 'all' && item.family !== activeFamily) return false;
      if (commonNameAliases?.length) return commonNameAliases.some((alias) => threadSizeTokens(item).includes(alias));
      if (!aliases.length) return true;
      return includesAnyAlias(
        `${item.familyLabel}${item.size}${item.seal}${item.note}${threadAngleText(item)}${threadTaperText(item)}`,
        aliases,
      );
    });
    if (commonNameAliases?.length) {
      return [...items].sort((a, b) => {
        const aIndex = Math.min(
          ...threadSizeTokens(a)
            .map((token) => commonNameAliases.indexOf(token))
            .filter((index) => index >= 0),
        );
        const bIndex = Math.min(
          ...threadSizeTokens(b)
            .map((token) => commonNameAliases.indexOf(token))
            .filter((index) => index >= 0),
        );
        return aIndex - bIndex || compareThreadSizeAsc(a, b);
      });
    }
    return rankedItems(
      items,
      query,
      'thread',
      (item) =>
        `${item.size}${item.familyLabel}${item.seal}${item.note}${threadAngleText(item)}${threadTaperText(item)}`,
      compareThreadSizeAsc,
    );
  }, [family, measurementQuery.hasMeasurement, query, threadItems]);

  const matchedThreads = useMemo(() => {
    const measuredDiameter = measurementQuery.outer || 0;
    const measuredInnerDiameter = measurementQuery.inner || 0;
    const measuredPitchMm = measurementQuery.pitchMm || null;
    const hasOuter = !!measurementQuery.outer;
    const hasInner = !!measurementQuery.inner;
    const hasPitch = !!measurementQuery.pitchMm;
    if (!hasOuter && !hasInner && !hasPitch) return [];
    const activeFamily =
      measurementQuery.family && measurementQuery.family !== 'all' ? measurementQuery.family : family;

    return threadItems
      .filter((item) => activeFamily === 'all' || item.family === activeFamily)
      .map((item) => {
        const diameterDiff = hasOuter ? Math.abs(item.majorMm - measuredDiameter) : 0;
        const innerValue = threadInnerValue(item);
        const innerDiff = hasInner && innerValue ? Math.abs(innerValue - measuredInnerDiameter) : 0;
        const itemPitch = pitchToMm(item);
        const pitchDiff = measuredPitchMm && itemPitch ? Math.abs(itemPitch - measuredPitchMm) : 0;
        const missingInnerPenalty = hasInner && !innerValue ? 20 : 0;
        const missingPitchPenalty = hasPitch && !itemPitch ? 20 : 0;
        const score = diameterDiff * 1.8 + innerDiff * 1.5 + pitchDiff * 6 + missingInnerPenalty + missingPitchPenalty;
        return { item, diameterDiff, innerDiff, pitchDiff, score };
      })
      .sort((a, b) => a.score - b.score)
      .slice(0, 8);
  }, [
    family,
    measurementQuery.family,
    measurementQuery.inner,
    measurementQuery.outer,
    measurementQuery.pitchMm,
    threadItems,
  ]);

  const filteredPipes = useMemo(() => {
    const aliases = queryAliases(query);
    const items = aliases.length
      ? pipeItems.filter((item) => includesAnyAlias(`${item.dn}${item.inch}${item.odMm}${item.commonUse}`, aliases))
      : pipeItems;
    return rankedItems(
      items,
      query,
      'pipe',
      (item) => `${item.dn}${item.inch}${item.odMm}${item.commonUse}`,
      comparePipeSizeAsc,
    );
  }, [pipeItems, query]);

  const filteredHoses = useMemo(() => {
    const aliases = queryAliases(query);
    const scopedHoses =
      !query.trim() && hoseKind !== 'all'
        ? hoseItems.filter((item) => (hoseKind === 'air' ? item.kind === '气管' : item.kind !== '气管'))
        : hoseItems;
    const items = aliases.length
      ? scopedHoses.filter((item) =>
          includesAnyAlias(
            `${item.kind || '液压油管'}${item.dash}${item.nominalInch}${item.innerMm}${item.outerRangeMm}${item.pressureMpa}${item.jic}${item.commonUse}`,
            aliases,
          ),
        )
      : scopedHoses;
    return rankedItems(
      items,
      query,
      'hose',
      (item) =>
        `${item.kind || '液压油管'}${item.dash}${item.nominalInch}${item.innerMm}${item.outerRangeMm}${item.pressureMpa}${item.jic}${item.commonUse}`,
      compareHoseSizeAsc,
    );
  }, [hoseItems, hoseKind, query]);

  const filteredFittings = useMemo(() => {
    const aliases = queryAliases(query);
    const fittingSeriesCode = normalizeText(query).match(/^(\d{5})(?:-\d{2}){0,2}$/)?.[1];
    const items = aliases.length
      ? fittingItems.filter((item) => {
          if (fittingSeriesCode) return item.code === fittingSeriesCode;
          return includesAnyAlias(
            `${item.code}${item.category}${item.form}${item.threadType}${item.threadCodes}${item.threadSpecs}${item.insertCodes}${item.hoseSizes}${item.seal}${item.remark}`,
            aliases,
          );
        })
      : fittingItems;
    return rankedItems(
      items,
      query,
      'fitting',
      (item) =>
        `${item.code}${item.category}${item.form}${item.threadType}${item.threadCodes}${item.threadSpecs}${item.insertCodes}${item.hoseSizes}${item.seal}${item.remark}`,
      compareFittingCodeAsc,
    );
  }, [fittingItems, query]);

  // ── Derived display state ──────────────────────────────────────────

  const displayedThreads = filteredThreads;
  const visibleTechnicalCount =
    visibleTab === 'thread'
      ? displayedThreads.length
      : visibleTab === 'pipe'
        ? filteredPipes.length
        : visibleTab === 'hose'
          ? filteredHoses.length
          : filteredFittings.length;
  const showMeasurementResults = !showGuide && visibleTab === 'thread' && measurementQuery.hasMeasurement;
  const showTechnicalResults = !showGuide && !showMeasurementResults && visibleTechnicalCount > 0;
  const showDataError = !showGuide && !showMeasurementResults && Boolean(publicError);
  const showDatabaseEmpty =
    !showGuide && !showMeasurementResults && !publicError && !publicLoading && !hasTechnicalData;
  const showNoResults =
    !showGuide &&
    !showMeasurementResults &&
    hasTechnicalData &&
    query.trim().length >= 2 &&
    visibleTechnicalCount === 0;
  const showInitialDataLoading = publicLoading && !publicData && !publicError;

  // ── Navigation helpers ─────────────────────────────────────────────

  const clearResultSearchReturn = () => {
    resultSearchReturnRef.current = null;
    resultSearchValueRef.current = '';
    pendingScrollRestoreRef.current = null;
  };

  const fillMainSearch = (value: string) => {
    clearResultSearchReturn();
    setQuery(value);
    setShowGuide(false);
  };

  const clearSearch = () => {
    const returnState = resultSearchReturnRef.current;
    if (returnState && query.trim() && query === resultSearchValueRef.current) {
      resultSearchReturnRef.current = null;
      resultSearchValueRef.current = '';
      pendingScrollRestoreRef.current = returnState.scroll;
      if (returnState.scroll) setScrollRestoreKey((key) => key + 1);
      setActiveTab(returnState.activeTab);
      setFamily(returnState.family);
      setHoseKind(returnState.hoseKind);
      setQuery(returnState.query);
      setShowGuide(returnState.showGuide);
      return;
    }
    clearResultSearchReturn();
    setQuery('');
    setShowGuide(true);
  };

  const categoryKey = showGuide
    ? 'guide'
    : visibleTab === 'thread'
      ? `thread:${query.trim() ? familyFromQuery(query) : family}`
      : visibleTab === 'pipe'
        ? 'pipe'
        : visibleTab === 'fitting'
          ? 'fitting'
          : `hose:${hoseKind}`;
  const selectedCategoryKey =
    categoryKey === 'guide'
      ? 'guide'
      : CATEGORY_FILTERS.some((item) => item.key === categoryKey)
        ? categoryKey
        : visibleTab === 'thread'
          ? 'thread:all'
          : categoryKey;

  const handleCategoryClick = (key: string) => {
    if (key === 'guide') {
      clearResultSearchReturn();
      setQuery('');
      setShowGuide(true);
      return;
    }
    const next = CATEGORY_FILTERS.find((item) => item.key === key)?.apply();
    if (!next) return;
    if (key === selectedCategoryKey && !query.trim()) return;
    clearResultSearchReturn();
    setQuery('');
    setShowGuide(false);
    setActiveTab(next.tab);
    if (next.family) setFamily(next.family);
    if (next.hoseKind) setHoseKind(next.hoseKind);
  };

  // ── Scroll restore ─────────────────────────────────────────────────

  useLayoutEffect(() => {
    if (!scrollRestoreKey) return;
    const scroll = pendingScrollRestoreRef.current;
    if (!scroll) return;

    let firstFrame = 0;
    let secondFrame = 0;
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const scrollNode = document.querySelector('[data-thread-size-scroll="primary"]') as HTMLElement | null;
        if (!scrollNode) return;
        scrollNode.scrollLeft = scroll.left;
        scrollNode.scrollTop = scroll.top;
        pendingScrollRestoreRef.current = null;
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [scrollRestoreKey]);

  const applyResultAsSearch = (value: string, event?: MouseEvent<HTMLTableRowElement>) => {
    resultSearchReturnRef.current = {
      activeTab,
      family,
      hoseKind,
      query,
      showGuide,
      scroll: getTableScrollPosition(event),
    };
    resultSearchValueRef.current = value;
    setQuery(value);
    setShowGuide(false);
  };

  return (
    <AdminPageShell mobileMainClassName="overflow-hidden" mobileContentClassName="h-full min-h-0 !pb-[4.5rem]">
      <AdminManagementPage
        title="螺纹与管路速查"
        description="规格、俗称、测量值直接搜索"
        actions={
          isAdmin ? (
            <button
              type="button"
              onClick={() => setManagementOpen(true)}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-outline-variant/20 bg-surface-container-low px-3 text-xs font-bold text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
            >
              <Icon name="edit" size={14} />
              管理数据
            </button>
          ) : null
        }
        toolbar={
          <div className="grid min-w-0 items-center gap-3 md:grid-cols-[15rem_minmax(0,1fr)] lg:grid-cols-[16rem_minmax(0,1fr)]">
            <SearchField
              inputProps={{
                ...queryInputProps,
                onKeyDown: (e) => {
                  queryInputProps.onKeyDown?.(e);
                  if (e.defaultPrevented) return;
                  if (e.key === 'Escape') clearSearch();
                  if (e.key === 'Enter') e.currentTarget.blur();
                },
              }}
              value={queryInputValue}
              onClear={clearSearch}
              placeholder="搜索规格、俗称、测量值..."
            />
            <div className="min-w-0">
              <ResponsiveSectionTabs
                tabs={[{ key: 'guide', label: '使用指南' }, ...CATEGORY_FILTERS].map((item) => ({
                  value: item.key,
                  label: item.label,
                  icon:
                    item.key === 'guide'
                      ? 'search'
                      : item.key.startsWith('thread')
                        ? 'hexagon'
                        : item.key === 'pipe'
                          ? 'pipeline'
                          : item.key.startsWith('hose')
                            ? 'cat_hydraulic_hose'
                            : 'cat_crimp_fitting',
                }))}
                value={selectedCategoryKey}
                onChange={handleCategoryClick}
                mobileTitle="当前分类"
              />
            </div>
          </div>
        }
        contentClassName="overflow-hidden"
      >
        <AdminContentPanel
          scroll
          className="h-full flex min-h-0 flex-col overflow-hidden rounded-none border-0 bg-transparent"
        >
          {showInitialDataLoading && <ThreadSizeLoadingState />}
          {!showInitialDataLoading && (
            <ThreadSizeResults
              showInitialDataLoading={showInitialDataLoading}
              showGuide={showGuide}
              showMeasurementResults={showMeasurementResults}
              showTechnicalResults={showTechnicalResults}
              showDataError={showDataError}
              showDatabaseEmpty={showDatabaseEmpty}
              showNoResults={showNoResults}
              visibleTab={visibleTab}
              measurementQuery={measurementQuery}
              matchedThreads={matchedThreads}
              displayedThreads={displayedThreads}
              filteredPipes={filteredPipes}
              filteredHoses={filteredHoses}
              filteredFittings={filteredFittings}
              fillMainSearch={fillMainSearch}
              applyResultAsSearch={applyResultAsSearch}
            />
          )}
        </AdminContentPanel>
      </AdminManagementPage>

      {managementOpen && (
        <ThreadSizeManagementModal
          adminEntries={adminEntries}
          onRefresh={refreshThreadSizeData}
          onClose={() => setManagementOpen(false)}
        />
      )}
    </AdminPageShell>
  );
}
