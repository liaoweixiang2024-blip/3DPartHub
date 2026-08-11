/**
 * Thread-size tool: result panels (guide, measurement, data tables, error/empty states).
 * Extracted from ThreadSizeToolPage.
 */

import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../shared/Icon';
import {
  CATEGORY_FILTERS,
  type FittingSpec,
  type HoseSpec,
  type MeasurementQuery,
  type PipeSpec,
  type ThreadSpec,
  threadAngleText,
  threadInnerReference,
  threadPitchText,
  threadTaperText,
  type ToolTab,
} from './threadSizeData';
import ThreadTableScroll from './ThreadTableScroll';
import {
  TABLE_BASE,
  TABLE_CARD,
  TABLE_FIRST_BADGE,
  TABLE_FIRST_TD,
  TABLE_FIRST_TEXT,
  TABLE_FIRST_TH,
  TABLE_FIRST_WIDTH,
  TABLE_HEAD,
  TABLE_HEADER,
  TABLE_LONG_TD,
  TABLE_LONG_TH,
  TABLE_TD,
  TABLE_TH,
} from './ThreadTableScroll';

// ── Props ────────────────────────────────────────────────────────────

interface ThreadSizeResultsProps {
  showInitialDataLoading: boolean;
  showGuide: boolean;
  showMeasurementResults: boolean;
  showTechnicalResults: boolean;
  showDataError: boolean;
  showDatabaseEmpty: boolean;
  showNoResults: boolean;
  visibleTab: ToolTab;
  measurementQuery: MeasurementQuery;
  matchedThreads: Array<{
    item: ThreadSpec;
    diameterDiff: number;
    innerDiff: number;
    pitchDiff: number;
    score: number;
  }>;
  displayedThreads: ThreadSpec[];
  filteredPipes: PipeSpec[];
  filteredHoses: HoseSpec[];
  filteredFittings: FittingSpec[];
  fillMainSearch: (value: string) => void;
  applyResultAsSearch: (value: string, event?: MouseEvent<HTMLTableRowElement>) => void;
}

// ── Component ────────────────────────────────────────────────────────

