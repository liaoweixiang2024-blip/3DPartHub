import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ColumnDef } from '../../api/selections';
import Icon from '../shared/Icon';
import SelectMenu from '../shared/SelectMenu';
import { SELECTION_ICON_BUTTON_DELETE } from './constants';

export function ColumnEditor({ columns, onChange }: { columns: ColumnDef[]; onChange: (cols: ColumnDef[]) => void }) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [openAdvancedIdx, setOpenAdvancedIdx] = useState<number | null>(null);
  const { t } = useTranslation();

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
      delete current.valueType;
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
      delete current.valueType;
    } else {
      delete current.inputType;
      delete current.displayOnly;
      delete current.placeholder;
      delete current.suffix;
      delete current.valueType;
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
          <label className="text-sm font-bold text-on-surface">{t('selectionAdmin.colDefTitle')}</label>
          <p className="mt-0.5 text-[11px] text-on-surface-variant/70">{t('selectionAdmin.colDefHint')}</p>
        </div>
        <button
          type="button"
          onClick={addColumn}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary-container px-3 py-2 text-xs font-bold text-on-primary hover:opacity-90"
        >
          <Icon name="add" size={14} /> {t('selectionAdmin.addColumn')}
        </button>
      </div>

      <div className="rounded-xl border border-outline-variant/15 bg-surface-container-lowest p-3 text-xs text-on-surface-variant">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary-container/10 text-primary-container">
              <Icon name="info" size={14} />
            </span>
            <div>
              <p className="font-bold text-on-surface">{t('selectionAdmin.howToReadTitle')}</p>
              <p className="mt-1 leading-5">{t('selectionAdmin.howToRead')}</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-1.5 text-[10px] sm:w-[330px]">
            <span className="rounded-md bg-surface-container-high px-2 py-1 text-center">
              {t('selectionAdmin.chipSelect')}
            </span>
            <span className="rounded-md bg-surface-container-high px-2 py-1 text-center">
              {t('selectionAdmin.chipManual')}
            </span>
            <span className="rounded-md bg-surface-container-high px-2 py-1 text-center">
              {t('selectionAdmin.chipDisplay')}
            </span>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-outline-variant/15 bg-surface-container-low shadow-sm">
        <div className="hidden grid-cols-[36px_44px_minmax(150px,1.1fr)_minmax(170px,1.1fr)_76px_118px_104px_40px] items-center gap-2 border-b border-outline-variant/10 bg-surface-container-high px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-on-surface-variant md:grid">
          <span />
          {/* 表头文字按下方控件的内边距内缩，视觉上与输入框文字对齐（输入框 13px / 下拉与按钮 9px / 序号徽标 8px） */}
          <span className="pl-2">{t('selectionAdmin.colOrder')}</span>
          <span className="pl-[13px]">{t('selectionAdmin.colField')}</span>
          <span className="pl-[13px]">{t('selectionAdmin.colLabelHead')}</span>
          <span className="pl-[13px]">{t('selectionAdmin.colUnit')}</span>
          <span className="pl-[9px]">{t('selectionAdmin.colType')}</span>
          <span className="pl-[9px]">{t('selectionAdmin.colSettings')}</span>
          <span />
        </div>

        {columns.length === 0 ? (
          <div className="grid place-items-center px-4 py-10 text-center">
            <Icon name="view_column" size={28} className="mb-2 text-on-surface-variant/30" />
            <p className="text-sm font-medium text-on-surface">{t('selectionAdmin.noColumnsYet')}</p>
            <p className="mt-1 text-xs text-on-surface-variant">{t('selectionAdmin.noColumnsHint')}</p>
            <button
              type="button"
              onClick={addColumn}
              className="mt-3 rounded-lg bg-primary-container px-3 py-2 text-xs font-bold text-on-primary hover:opacity-90"
            >
              {t('selectionAdmin.addFirstColumn')}
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
                ? t('selectionAdmin.modeManual')
                : mode === 'preset'
                  ? t('selectionAdmin.modePreset')
                  : mode === 'displayOnly'
                    ? t('selectionAdmin.modeDisplay')
                    : t('selectionAdmin.modeSelect');

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
                      {t('selectionAdmin.colField')}
                    </span>
                    <input
                      name="key"
                      value={col.key}
                      onChange={(e) => updateCol(i, 'key', e.target.value)}
                      placeholder={t('selectionAdmin.fieldPlaceholder')}
                      title={t('selectionAdmin.fieldTitle')}
                      className="h-9 w-full min-w-0 rounded-lg border border-outline-variant/15 bg-surface-container-lowest px-3 text-sm text-on-surface outline-none transition-colors focus:border-primary-container focus:ring-2 focus:ring-primary-container/10"
                    />
                  </label>
                  <label className="min-w-0">
                    <span className="mb-1 block text-[10px] font-medium text-on-surface-variant md:hidden">
                      {t('selectionAdmin.colLabelHead')}
                    </span>
                    <input
                      name="label"
                      value={col.label}
                      onChange={(e) => updateCol(i, 'label', e.target.value)}
                      placeholder={t('selectionAdmin.labelPlaceholder')}
                      title={t('selectionAdmin.labelTitle')}
                      className="h-9 w-full min-w-0 rounded-lg border border-outline-variant/15 bg-surface-container-lowest px-3 text-sm text-on-surface outline-none transition-colors focus:border-primary-container focus:ring-2 focus:ring-primary-container/10"
                    />
                  </label>
                  <label>
                    <span className="mb-1 block text-[10px] font-medium text-on-surface-variant md:hidden">
                      {t('selectionAdmin.colUnit')}
                    </span>
                    <input
                      name="unit"
                      value={col.unit}
                      onChange={(e) => updateCol(i, 'unit', e.target.value)}
                      placeholder={t('selectionAdmin.colUnit')}
                      className="h-9 w-full rounded-lg border border-outline-variant/15 bg-surface-container-lowest px-3 text-sm text-on-surface outline-none transition-colors focus:border-primary-container focus:ring-2 focus:ring-primary-container/10"
                    />
                  </label>
                  <label>
                    <span className="mb-1 block text-[10px] font-medium text-on-surface-variant md:hidden">
                      {t('selectionAdmin.colType')}
                    </span>
                    <SelectMenu
                      variant="field"
                      ariaLabel={t('selectionAdmin.colType')}
                      value={mode}
                      onChange={(value) => updateColumnMode(i, value as 'select' | 'manual' | 'preset' | 'displayOnly')}
                      options={[
                        { value: 'select', label: t('selectionAdmin.modeSelect') },
                        { value: 'manual', label: t('selectionAdmin.modeManual') },
                        { value: 'preset', label: t('selectionAdmin.modePreset') },
                        { value: 'displayOnly', label: t('selectionAdmin.modeDisplay') },
                      ]}
                    />
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
                      {isAdvancedOpen ? t('selectionAdmin.collapse') : t('selectionAdmin.more')}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeCol(i)}
                      className={`${SELECTION_ICON_BUTTON_DELETE} md:hidden`}
                      data-tooltip-ignore
                      aria-label={t('selectionAdmin.deleteColumnAria')}
                    >
                      <Icon name="delete" size={15} />
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => removeCol(i)}
                    className={`${SELECTION_ICON_BUTTON_DELETE} hidden md:grid`}
                    data-tooltip-ignore
                    aria-label={t('selectionAdmin.deleteColumnAria')}
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
                          ? t('selectionAdmin.modeManualHint', { field: col.key || t('selectionAdmin.colField') })
                          : mode === 'preset'
                            ? t('selectionAdmin.modePresetHint', { field: col.key || t('selectionAdmin.colField') })
                            : mode === 'displayOnly'
                              ? t('selectionAdmin.modeDisplayHint')
                              : t('selectionAdmin.modeSelectHint')}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      {mode === 'preset' && (
                        <>
                          <label className="sm:col-span-2">
                            <span className="mb-1 block text-[10px] text-on-surface-variant">
                              {t('selectionAdmin.presetOptionsLabel')}
                            </span>
                            <input
                              name="text"
                              value={(col.presetOptions || []).join(',')}
                              onChange={(e) => {
                                const val = e.target.value
                                  .split(',')
                                  .map((s: string) => s.trim())
                                  .filter(Boolean);
                                updateCol(i, 'presetOptions', val.length ? val : undefined);
                              }}
                              placeholder={t('selectionAdmin.presetPlaceholder')}
                              className="h-9 w-full rounded-lg border border-outline-variant/15 bg-surface-container-low px-3 text-xs text-on-surface outline-none focus:border-primary-container"
                            />
                          </label>
                          <label>
                            <span className="mb-1 block text-[10px] text-on-surface-variant">
                              {t('selectionAdmin.dependsField')}
                            </span>
                            <SelectMenu
                              variant="field"
                              ariaLabel={t('selectionAdmin.dependsField')}
                              value={col.dependsOn?.field || ''}
                              onChange={(field) => {
                                if (!field) {
                                  updateCol(i, 'dependsOn', undefined);
                                } else {
                                  updateCol(i, 'dependsOn', { field, minIndex: col.dependsOn?.minIndex ?? 1 });
                                }
                              }}
                              options={[
                                { value: '', label: t('selectionAdmin.noDepend') },
                                ...columns
                                  .filter((c, ci) => ci !== i && c.key)
                                  .map((c) => ({ value: c.key as string, label: c.label || (c.key as string) })),
                              ]}
                            />
                          </label>
                          <label>
                            <span className="mb-1 block text-[10px] text-on-surface-variant">
                              {t('selectionAdmin.dependMinIndex')}
                            </span>
                            <input
                              name="depends-on"
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
                              placeholder={t('selectionAdmin.dependMinPlaceholder')}
                              className="h-9 w-full rounded-lg border border-outline-variant/15 bg-surface-container-low px-3 text-xs text-on-surface outline-none focus:border-primary-container disabled:opacity-40"
                            />
                          </label>
                        </>
                      )}
                      <label>
                        <span className="mb-1 block text-[10px] text-on-surface-variant">
                          {t('selectionAdmin.valueType')}
                        </span>
                        <SelectMenu
                          variant="field"
                          ariaLabel={t('selectionAdmin.valueType')}
                          disabled={mode !== 'manual'}
                          value={col.valueType === 'number' ? 'number' : 'text'}
                          onChange={(value) => updateCol(i, 'valueType', value === 'number' ? 'number' : undefined)}
                          options={[
                            { value: 'text', label: t('selectionAdmin.anyText') },
                            { value: 'number', label: t('selectionAdmin.numberOnly') },
                          ]}
                        />
                      </label>
                      <label>
                        <span className="mb-1 block text-[10px] text-on-surface-variant">
                          {t('selectionAdmin.placeholderLabel')}
                        </span>
                        <input
                          name="placeholder"
                          value={col.placeholder || ''}
                          onChange={(e) => updateCol(i, 'placeholder', e.target.value || undefined)}
                          disabled={mode !== 'manual'}
                          placeholder={t('selectionAdmin.placeholderPlaceholder')}
                          className="h-9 w-full rounded-lg border border-outline-variant/15 bg-surface-container-low px-3 text-xs text-on-surface outline-none focus:border-primary-container disabled:opacity-40"
                        />
                      </label>
                      <label>
                        <span className="mb-1 block text-[10px] text-on-surface-variant">
                          {t('selectionAdmin.suffixLabel')}
                        </span>
                        <input
                          name="suffix"
                          value={col.suffix || ''}
                          onChange={(e) => updateCol(i, 'suffix', e.target.value || undefined)}
                          disabled={mode !== 'manual'}
                          placeholder={t('selectionAdmin.suffixPlaceholder')}
                          className="h-9 w-full rounded-lg border border-outline-variant/15 bg-surface-container-low px-3 text-xs text-on-surface outline-none focus:border-primary-container disabled:opacity-40"
                        />
                      </label>
                      <label>
                        <span className="mb-1 block text-[10px] text-on-surface-variant">
                          {t('selectionAdmin.showInResults')}
                        </span>
                        <SelectMenu
                          variant="field"
                          ariaLabel={t('selectionAdmin.showInResults')}
                          value={col.hideInResults ? 'hide' : 'show'}
                          onChange={(value) => updateCol(i, 'hideInResults', value === 'hide' ? true : undefined)}
                          options={[
                            { value: 'show', label: t('selectionAdmin.show') },
                            { value: 'hide', label: t('selectionAdmin.hideCount') },
                          ]}
                        />
                      </label>
                      <label>
                        <span className="mb-1 block text-[10px] text-on-surface-variant">
                          {t('selectionAdmin.legacyPlaceholder')}
                        </span>
                        <input
                          name="legacy-placeholder"
                          value={col.legacyPlaceholder || ''}
                          onChange={(e) => updateCol(i, 'legacyPlaceholder', e.target.value || undefined)}
                          disabled={mode !== 'manual'}
                          placeholder={t('selectionAdmin.legacyPlaceholderExample')}
                          className="h-9 w-full rounded-lg border border-outline-variant/15 bg-surface-container-low px-3 text-xs text-on-surface outline-none focus:border-primary-container disabled:opacity-40"
                        />
                      </label>
                      <label>
                        <span className="mb-1 block text-[10px] text-on-surface-variant">
                          {t('selectionAdmin.sortType')}
                        </span>
                        <SelectMenu
                          variant="field"
                          ariaLabel={t('selectionAdmin.sortType')}
                          disabled={mode !== 'select'}
                          value={col.sortType || 'default'}
                          onChange={(value) =>
                            updateCol(i, 'sortType', value === 'default' ? undefined : (value as ColumnDef['sortType']))
                          }
                          options={[
                            { value: 'default', label: t('selectionAdmin.sortByText') },
                            { value: 'numeric', label: t('selectionAdmin.sortByNumber') },
                            { value: 'thread', label: t('selectionAdmin.sortBySize') },
                          ]}
                        />
                      </label>
                      <label>
                        <span className="mb-1 block text-[10px] text-on-surface-variant">
                          {t('selectionAdmin.optionDisplay')}
                        </span>
                        <SelectMenu
                          variant="field"
                          ariaLabel={t('selectionAdmin.optionDisplay')}
                          disabled={mode !== 'select'}
                          value={col.optionDisplay || 'auto'}
                          onChange={(value) =>
                            updateCol(
                              i,
                              'optionDisplay',
                              value === 'auto' ? undefined : (value as ColumnDef['optionDisplay']),
                            )
                          }
                          options={[
                            { value: 'auto', label: t('selectionAdmin.autoImage') },
                            { value: 'text', label: t('selectionAdmin.textButtons') },
                            { value: 'image', label: t('selectionAdmin.imageCards') },
                          ]}
                        />
                      </label>
                      <label>
                        <span className="mb-1 block text-[10px] text-on-surface-variant">
                          {t('selectionAdmin.showCountLabel')}
                        </span>
                        <SelectMenu
                          variant="field"
                          ariaLabel={t('selectionAdmin.showCountLabel')}
                          disabled={mode !== 'select'}
                          value={col.showCount === false ? 'hide' : 'show'}
                          onChange={(value) => updateCol(i, 'showCount', value === 'hide' ? false : undefined)}
                          options={[
                            { value: 'show', label: t('selectionAdmin.show') },
                            { value: 'hide', label: t('selectionAdmin.doNotShow') },
                          ]}
                        />
                      </label>
                      <label>
                        <span className="mb-1 block text-[10px] text-on-surface-variant">
                          {t('selectionAdmin.singleOption')}
                        </span>
                        <SelectMenu
                          variant="field"
                          ariaLabel={t('selectionAdmin.singleOption')}
                          disabled={mode !== 'select'}
                          value={col.autoSelectSingle === false ? 'manual' : 'auto'}
                          onChange={(value) => updateSingleOptionBehavior(i, value as 'auto' | 'manual')}
                          options={[
                            { value: 'auto', label: t('selectionAdmin.autoConfirm') },
                            { value: 'manual', label: t('selectionAdmin.manualConfirm') },
                          ]}
                        />
                      </label>
                      <label>
                        <span className="mb-1 block text-[10px] text-on-surface-variant">
                          {t('selectionAdmin.requiredLabel')}
                        </span>
                        <SelectMenu
                          variant="field"
                          ariaLabel={t('selectionAdmin.requiredLabel')}
                          disabled={mode !== 'select'}
                          value={col.required === true ? 'required' : 'skip'}
                          onChange={(value) => updateEmptyBehavior(i, value as 'skip' | 'required')}
                          options={[
                            { value: 'skip', label: t('selectionAdmin.optionalEmpty') },
                            { value: 'required', label: t('selectionAdmin.requiredMissing') },
                          ]}
                        />
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
