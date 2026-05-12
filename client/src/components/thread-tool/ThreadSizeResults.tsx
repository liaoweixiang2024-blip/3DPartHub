/**
 * Thread-size tool: result panels (guide, measurement, data tables, error/empty states).
 * Extracted from ThreadSizeToolPage.
 */

import type { MouseEvent } from 'react';
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
  return (
    <div
      key={`${showInitialDataLoading ? 'loading' : showGuide ? 'guide' : visibleTab}:${showMeasurementResults ? 'measurement' : showDataError ? 'error' : showDatabaseEmpty ? 'database-empty' : showNoResults ? 'empty' : 'results'}`}
      className="admin-tab-panel min-h-0 flex-1 overflow-hidden"
    >
      {showInitialDataLoading && (
        <section className="flex h-full min-h-[320px]">
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-xs text-on-surface-variant/60">规格数据刷新中...</span>
          </div>
        </section>
      )}

      {!showInitialDataLoading && showGuide && (
        <section className="h-full overflow-y-auto overflow-x-hidden md:overflow-hidden">
          <div className="grid min-h-full gap-2 md:h-full md:min-h-0 md:grid-rows-[auto_minmax(0,1fr)] md:gap-3">
            <div className="rounded-xl border border-outline-variant/12 bg-surface-container-low p-3 md:p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary-container/70">
                Quick Lookup
              </p>
              <h2 className="mt-1.5 text-xl font-black tracking-tight text-on-surface md:text-2xl">先输入，再确认</h2>
              <p className="mt-2 line-clamp-2 max-w-2xl text-xs leading-5 text-on-surface-variant md:text-sm md:leading-6">
                规格、俗称、DN、油管
                Dash、接头编号和实测值都可以直接搜。点击下面示例会自动填入搜索框，适合现场快速反查。
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5 md:gap-2">
                {['G1/2', '4分', 'DN25', 'M16×1.5', '-06'].map((item) => (
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

            <div className="grid min-h-0 grid-cols-1 gap-1.5 min-[390px]:grid-cols-2 md:grid-cols-4 md:grid-rows-1 md:gap-3 md:overflow-hidden">
              {[
                {
                  title: '螺纹',
                  desc: '公制、G、R/PT、NPT、JIC 规格，查看外径、牙距、牙型角。',
                  icon: 'hexagon',
                  examples: ['G1/4', 'G1/2', 'R1/2', 'NPT1/4', 'M16×1.5'],
                },
                {
                  title: '俗称',
                  desc: '几分、几寸、DN 快速换算，适合现场口头规格确认。',
                  icon: 'pipeline',
                  examples: ['2分', '4分', '6分', '1寸', 'DN25'],
                },
                {
                  title: '测量',
                  desc: '输入卡尺外径、内螺纹小径或牙距，反推最接近螺纹。',
                  icon: 'straighten',
                  examples: ['外径13.1', '内螺纹18.6', '牙距1.5'],
                },
                {
                  title: '管路',
                  desc: '油管、气管、Dash、JIC 和扣压接头编号快速查。',
                  icon: 'cat_hydraulic_hose',
                  examples: ['-06', '-08', 'JIC-06', '20411', '26711'],
                },
              ].map((group) => (
                <div
                  key={group.title}
                  className="flex min-h-[148px] flex-col overflow-hidden rounded-xl border border-outline-variant/12 bg-surface-container-low p-2.5 min-[390px]:min-h-[168px] md:min-h-0 md:p-4"
                >
                  <div className="flex min-h-0 items-start gap-2 md:gap-3">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-surface text-primary-container md:h-9 md:w-9 md:rounded-xl">
                      <Icon name={group.icon} size={16} />
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-[15px] font-black leading-tight text-on-surface md:text-lg">{group.title}</h3>
                      <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-on-surface-variant md:mt-1.5 md:text-sm md:leading-5">
                        {group.desc}
                      </p>
                    </div>
                  </div>
                  <div className="mt-auto grid grid-cols-2 gap-1 pt-2 md:flex md:flex-wrap md:content-end md:gap-2 md:pt-3">
                    {group.examples.map((item) => (
                      <button
                        key={item}
                        onClick={() => fillMainSearch(item)}
                        className="min-w-0 truncate rounded-md bg-primary-container/8 px-1.5 py-0.5 text-[10px] font-semibold leading-4 text-primary-container transition-colors hover:bg-primary-container/14 active:scale-95 md:px-2.5 md:py-1.5 md:text-xs"
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
                <h2 className="text-sm font-bold text-on-surface">测量反推</h2>
                <p className="line-clamp-1 text-[11px] text-on-surface-variant/60">按测量值匹配最接近的规格</p>
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-1">
                {measurementQuery.outer && (
                  <span className="rounded bg-surface-container-low px-1.5 py-0.5 text-[10px] text-on-surface-variant">
                    外径 {measurementQuery.outer}mm
                  </span>
                )}
                {measurementQuery.inner && (
                  <span className="rounded bg-surface-container-low px-1.5 py-0.5 text-[10px] text-on-surface-variant">
                    内径/小径 {measurementQuery.inner}mm
                  </span>
                )}
                {measurementQuery.pitchMm && (
                  <span className="rounded bg-surface-container-low px-1.5 py-0.5 text-[10px] text-on-surface-variant">
                    {measurementQuery.pitchLabel || `${measurementQuery.pitchMm.toFixed(2)}mm`}
                  </span>
                )}
                {measurementQuery.family && measurementQuery.family !== 'all' && (
                  <span className="rounded bg-primary-container/10 px-1.5 py-0.5 text-[10px] text-primary-container">
                    {CATEGORY_FILTERS.find((item) => item.key === `thread:${measurementQuery.family}`)?.label ||
                      measurementQuery.family}
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
                        <th className={`${TABLE_FIRST_TH} ${TABLE_FIRST_WIDTH}`}>结果</th>
                        <th className={`${TABLE_TH} min-w-40`}>规格</th>
                        <th className={`${TABLE_TH} min-w-32`}>类型</th>
                        <th className={`${TABLE_TH} min-w-28`}>外径差</th>
                        <th className={`${TABLE_TH} min-w-28`}>内径差</th>
                        <th className={`${TABLE_TH} min-w-28`}>牙距差</th>
                        <th className={`${TABLE_TH} min-w-44`}>结构</th>
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
                              {index === 0 ? '最接近' : `第 ${index + 1}`}
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
                暂未匹配到接近规格，可补充外径、内径/小径、牙距或牙数再试。
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
                    <th className={`${TABLE_FIRST_TH} ${TABLE_FIRST_WIDTH}`}>规格</th>
                    <th className={`${TABLE_TH} min-w-32`}>类型</th>
                    <th className={`${TABLE_TH} min-w-32`}>外径参考</th>
                    <th className={`${TABLE_TH} min-w-40`}>底孔/小径参考</th>
                    <th className={`${TABLE_TH} min-w-36`}>牙距 / 牙数</th>
                    <th className={`${TABLE_TH} min-w-24`}>牙型角</th>
                    <th className={`${TABLE_TH} min-w-40`}>锥度/结构</th>
                    <th className={`${TABLE_TH} min-w-40`}>密封方式</th>
                    <th className={TABLE_LONG_TH}>备注</th>
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
                    <th className={`${TABLE_TH} min-w-28`}>英寸</th>
                    <th className={`${TABLE_TH} min-w-36`}>外径参考</th>
                    <th className={TABLE_LONG_TH}>常见用途</th>
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
                    <th className={`${TABLE_FIRST_TH} ${TABLE_FIRST_WIDTH}`}>规格</th>
                    <th className={`${TABLE_TH} min-w-28`}>类型</th>
                    <th className={`${TABLE_TH} min-w-32`}>公称/外径</th>
                    <th className={`${TABLE_TH} min-w-28`}>内径</th>
                    <th className={`${TABLE_TH} min-w-36`}>外径范围</th>
                    <th className={`${TABLE_TH} min-w-36`}>常见压力</th>
                    <th className={`${TABLE_TH} min-w-48`}>常配接头</th>
                    <th className={TABLE_LONG_TH}>应用</th>
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
                      <td className={TABLE_TD}>{item.kind || '液压油管'}</td>
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
              油管压力会随层数、结构和品牌变化；气管压力会随 PU/PA 材质、温度和厂家规格变化，最终按具体样本确认。
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
                    <th className={`${TABLE_FIRST_TH} ${TABLE_FIRST_WIDTH}`}>接头编号</th>
                    <th className={`${TABLE_TH} min-w-44`}>分类</th>
                    <th className={`${TABLE_TH} min-w-24`}>形态</th>
                    <th className={`${TABLE_TH} min-w-44`}>接头类型</th>
                    <th className={`${TABLE_TH} min-w-44`}>螺纹代码</th>
                    <th className={`${TABLE_TH} min-w-52`}>可选插芯代码</th>
                    <th className={`${TABLE_TH} min-w-44`}>密封结构</th>
                    <th className={TABLE_LONG_TH}>备注</th>
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
              {showDataError ? '规格数据加载失败' : '数据库暂无规格数据'}
            </h2>
            <p className="mt-2 text-xs leading-6 text-on-surface-variant/70">
              {showDataError
                ? '请检查后端接口和数据库连接，页面不会再用前端内置表格替代真实数据。'
                : '当前页面只展示数据库数据。管理员可在「管理数据」里新增或导入规格资料。'}
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
            <h2 className="text-sm font-bold text-on-surface">没有找到匹配结果</h2>
            <p className="mt-2 text-xs leading-6 text-on-surface-variant/70">
              换成规格、俗称、型号片段或测量值再试
              <br />
              例如 G1/2、4分、DN25、-06、20.9 14牙
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