export default function ThreadSizeResults({
  showInitialDataLoading,
  showGuide,
  showMeasurementResults,
  showTechnicalResults,
  showDataError,
  showDatabaseEmpty,
  showNoResults,
  visibleTab,
  measurementQuery,
  matchedThreads,
  displayedThreads,
  filteredPipes,
  filteredHoses,
  filteredFittings,
  fillMainSearch,
  applyResultAsSearch,
}: ThreadSizeResultsProps) {
  const { t } = useTranslation();
  const quickExamples = t('threadSize.guide.quickExamples', { returnObjects: true }) as string[];
  const guideGroups = [
    { key: 'thread', icon: 'hexagon' },
    { key: 'alias', icon: 'pipeline' },
    { key: 'measure', icon: 'straighten' },
    { key: 'pipe', icon: 'cat_hydraulic_hose' },
  ].map((group) => ({
    ...group,
    title: t(`threadSize.guide.cards.${group.key}.title`),
    desc: t(`threadSize.guide.cards.${group.key}.desc`),
    examples: t(`threadSize.guide.cards.${group.key}.examples`, { returnObjects: true }) as string[],
  }));

  return (
    <div
      key={`${showInitialDataLoading ? 'loading' : showGuide ? 'guide' : visibleTab}:${showMeasurementResults ? 'measurement' : showDataError ? 'error' : showDatabaseEmpty ? 'database-empty' : showNoResults ? 'empty' : 'results'}`}
      className="admin-tab-panel min-h-0 flex-1 overflow-hidden"
    >
      {showInitialDataLoading && (
        <section className="flex h-full min-h-[320px]">
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-xs text-on-surface-variant/60">{t('threadSize.loadingDots')}</span>
          </div>
        </section>
      )}

      {!showInitialDataLoading && showGuide && (
        <section className="h-full overflow-y-auto overflow-x-hidden md:overflow-hidden">
          <div className="grid min-h-full gap-2 md:h-full md:min-h-0 md:grid-rows-[auto_minmax(0,1fr)] md:gap-3">
            <div className="rounded-xl border border-outline-variant/12 bg-surface-container-low p-3 md:p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary-container/70">
                {t('threadSize.guide.eyebrow')}
              </p>
              <h2 className="mt-1.5 text-xl font-black tracking-tight text-on-surface md:text-2xl">
                {t('threadSize.guide.title')}
              </h2>
              <p className="mt-2 line-clamp-2 max-w-2xl text-xs leading-5 text-on-surface-variant md:text-sm md:leading-6">
                {t('threadSize.guide.description')}
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5 md:gap-2">
                {quickExamples.map((item) => (
                  <button
                    key={item}
                    onClick={() => fillMainSearch(item)}
                    className="rounded-md border border-outline-variant/12 bg-surface px-2 py-1.5 text-[11px] font-semibold text-on-surface-variant transition-colors hover:border-primary-container/25 hover:bg-primary-container/8 hover:text-primary-container active:scale-95 md:px-3 md:text-xs"
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid min-h-0 grid-cols-1 items-start gap-2 min-[390px]:grid-cols-2 md:grid-cols-4 md:gap-3">
              {guideGroups.map((group) => (
                <div
                  key={group.title}
                  className="flex flex-col overflow-hidden rounded-xl border border-outline-variant/12 bg-surface-container-low p-3 md:p-4"
                >
                  <div className="flex items-start gap-2 md:gap-2.5">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-surface text-primary-container md:h-9 md:w-9 md:rounded-xl">
                      <Icon name={group.icon} size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-[15px] font-black leading-tight text-on-surface md:text-lg">{group.title}</h3>
                      <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-on-surface-variant md:mt-1.5 md:text-xs md:leading-5">
                        {group.desc}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 pt-3 md:gap-2 md:pt-4">
                    {group.examples.map((item) => (
                      <button
                        key={item}
                        onClick={() => fillMainSearch(item)}
                        className="rounded-md bg-primary-container/8 px-2 py-1 text-[11px] font-semibold leading-4 text-primary-container transition-colors hover:bg-primary-container/14 active:scale-95 md:text-xs"
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Measurement Results ── */}
      {!showInitialDataLoading && showMeasurementResults && (
        <section className="h-full">
          <div className={TABLE_CARD}>
            <div className={TABLE_HEADER}>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-bold text-on-surface">{t('threadSize.measurement.title')}</h2>
                <p className="line-clamp-1 text-[11px] text-on-surface-variant/60">
                  {t('threadSize.measurement.description')}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-1">
                {measurementQuery.outer && (
                  <span className="rounded bg-surface-container-low px-1.5 py-0.5 text-[10px] text-on-surface-variant">
                    {t('threadSize.measurement.outer', { value: measurementQuery.outer })}
                  </span>
                )}
                {measurementQuery.inner && (
                  <span className="rounded bg-surface-container-low px-1.5 py-0.5 text-[10px] text-on-surface-variant">
                    {t('threadSize.measurement.inner', { value: measurementQuery.inner })}
                  </span>
                )}
                {measurementQuery.pitchMm && (
                  <span className="rounded bg-surface-container-low px-1.5 py-0.5 text-[10px] text-on-surface-variant">
                    {measurementQuery.pitchLabel || `${measurementQuery.pitchMm.toFixed(2)}mm`}
                  </span>
                )}
                {measurementQuery.family && measurementQuery.family !== 'all' && (
                  <span className="rounded bg-primary-container/10 px-1.5 py-0.5 text-[10px] text-primary-container">
                    {t(`threadSize.categories.thread_${measurementQuery.family}`, {
                      defaultValue:
                        CATEGORY_FILTERS.find((item) => item.key === `thread:${measurementQuery.family}`)?.label ||
                        measurementQuery.family,
                    })}
                  </span>
                )}
              </div>
            </div>
            {matchedThreads.length ? (
              <div>
                <ThreadTableScroll>
                  <table className={`${TABLE_BASE} min-w-[860px]`}>
                    <thead className={TABLE_HEAD}>
                      <tr>
                        <th className={`${TABLE_FIRST_TH} ${TABLE_FIRST_WIDTH}`}>{t('threadSize.table.result')}</th>
                        <th className={`${TABLE_TH} min-w-40`}>{t('threadSize.table.spec')}</th>
                        <th className={`${TABLE_TH} min-w-32`}>{t('threadSize.table.type')}</th>
                        <th className={`${TABLE_TH} min-w-28`}>{t('threadSize.table.outerDiff')}</th>
                        <th className={`${TABLE_TH} min-w-28`}>{t('threadSize.table.innerDiff')}</th>
                        <th className={`${TABLE_TH} min-w-28`}>{t('threadSize.table.pitchDiff')}</th>
                        <th className={`${TABLE_TH} min-w-44`}>{t('threadSize.table.structure')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant/10">
                      {matchedThreads.map(({ item, diameterDiff, innerDiff, pitchDiff }, index) => (
                        <tr
                          key={item.size}
                          onClick={(event) => applyResultAsSearch(item.size, event)}
                          className="cursor-pointer text-on-surface transition-colors hover:bg-surface-container-high/30 active:bg-primary-container/10"
                        >
                          <td className={`${TABLE_FIRST_TD} ${TABLE_FIRST_WIDTH}`}>
                            <span
                              className={`${TABLE_FIRST_BADGE} rounded-full px-2 py-0.5 text-[11px] font-medium ${index === 0 ? 'bg-green-500/10 text-green-600' : 'bg-surface-container-high text-on-surface-variant'}`}
                            >
                              {index === 0
                                ? t('threadSize.measurement.closest')
                                : t('threadSize.measurement.rank', { rank: index + 1 })}
                            </span>
                          </td>
                          <td className={`${TABLE_TD} font-semibold`}>{item.size}</td>
                          <td className={`${TABLE_TD} text-on-surface-variant`}>{item.familyLabel}</td>
                          <td className={`${TABLE_TD} tabular-nums`}>
                            {measurementQuery.outer ? `${diameterDiff.toFixed(2)} mm` : '-'}
                          </td>
                          <td className={`${TABLE_TD} tabular-nums`}>
                            {measurementQuery.inner ? `${innerDiff.toFixed(2)} mm` : '-'}
                          </td>
                          <td className={`${TABLE_TD} tabular-nums`}>
                            {measurementQuery.pitchMm ? `${pitchDiff.toFixed(2)} mm` : '-'}
                          </td>
                          <td className={TABLE_TD}>
                            {threadAngleText(item)} / {threadTaperText(item)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ThreadTableScroll>
              </div>
            ) : (
              <div className="px-3 py-8 text-center text-xs text-on-surface-variant">
                {t('threadSize.measurement.noMatch')}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── Thread Results ── */}
      {!showInitialDataLoading && showTechnicalResults && visibleTab === 'thread' && (
        <section className="h-full">
          <div className={TABLE_CARD}>
            <ThreadTableScroll>
              <table className={`${TABLE_BASE} min-w-[1260px]`}>
                <thead className={TABLE_HEAD}>
                  <tr>
                    <th className={`${TABLE_FIRST_TH} ${TABLE_FIRST_WIDTH}`}>{t('threadSize.table.spec')}</th>
                    <th className={`${TABLE_TH} min-w-32`}>{t('threadSize.table.type')}</th>
                    <th className={`${TABLE_TH} min-w-32`}>{t('threadSize.table.outerReference')}</th>
                    <th className={`${TABLE_TH} min-w-40`}>{t('threadSize.table.innerReference')}</th>
                    <th className={`${TABLE_TH} min-w-36`}>{t('threadSize.table.pitch')}</th>
                    <th className={`${TABLE_TH} min-w-24`}>{t('threadSize.table.angle')}</th>
                    <th className={`${TABLE_TH} min-w-40`}>{t('threadSize.table.taperStructure')}</th>
                    <th className={`${TABLE_TH} min-w-40`}>{t('threadSize.table.seal')}</th>
                    <th className={TABLE_LONG_TH}>{t('threadSize.table.note')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/10">
                  {displayedThreads.map((item) => (
                    <tr
                      key={`${item.family}-${item.size}`}
                      onClick={(event) => applyResultAsSearch(item.size, event)}
                      className="cursor-pointer text-on-surface transition-colors hover:bg-surface-container-high/30 active:bg-primary-container/10"
                    >
                      <td className={`${TABLE_FIRST_TD} ${TABLE_FIRST_WIDTH}`}>
                        <span className={TABLE_FIRST_TEXT} title={item.size}>
                          {item.size}
                        </span>
                      </td>
                      <td className={`${TABLE_TD} text-on-surface-variant`}>{item.familyLabel}</td>
                      <td className={`${TABLE_TD} tabular-nums`}>{item.majorMm.toFixed(3)} mm</td>
                      <td className={TABLE_TD}>{threadInnerReference(item)}</td>
                      <td className={TABLE_TD}>{threadPitchText(item)}</td>
                      <td className={TABLE_TD}>{threadAngleText(item)}</td>
                      <td className={TABLE_TD}>{threadTaperText(item)}</td>
                      <td className={TABLE_TD}>{item.seal}</td>
                      <td className={TABLE_LONG_TD}>{item.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ThreadTableScroll>
          </div>
        </section>
      )}

      {/* ── Pipe Results ── */}
      {!showInitialDataLoading && showTechnicalResults && visibleTab === 'pipe' && (
        <section className="h-full">
          <div className={TABLE_CARD}>
            <ThreadTableScroll>
              <table className={`${TABLE_BASE} min-w-[760px]`}>
                <thead className={TABLE_HEAD}>
                  <tr>
                    <th className={`${TABLE_FIRST_TH} ${TABLE_FIRST_WIDTH}`}>DN</th>
                    <th className={`${TABLE_TH} min-w-28`}>{t('threadSize.table.inch')}</th>
                    <th className={`${TABLE_TH} min-w-36`}>{t('threadSize.table.outerReference')}</th>
                    <th className={TABLE_LONG_TH}>{t('threadSize.table.commonUse')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/10">
                  {filteredPipes.map((item) => (
                    <tr
                      key={item.dn}
                      onClick={(event) => applyResultAsSearch(item.dn, event)}
                      className="cursor-pointer text-on-surface transition-colors hover:bg-surface-container-high/30 active:bg-primary-container/10"
                    >
                      <td className={`${TABLE_FIRST_TD} ${TABLE_FIRST_WIDTH}`}>
                        <span className={TABLE_FIRST_TEXT} title={item.dn}>
                          {item.dn}
                        </span>
                      </td>
                      <td className={TABLE_TD}>{item.inch}"</td>
                      <td className={`${TABLE_TD} tabular-nums`}>Ø {item.odMm.toFixed(1)} mm</td>
                      <td className={TABLE_LONG_TD}>{item.commonUse}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ThreadTableScroll>
          </div>
        </section>
      )}

      {/* ── Hose Results ── */}
      {!showInitialDataLoading && showTechnicalResults && visibleTab === 'hose' && (
        <section className="h-full">
          <div className={TABLE_CARD}>
            <ThreadTableScroll>
              <table className={`${TABLE_BASE} min-w-[1180px]`}>
                <thead className={TABLE_HEAD}>
                  <tr>
                    <th className={`${TABLE_FIRST_TH} ${TABLE_FIRST_WIDTH}`}>{t('threadSize.table.spec')}</th>
                    <th className={`${TABLE_TH} min-w-28`}>{t('threadSize.table.type')}</th>
                    <th className={`${TABLE_TH} min-w-32`}>{t('threadSize.table.nominalOuter')}</th>
                    <th className={`${TABLE_TH} min-w-28`}>{t('threadSize.table.inner')}</th>
                    <th className={`${TABLE_TH} min-w-36`}>{t('threadSize.table.outerRange')}</th>
                    <th className={`${TABLE_TH} min-w-36`}>{t('threadSize.table.pressure')}</th>
                    <th className={`${TABLE_TH} min-w-48`}>{t('threadSize.table.commonFitting')}</th>
                    <th className={TABLE_LONG_TH}>{t('threadSize.table.application')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/10">
                  {filteredHoses.map((item) => (
                    <tr
                      key={item.dash}
                      onClick={(event) => applyResultAsSearch(item.dash, event)}
                      className="cursor-pointer text-on-surface transition-colors hover:bg-surface-container-high/30 active:bg-primary-container/10"
                    >
                      <td className={`${TABLE_FIRST_TD} ${TABLE_FIRST_WIDTH}`}>
                        <span
                          className={`${TABLE_FIRST_BADGE} rounded-md bg-primary-container/10 px-2 py-1 font-semibold text-primary-container`}
                          title={item.dash}
                        >
                          {item.dash}
                        </span>
                      </td>
                      <td className={TABLE_TD}>
                        {item.kind === '气管' ? t('threadSize.hose.air') : item.kind || t('threadSize.hose.hydraulic')}
                      </td>
                      <td className={TABLE_TD}>{item.kind === '气管' ? item.nominalInch : `${item.nominalInch}"`}</td>
                      <td className={`${TABLE_TD} tabular-nums`}>{item.innerMm.toFixed(1)} mm</td>
                      <td className={TABLE_TD}>Ø {item.outerRangeMm} mm</td>
                      <td className={TABLE_TD}>{item.pressureMpa} MPa</td>
                      <td className={`${TABLE_TD} font-medium`}>{item.jic}</td>
                      <td className={TABLE_LONG_TD}>{item.commonUse}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ThreadTableScroll>
            <div className="border-t border-outline-variant/10 px-4 py-3 text-xs leading-5 text-on-surface-variant/60">
              {t('threadSize.hose.note')}
            </div>
          </div>
        </section>
      )}

      {/* ── Fitting Results ── */}
      {!showInitialDataLoading && showTechnicalResults && visibleTab === 'fitting' && (
        <section className="h-full">
          <div className={TABLE_CARD}>
            <ThreadTableScroll>
              <table className={`${TABLE_BASE} min-w-[1320px]`}>
                <thead className={TABLE_HEAD}>
                  <tr>
                    <th className={`${TABLE_FIRST_TH} ${TABLE_FIRST_WIDTH}`}>{t('threadSize.table.fittingCode')}</th>
                    <th className={`${TABLE_TH} min-w-44`}>{t('threadSize.table.category')}</th>
                    <th className={`${TABLE_TH} min-w-24`}>{t('threadSize.table.form')}</th>
                    <th className={`${TABLE_TH} min-w-44`}>{t('threadSize.table.fittingType')}</th>
                    <th className={`${TABLE_TH} min-w-44`}>{t('threadSize.table.threadCode')}</th>
                    <th className={`${TABLE_TH} min-w-52`}>{t('threadSize.table.insertCode')}</th>
                    <th className={`${TABLE_TH} min-w-44`}>{t('threadSize.table.sealStructure')}</th>
                    <th className={TABLE_LONG_TH}>{t('threadSize.table.note')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/10">
                  {filteredFittings.map((item) => (
                    <tr
                      key={item.code}
                      onClick={(event) => applyResultAsSearch(item.code, event)}
                      className="cursor-pointer text-on-surface transition-colors hover:bg-surface-container-high/30 active:bg-primary-container/10"
                    >
                      <td className={`${TABLE_FIRST_TD} ${TABLE_FIRST_WIDTH}`}>
                        <span
                          className={`${TABLE_FIRST_BADGE} rounded-md bg-primary-container/10 px-2 py-1 font-semibold text-primary-container`}
                          title={item.code}
                        >
                          {item.code}
                        </span>
                      </td>
                      <td className={`${TABLE_TD} font-medium`}>{item.category}</td>
                      <td className={TABLE_TD}>{item.form}</td>
                      <td className={TABLE_TD}>{item.threadType}</td>
                      <td className={`${TABLE_TD} min-w-44`}>{item.threadCodes}</td>
                      <td className={`${TABLE_TD} min-w-52 max-w-[320px] leading-6 [white-space:normal]`}>
                        {item.insertCodes}
                      </td>
                      <td className={TABLE_TD}>{item.seal}</td>
                      <td className={TABLE_LONG_TD}>{item.remark}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ThreadTableScroll>
          </div>
        </section>
      )}

      {/* ── Database Status ── */}
      {!showInitialDataLoading && (showDataError || showDatabaseEmpty) && (
        <section className="flex h-full items-center justify-center overflow-y-auto px-4 py-10 text-center">
          <div className="max-w-sm">
            <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center text-on-surface-variant/35">
              <Icon name={showDataError ? 'error' : 'database'} size={30} />
            </span>
            <h2 className="text-sm font-bold text-on-surface">
              {showDataError ? t('threadSize.status.dataErrorTitle') : t('threadSize.status.dataEmptyTitle')}
            </h2>
            <p className="mt-2 text-xs leading-6 text-on-surface-variant/70">
              {showDataError
                ? t('threadSize.status.dataErrorDescription')
                : t('threadSize.status.dataEmptyDescription')}
            </p>
          </div>
        </section>
      )}

      {/* ── No Results ── */}
      {!showInitialDataLoading && showNoResults && (
        <section className="flex h-full items-center justify-center overflow-y-auto px-4 py-10 text-center">
          <div className="max-w-sm">
            <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center text-on-surface-variant/35">
              <Icon name="search_off" size={30} />
            </span>
            <h2 className="text-sm font-bold text-on-surface">{t('threadSize.status.noResultsTitle')}</h2>
            <p className="mt-2 text-xs leading-6 text-on-surface-variant/70">
              {t('threadSize.status.noResultsDescription')}
              <br />
              {t('threadSize.status.noResultsExamples')}
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
