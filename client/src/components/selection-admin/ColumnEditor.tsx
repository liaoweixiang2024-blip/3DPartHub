import { useState } from 'react';
import type { ColumnDef } from '../../api/selections';
import Icon from '../shared/Icon';
import { SELECTION_ICON_BUTTON_DELETE } from './constants';

export function ColumnEditor({ columns, onChange }: { columns: ColumnDef[]; onChange: (cols: ColumnDef[]) => void }) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [openAdvancedIdx, setOpenAdvancedIdx] = useState<number | null>(null);

  function addColumn() {
    onChange([...columns, { key: `col_${columns.length}`, label: '', unit: '' }]);
  }
  function updateCol(
    i: number,
    field: keyof ColumnDef,
    value: string | boolean | string[] | Record<string, unknown> | undefined,
  ) {
    const next = [...columns];
    next[i] = { ...next[i], [field]: value };
    if (field === 'key' && typeof value === 'string')
      next[i] = { ...next[i], key: value.replace(/\s+/g, '_').toLowerCase() };
    onChange(next);
  }
  function updateEmptyBehavior(i: number, behavior: 'skip' | 'required') {
    const next = [...columns];
    next[i] = {
      ...next[i],
      required: behavior === 'required' ? true : undefined,
      skipWhenNoOptions: behavior === 'skip' ? true : undefined,
    };
    onChange(next);
  }
  function updateSingleOptionBehavior(i: number, behavior: 'auto' | 'manual') {
    const next = [...columns];
    next[i] = {
      ...next[i],
      autoSelectSingle: behavior === 'manual' ? false : undefined,
    };
    onChange(next);
  }
  function updateColumnMode(i: number, mode: 'select' | 'manual' | 'preset' | 'displayOnly') {
    const next = [...columns];
    const current = { ...next[i] };
    if (mode === 'manual') {
      current.inputType = 'manual';
      delete current.displayOnly;
      delete current.optionDisplay;
      delete current.sortType;
      delete current.showCount;
      delete current.autoSelectSingle;
      delete current.skipWhenNoOptions;
      delete current.required;
      delete current.presetOptions;
      delete current.dependsOn;
    } else if (mode === 'preset') {
      current.inputType = 'preset';
      delete current.displayOnly;
      delete current.optionDisplay;
      delete current.sortType;
      delete current.showCount;
      delete current.autoSelectSingle;
      delete current.skipWhenNoOptions;
      delete current.required;
      delete current.placeholder;
      delete current.suffix;
      if (!current.presetOptions) current.presetOptions = [];
    } else if (mode === 'displayOnly') {
      current.displayOnly = true;
      delete current.inputType;
      delete current.optionDisplay;
      delete current.sortType;
      delete current.showCount;
      delete current.autoSelectSingle;
      delete current.skipWhenNoOptions;
      delete current.required;
    } else {
      delete current.inputType;
      delete current.displayOnly;
      delete current.placeholder;
      delete current.suffix;
    }
    next[i] = current;
    onChange(next);
  }
  function removeCol(i: number) {
    onChange(columns.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <label className="text-sm font-bold text-on-surface">参数列定义</label>
          <p className="mt-0.5 text-[11px] text-on-surface-variant/70">
            从上到下就是客户选型顺序；拖动左侧手柄可调整顺序。
          </p>
        </div>
        <button
          type="button"
          onClick={addColumn}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary-container px-3 py-2 text-xs font-bold text-on-primary hover:opacity-90"
        >
          <Icon name="add" size={14} /> 添加参数列
        </button>
      </div>

      <div className="rounded-xl border border-outline-variant/15 bg-surface-container-lowest p-3 text-xs text-on-surface-variant">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary-container/10 text-primary-container">
              <Icon name="info" size={14} />
            </span>
            <div>
              <p className="font-bold text-on-surface">怎么理解这张表</p>
              <p className="mt-1 leading-5">
                数据字段要和产品参数一致；页面名称是客户看到的文字；类型决定它是客户选择、客户填写，还是只在结果里展示。
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-1.5 text-[10px] sm:w-[330px]">
            <span className="rounded-md bg-surface-container-high px-2 py-1 text-center">客户选择=按钮筛选</span>
            <span className="rounded-md bg-surface-container-high px-2 py-1 text-center">客户填写=手输长度</span>
            <span className="rounded-md bg-surface-container-high px-2 py-1 text-center">只展示=结果信息</span>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-outline-variant/15 bg-surface-container-low shadow-sm">
        <div className="hidden grid-cols-[36px_44px_minmax(150px,1.1fr)_minmax(170px,1.1fr)_76px_118px_104px_40px] items-center gap-2 border-b border-outline-variant/10 bg-surface-container-high px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-on-surface-variant md:grid">
          <span />
          <span>顺序</span>
          <span>数据字段</span>
          <span>页面名称</span>
          <span>单位</span>
          <span>类型</span>
          <span>设置</span>
          <span />
        </div>

        {columns.length === 0 ? (
          <div className="grid place-items-center px-4 py-10 text-center">
            <Icon name="view_column" size={28} className="mb-2 text-on-surface-variant/30" />
            <p className="text-sm font-medium text-on-surface">还没有参数列</p>
            <p className="mt-1 text-xs text-on-surface-variant">添加后，客户会按这些列一步步完成选型。</p>
            <button
              type="button"
              onClick={addColumn}
              className="mt-3 rounded-lg bg-primary-container px-3 py-2 text-xs font-bold text-on-primary hover:opacity-90"
            >
              添加第一列
            </button>
          </div>
        ) : (
          columns.map((col, i) => {
            const mode = col.displayOnly
              ? 'displayOnly'
              : col.inputType === 'manual'
                ? 'manual'
                : col.inputType === 'preset'
                  ? 'preset'
                  : 'select';
            const isAdvancedOpen = openAdvancedIdx === i;
            const modeTone =
              mode === 'manual'
                ? 'bg-amber-500/10 text-amber-700'
                : mode === 'preset'
                  ? 'bg-purple-500/10 text-purple-700'
                  : mode === 'displayOnly'
                    ? 'bg-surface-container-high text-on-surface-variant'
                    : 'bg-primary-container/10 text-primary-container';
            const modeLabel =
              mode === 'manual'
                ? '客户填写'
                : mode === 'preset'
                  ? '固定选项'
                  : mode === 'displayOnly'
                    ? '只展示'
                    : '客户选择';

            return (
              <div
                key={i}
                draggable
                onDragStart={() => setDragIdx(i)}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragIdx === null || dragIdx === i) return;
                  const next = [...columns];
                  const [item] = next.splice(dragIdx, 1);
                  next.splice(i, 0, item);
                  onChange(next);
                  setDragIdx(i);
                }}
                onDragEnd={() => setDragIdx(null)}
                className={`border-b border-outline-variant/8 last:border-b-0 transition-colors hover:bg-surface-container-high/35 ${dragIdx === i ? 'opacity-40' : ''}`}
              >
                <div className="grid gap-2 px-3 py-3 md:grid-cols-[36px_44px_minmax(150px,1.1fr)_minmax(170px,1.1fr)_76px_118px_104px_40px] md:items-center">
                  <div className="flex items-center justify-between md:contents">
                    <span className="inline-flex h-8 w-8 cursor-grab select-none items-center justify-center rounded-lg text-on-surface-variant/45 hover:bg-surface-container-high hover:text-on-surface-variant active:cursor-grabbing">
                      ⠿
                    </span>
                    <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-surface-container-high px-2 text-xs font-bold text-on-surface-variant md:justify-self-start">
                      {i + 1}
                    </span>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-bold md:hidden ${modeTone}`}>
                      {modeLabel}
                    </span>
                  </div>

                  <label className="min-w-0">
                    <span className="mb-1 block text-[10px] font-medium text-on-surface-variant md:hidden">
                      数据字段
                    </span>
                    <input
                      value={col.key}
                      onChange={(e) => updateCol(i, 'key', e.target.value)}
                      placeholder="如 通径"
                      title="必须和产品参数 specs 里的字段名一致"
                      className="h-9 w-full min-w-0 rounded-lg border border-outline-variant/15 bg-surface-container-lowest px-3 text-sm text-on-surface outline-none transition-colors focus:border-primary-container focus:ring-2 focus:ring-primary-container/10"
                    />
                  </label>
                  <label className="min-w-0">
                    <span className="mb-1 block text-[10px] font-medium text-on-surface-variant md:hidden">
                      页面名称
                    </span>
                    <input
                      value={col.label}
                      onChange={(e) => updateCol(i, 'label', e.target.value)}
                      placeholder="如 选择通径"
                      title="客户在选型页面看到的名字，不影响数据匹配"
                      className="h-9 w-full min-w-0 rounded-lg border border-outline-variant/15 bg-surface-container-lowest px-3 text-sm text-on-surface outline-none transition-colors focus:border-primary-container focus:ring-2 focus:ring-primary-container/10"
                    />
                  </label>
                  <label>
                    <span className="mb-1 block text-[10px] font-medium text-on-surface-variant md:hidden">单位</span>
                    <input
                      value={col.unit}
                      onChange={(e) => updateCol(i, 'unit', e.target.value)}
                      placeholder="单位"
                      className="h-9 w-full rounded-lg border border-outline-variant/15 bg-surface-container-lowest px-3 text-sm text-on-surface outline-none transition-colors focus:border-primary-container focus:ring-2 focus:ring-primary-container/10"
                    />
                  </label>
                  <label>
                    <span className="mb-1 block text-[10px] font-medium text-on-surface-variant md:hidden">类型</span>
                    <select
                      value={mode}
                      onChange={(e) =>
                        updateColumnMode(i, e.target.value as 'select' | 'manual' | 'preset' | 'displayOnly')
                      }
                      className="h-9 w-full rounded-lg border border-outline-variant/15 bg-surface-container-lowest px-2 text-sm text-on-surface outline-none transition-colors focus:border-primary-container focus:ring-2 focus:ring-primary-container/10"
                    >
                      <option value="select">客户选择</option>
                      <option value="manual">客户填写</option>
                      <option value="preset">固定选项</option>
                      <option value="displayOnly">只展示</option>
                    </select>
                  </label>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setOpenAdvancedIdx(isAdvancedOpen ? null : i)}
                      className={`inline-flex h-9 flex-1 items-center justify-center gap-1 rounded-lg border px-2 text-xs font-medium transition-colors md:flex-none ${
                        isAdvancedOpen
                          ? 'border-primary-container/30 bg-primary-container/10 text-primary-container'
                          : 'border-outline-variant/15 bg-surface-container-lowest text-on-surface-variant hover:border-primary-container/25 hover:text-on-surface'
                      }`}
                    >
                      <Icon name={isAdvancedOpen ? 'expand_less' : 'tune'} size={14} />
                      {isAdvancedOpen ? '收起' : '更多'}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeCol(i)}
                      className={`${SELECTION_ICON_BUTTON_DELETE} md:hidden`}
                      data-tooltip-ignore
                      aria-label="删除参数列"
                    >
                      <Icon name="delete" size={15} />
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => removeCol(i)}
                    className={`${SELECTION_ICON_BUTTON_DELETE} hidden md:grid`}
                    data-tooltip-ignore
                    aria-label="删除参数列"
                  >
                    <Icon name="delete" size={15} />
                  </button>
                </div>

                {isAdvancedOpen && (
                  <div className="border-t border-outline-variant/8 bg-surface-container-lowest/70 px-3 pb-3 pt-2">
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-on-surface-variant">
                      <span className={`rounded-full px-2 py-1 font-bold ${modeTone}`}>{modeLabel}</span>
                      <span>
                        {mode === 'manual'
                          ? `型号模板中写 [${col.key || '数据字段'}]，会替换为客户填写值。`
                          : mode === 'preset'
                            ? `固定选项供客户选择，型号模板中写 [${col.key || '数据字段'}] 会被替换。`
                            : mode === 'displayOnly'
                              ? '只在结果中展示，不会成为客户选择步骤。'
                              : '用于生成筛选选项，可配置排序、图片展示和字段完整性；只有一个可选值时前台会自动确认。'}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      {mode === 'preset' && (
                        <>
                          <label className="sm:col-span-2">
                            <span className="mb-1 block text-[10px] text-on-surface-variant">可选值（逗号分隔）</span>
                            <input
                              value={(col.presetOptions || []).join(',')}
                              onChange={(e) => {
                                const val = e.target.value
                                  .split(',')
                                  .map((s: string) => s.trim())
                                  .filter(Boolean);
                                updateCol(i, 'presetOptions', val.length ? val : undefined);
                              }}
                              placeholder="如：04,06,08,10,12"
                              className="h-9 w-full rounded-lg border border-outline-variant/15 bg-surface-container-low px-3 text-xs text-on-surface outline-none focus:border-primary-container"
                            />
                          </label>
                          <label>
                            <span className="mb-1 block text-[10px] text-on-surface-variant">依赖字段</span>
                            <select
                              value={col.dependsOn?.field || ''}
                              onChange={(e) => {
                                const field = e.target.value;
                                if (!field) {
                                  updateCol(i, 'dependsOn', undefined);
                                } else {
                                  updateCol(i, 'dependsOn', { field, minIndex: col.dependsOn?.minIndex ?? 1 });
                                }
                              }}
                              className="h-9 w-full rounded-lg border border-outline-variant/15 bg-surface-container-low px-2 text-xs text-on-surface outline-none focus:border-primary-container"
                            >
                              <option value="">无（始终显示）</option>
                              {columns.map((c, ci) =>
                                ci !== i && c.key ? (
                                  <option key={c.key} value={c.key}>
                                    {c.label || c.key}
                                  </option>
                                ) : null,
                              )}
                            </select>
                          </label>
                          <label>
                            <span className="mb-1 block text-[10px] text-on-surface-variant">依赖最小序号</span>
                            <input
                              type="number"
                              min={1}
                              value={col.dependsOn?.minIndex ?? ''}
                              onChange={(e) => {
                                const v = Number(e.target.value);
                                if (col.dependsOn?.field && v >= 1) {
                                  updateCol(i, 'dependsOn', { field: col.dependsOn.field, minIndex: v });
                                }
                              }}
                              disabled={!col.dependsOn?.field}
                              placeholder="如：1 表示依赖字段≥1时显示"
                              className="h-9 w-full rounded-lg border border-outline-variant/15 bg-surface-container-low px-3 text-xs text-on-surface outline-none focus:border-primary-container disabled:opacity-40"
                            />
                          </label>
                        </>
                      )}
                      <label>
                        <span className="mb-1 block text-[10px] text-on-surface-variant">输入提示</span>
                        <input
                          value={col.placeholder || ''}
                          onChange={(e) => updateCol(i, 'placeholder', e.target.value || undefined)}
                          disabled={mode !== 'manual'}
                          placeholder="如：请输入长度，如 1.5"
                          className="h-9 w-full rounded-lg border border-outline-variant/15 bg-surface-container-low px-3 text-xs text-on-surface outline-none focus:border-primary-container disabled:opacity-40"
                        />
                      </label>
                      <label>
                        <span className="mb-1 block text-[10px] text-on-surface-variant">填写后缀</span>
                        <input
                          value={col.suffix || ''}
                          onChange={(e) => updateCol(i, 'suffix', e.target.value || undefined)}
                          disabled={mode !== 'manual'}
                          placeholder="如：M"
                          className="h-9 w-full rounded-lg border border-outline-variant/15 bg-surface-container-low px-3 text-xs text-on-surface outline-none focus:border-primary-container disabled:opacity-40"
                        />
                      </label>
                      <label>
                        <span className="mb-1 block text-[10px] text-on-surface-variant">结果里显示</span>
                        <select
                          value={col.hideInResults ? 'hide' : 'show'}
                          onChange={(e) => updateCol(i, 'hideInResults', e.target.value === 'hide' ? true : undefined)}
                          className="h-9 w-full rounded-lg border border-outline-variant/15 bg-surface-container-low px-2 text-xs text-on-surface outline-none focus:border-primary-container"
                        >
                          <option value="show">显示</option>
                          <option value="hide">隐藏</option>
                        </select>
                      </label>
                      <label>
                        <span className="mb-1 block text-[10px] text-on-surface-variant">兼容旧占位符</span>
                        <input
                          value={col.legacyPlaceholder || ''}
                          onChange={(e) => updateCol(i, 'legacyPlaceholder', e.target.value || undefined)}
                          disabled={mode !== 'manual'}
                          placeholder="如：[M]"
                          className="h-9 w-full rounded-lg border border-outline-variant/15 bg-surface-container-low px-3 text-xs text-on-surface outline-none focus:border-primary-container disabled:opacity-40"
                        />
                      </label>
                      <label>
                        <span className="mb-1 block text-[10px] text-on-surface-variant">选项排序</span>
                        <select
                          disabled={mode !== 'select'}
                          value={col.sortType || 'default'}
                          onChange={(e) =>
                            updateCol(
                              i,
                              'sortType',
                              e.target.value === 'default' ? undefined : (e.target.value as ColumnDef['sortType']),
                            )
                          }
                          className="h-9 w-full rounded-lg border border-outline-variant/15 bg-surface-container-low px-2 text-xs text-on-surface outline-none focus:border-primary-container disabled:opacity-40"
                        >
                          <option value="default">按文字</option>
                          <option value="numeric">按数字大小</option>
                          <option value="thread">按规格大小</option>
                        </select>
                      </label>
                      <label>
                        <span className="mb-1 block text-[10px] text-on-surface-variant">选项显示</span>
                        <select
                          disabled={mode !== 'select'}
                          value={col.optionDisplay || 'auto'}
                          onChange={(e) =>
                            updateCol(
                              i,
                              'optionDisplay',
                              e.target.value === 'auto' ? undefined : (e.target.value as ColumnDef['optionDisplay']),
                            )
                          }
                          className="h-9 w-full rounded-lg border border-outline-variant/15 bg-surface-container-low px-2 text-xs text-on-surface outline-none focus:border-primary-container disabled:opacity-40"
                        >
                          <option value="auto">有图用图</option>
                          <option value="text">文字按钮</option>
                          <option value="image">图片卡片</option>
                        </select>
                      </label>
                      <label>
                        <span className="mb-1 block text-[10px] text-on-surface-variant">显示产品数</span>
                        <select
                          disabled={mode !== 'select'}
                          value={col.showCount === false ? 'hide' : 'show'}
                          onChange={(e) => updateCol(i, 'showCount', e.target.value === 'hide' ? false : undefined)}
                          className="h-9 w-full rounded-lg border border-outline-variant/15 bg-surface-container-low px-2 text-xs text-on-surface outline-none focus:border-primary-container disabled:opacity-40"
                        >
                          <option value="show">显示</option>
                          <option value="hide">不显示</option>
                        </select>
                      </label>
                      <label>
                        <span className="mb-1 block text-[10px] text-on-surface-variant">单一选项</span>
                        <select
                          disabled={mode !== 'select'}
                          value={col.autoSelectSingle === false ? 'manual' : 'auto'}
                          onChange={(e) => updateSingleOptionBehavior(i, e.target.value as 'auto' | 'manual')}
                          className="h-9 w-full rounded-lg border border-outline-variant/15 bg-surface-container-low px-2 text-xs text-on-surface outline-none focus:border-primary-container disabled:opacity-40"
                        >
                          <option value="auto">默认自动确认</option>
                          <option value="manual">让客户手动点</option>
                        </select>
                      </label>
                      <label>
                        <span className="mb-1 block text-[10px] text-on-surface-variant">字段完整性</span>
                        <select
                          disabled={mode !== 'select'}
                          value={col.required === true ? 'required' : 'skip'}
                          onChange={(e) => updateEmptyBehavior(i, e.target.value as 'skip' | 'required')}
                          className="h-9 w-full rounded-lg border border-outline-variant/15 bg-surface-container-low px-2 text-xs text-on-surface outline-none focus:border-primary-container disabled:opacity-40"
                        >
                          <option value="skip">可为空，自动跳过</option>
                          <option value="required">必填，缺失提示</option>
                        </select>
                      </label>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
