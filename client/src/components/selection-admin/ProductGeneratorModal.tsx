import type { ColumnDef, SelectionCategory } from '../../api/selections';
import { useTranslation } from 'react-i18next';
import { AdminButton } from '../shared/AdminControls';
import { AdminTableHeadCell, AdminTableHeadRow, ADMIN_TABLE_HEAD_CLASS } from '../shared/AdminDataTable';
import {
  APP_FIELD_HELP_CLASS,
  APP_FIELD_LABEL_CLASS,
  AppSelect,
  AppTextArea,
  AppTextInput,
} from '../shared/FormControls';
import SearchField from '../shared/SearchField';
import { parseGenerateEntries } from './selectionAdminUtils';
import type { GeneratedProductDraft } from './selectionAdminUtils';

export interface ProductGeneratorModalProps {
  showGenerateModal: boolean;
  generateCat: SelectionCategory | undefined;
  generateModelTemplate: string;
  setGenerateModelTemplate: (v: string) => void;
  generateNameTemplate: string;
  setGenerateNameTemplate: (v: string) => void;
  generateOptionTexts: Record<string, string>;
  setGenerateOptionTexts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  generateExcludeRules: string;
  setGenerateExcludeRules: (v: string) => void;
  generatePreview: GeneratedProductDraft[];
  setGeneratePreview: React.Dispatch<React.SetStateAction<GeneratedProductDraft[]>>;
  selectableGenerateColumns: ColumnDef[];
  generateTemplateExample: string;
  generateExcludeExample: string;
  initialGeneratePreviewPageSize: number;
  generatePreviewPageSize: number;
  setGeneratePreviewPageSize: React.Dispatch<React.SetStateAction<number>>;
  generatePreviewPage: number;
  setGeneratePreviewPage: React.Dispatch<React.SetStateAction<number>>;
  generatePreviewSearch: string;
  generatePreviewSearchInputValue: string;
  setGeneratePreviewSearch: (v: string) => void;
  generatePreviewSearchInputProps: React.InputHTMLAttributes<HTMLInputElement>;
  generateErrors: string[];
  generateImporting: boolean;
  setShowGenerateModal: (v: boolean) => void;
  refreshGeneratePreview: () => void;
  importGeneratedProducts: () => void;
  filteredGeneratePreview: GeneratedProductDraft[];
  generatePreviewTotalPages: number;
  generatePreviewStart: number;
  pagedGeneratePreview: GeneratedProductDraft[];
}

export function ProductGeneratorModal({
  showGenerateModal,
  generateCat,
  generateModelTemplate,
  setGenerateModelTemplate,
  generateNameTemplate,
  setGenerateNameTemplate,
  generateOptionTexts,
  setGenerateOptionTexts,
  generateExcludeRules,
  setGenerateExcludeRules,
  generatePreview,
  setGeneratePreview,
  selectableGenerateColumns,
  generateTemplateExample,
  generateExcludeExample,
  generatePreviewPageSize,
  setGeneratePreviewPageSize,
  generatePreviewPage,
  setGeneratePreviewPage,
  generatePreviewSearch,
  generatePreviewSearchInputValue,
  setGeneratePreviewSearch,
  generatePreviewSearchInputProps,
  generateErrors,
  generateImporting,
  setShowGenerateModal,
  refreshGeneratePreview,
  importGeneratedProducts,
  filteredGeneratePreview,
  generatePreviewTotalPages,
  generatePreviewStart,
  pagedGeneratePreview,
}: ProductGeneratorModalProps) {
  const { t } = useTranslation();
  if (!showGenerateModal || !generateCat) return null;

  return (
    <div
      className="fixed inset-0 z-[320] bg-black/50 p-0 sm:flex sm:items-center sm:justify-center sm:p-4"
      onClick={() => setShowGenerateModal(false)}
    >
      <div
        className="fixed left-3 right-3 top-[max(1rem,env(safe-area-inset-top))] bottom-[max(1rem,env(safe-area-inset-bottom))] flex min-h-0 flex-col bg-surface-container-low rounded-2xl border border-outline-variant/20 p-4 space-y-4 shadow-2xl sm:relative sm:inset-auto sm:w-[min(96vw,1100px)] sm:max-w-none sm:max-h-[90dvh] sm:p-5 sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 space-y-3">
          <div>
            <h2 className="text-base font-bold text-on-surface">{t('selectionAdmin.generateTitle')}</h2>
            <p className="mt-1 text-xs text-on-surface-variant">{t('selectionAdmin.generateDesc')}</p>
          </div>
          <div className="rounded-lg border border-primary-container/15 bg-primary-container/5 px-3 py-2 text-xs text-on-surface-variant">
            {t('selectionAdmin.generateTargetPrefix')}
            <span className="font-bold text-on-surface">{generateCat.name}</span>
            {t('selectionAdmin.generateTargetSuffix', { count: selectableGenerateColumns.length })}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto pr-0.5 space-y-4">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <label>
              <span className={APP_FIELD_LABEL_CLASS}>{t('selectionAdmin.modelTemplate')}</span>
              <AppTextInput
                value={generateModelTemplate}
                onChange={(e) => setGenerateModelTemplate(e.target.value)}
                placeholder={t('selectionAdmin.modelTemplatePlaceholder', { example: generateTemplateExample })}
              />
              <span className={APP_FIELD_HELP_CLASS}>{t('selectionAdmin.modelTemplateHint')}</span>
            </label>
            <label>
              <span className={APP_FIELD_LABEL_CLASS}>{t('selectionAdmin.nameTemplate')}</span>
              <AppTextInput
                value={generateNameTemplate}
                onChange={(e) => setGenerateNameTemplate(e.target.value)}
                placeholder={t('selectionAdmin.nameTemplatePlaceholder')}
              />
              <span className={APP_FIELD_HELP_CLASS}>{t('selectionAdmin.nameTemplateHint')}</span>
            </label>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {selectableGenerateColumns.map((col) => {
              const values = parseGenerateEntries(generateOptionTexts[col.key] || '');
              return (
                <label
                  key={col.key}
                  className="rounded-xl border border-outline-variant/10 bg-surface-container-high/30 p-3"
                >
                  <span className={`${APP_FIELD_LABEL_CLASS} flex items-center justify-between gap-2`}>
                    <span>
                      {col.label || col.key}
                      {col.unit ? ` (${col.unit})` : ''}
                    </span>
                    <span>{t('selectionAdmin.nOptions', { count: values.length })}</span>
                  </span>
                  <AppTextArea
                    value={generateOptionTexts[col.key] || ''}
                    onChange={(e) => {
                      setGenerateOptionTexts((prev) => ({ ...prev, [col.key]: e.target.value }));
                      setGeneratePreview([]);
                    }}
                    placeholder={t('selectionAdmin.optionPlaceholder')}
                    rows={5}
                    className="resize-y text-xs"
                  />
                  <span className={APP_FIELD_HELP_CLASS}>{t('selectionAdmin.optionHint')}</span>
                </label>
              );
            })}
          </div>

          <label className="block">
            <span className={APP_FIELD_LABEL_CLASS}>{t('selectionAdmin.excludeRulesLabel')}</span>
            <AppTextArea
              value={generateExcludeRules}
              onChange={(e) => {
                setGenerateExcludeRules(e.target.value);
                setGeneratePreview([]);
              }}
              placeholder={generateExcludeExample}
              rows={4}
              className="resize-y text-xs"
            />
            <span className={APP_FIELD_HELP_CLASS}>{t('selectionAdmin.excludeHint')}</span>
          </label>

          <div className="space-y-2 rounded-xl border border-outline-variant/10 bg-surface-container-lowest p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-bold text-on-surface">{t('selectionAdmin.previewTitle')}</p>
                <p className="text-xs text-on-surface-variant">
                  {generatePreview.length
                    ? generatePreviewSearch
                      ? t('selectionAdmin.previewSummaryFiltered', {
                          total: generatePreview.length,
                          cols: 3 + selectableGenerateColumns.length,
                          filtered: filteredGeneratePreview.length,
                        })
                      : t('selectionAdmin.previewSummary', {
                          total: generatePreview.length,
                          cols: 3 + selectableGenerateColumns.length,
                        })
                    : t('selectionAdmin.previewHint')}
                </p>
              </div>
              <AdminButton type="button" onClick={refreshGeneratePreview} size="sm" variant="secondary">
                {t('selectionAdmin.generatePreviewBtn')}
              </AdminButton>
            </div>
            {generateErrors.length > 0 && (
              <div className="space-y-1">
                {generateErrors.map((err, i) => (
                  <p key={i} className="text-xs text-amber-500">
                    {err}
                  </p>
                ))}
              </div>
            )}
            {generatePreview.length > 0 && (
              <div className="space-y-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <SearchField
                    inputProps={generatePreviewSearchInputProps}
                    value={generatePreviewSearchInputValue}
                    onClear={() => {
                      setGeneratePreviewSearch('');
                      setGeneratePreviewPage(1);
                    }}
                    placeholder={t('selectionAdmin.searchPreviewPlaceholder')}
                    className="sm:w-72"
                  />
                  <div className="flex items-center gap-2 text-xs text-on-surface-variant">
                    <span>{t('selectionAdmin.perPage')}</span>
                    <AppSelect
                      value={generatePreviewPageSize}
                      onChange={(e) => {
                        setGeneratePreviewPageSize(Number(e.target.value));
                        setGeneratePreviewPage(1);
                      }}
                      fieldSize="sm"
                    >
                      {[30, 50, 100, 200].map((size) => (
                        <option key={size} value={size}>
                          {t('selectionAdmin.perPageOption', { count: size })}
                        </option>
                      ))}
                    </AppSelect>
                  </div>
                </div>
                <div className="max-h-72 overflow-auto rounded-lg border border-outline-variant/10">
                  <table className="min-w-full border-separate border-spacing-0 text-xs">
                    <thead className={ADMIN_TABLE_HEAD_CLASS}>
                      <AdminTableHeadRow>
                        <AdminTableHeadCell className="sticky left-0 z-20 h-8 px-2 py-1.5">#</AdminTableHeadCell>
                        <AdminTableHeadCell className="h-8 px-2 py-1.5">
                          {t('selectionAdmin.colName')}
                        </AdminTableHeadCell>
                        <AdminTableHeadCell className="h-8 px-2 py-1.5">
                          {t('selectionAdmin.colModelIndex')}
                        </AdminTableHeadCell>
                        {selectableGenerateColumns.map((col) => (
                          <AdminTableHeadCell key={col.key} className="h-8 px-2 py-1.5">
                            {col.label || col.key}
                            {col.unit ? ` (${col.unit})` : ''}
                          </AdminTableHeadCell>
                        ))}
                      </AdminTableHeadRow>
                    </thead>
                    <tbody>
                      {pagedGeneratePreview.map((p, i) => (
                        <tr
                          key={`${p.modelNo}-${generatePreviewStart + i}`}
                          className="border-t border-outline-variant/5"
                        >
                          <td className="sticky left-0 z-10 bg-surface-container-lowest px-2 py-1 text-on-surface-variant/50">
                            {generatePreviewStart + i + 1}
                          </td>
                          <td className="px-2 py-1 text-on-surface whitespace-nowrap">{p.name}</td>
                          <td className="px-2 py-1 text-on-surface font-mono whitespace-nowrap">{p.modelNo}</td>
                          {selectableGenerateColumns.map((col) => (
                            <td key={col.key} className="px-2 py-1 text-on-surface whitespace-nowrap">
                              {p.specs[col.key] || '—'}
                            </td>
                          ))}
                        </tr>
                      ))}
                      {pagedGeneratePreview.length === 0 && (
                        <tr className="border-t border-outline-variant/5">
                          <td
                            colSpan={3 + selectableGenerateColumns.length}
                            className="px-2 py-6 text-center text-on-surface-variant"
                          >
                            {t('selectionAdmin.noPreviewMatch')}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-col gap-2 text-xs text-on-surface-variant sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    {t('selectionAdmin.pageIndicator', {
                      page: generatePreviewPage,
                      total: generatePreviewTotalPages,
                      range: filteredGeneratePreview.length
                        ? `${generatePreviewStart + 1}-${Math.min(generatePreviewStart + generatePreviewPageSize, filteredGeneratePreview.length)}`
                        : '0',
                      count: filteredGeneratePreview.length,
                    })}
                  </span>
                  <div className="flex items-center gap-1">
                    <AdminButton
                      type="button"
                      onClick={() => setGeneratePreviewPage(1)}
                      disabled={generatePreviewPage <= 1}
                      size="sm"
                      variant="secondary"
                    >
                      {t('selectionAdmin.firstPage')}
                    </AdminButton>
                    <AdminButton
                      type="button"
                      onClick={() => setGeneratePreviewPage((page) => Math.max(1, page - 1))}
                      disabled={generatePreviewPage <= 1}
                      size="sm"
                      variant="secondary"
                    >
                      {t('selectionAdmin.prevPage')}
                    </AdminButton>
                    <AdminButton
                      type="button"
                      onClick={() => setGeneratePreviewPage((page) => Math.min(generatePreviewTotalPages, page + 1))}
                      disabled={generatePreviewPage >= generatePreviewTotalPages}
                      size="sm"
                      variant="secondary"
                    >
                      {t('selectionAdmin.nextPage')}
                    </AdminButton>
                    <AdminButton
                      type="button"
                      onClick={() => setGeneratePreviewPage(generatePreviewTotalPages)}
                      disabled={generatePreviewPage >= generatePreviewTotalPages}
                      size="sm"
                      variant="secondary"
                    >
                      {t('selectionAdmin.lastPage')}
                    </AdminButton>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 shrink-0 pt-2 border-t border-outline-variant/10 sm:flex sm:justify-end">
          <AdminButton onClick={() => setShowGenerateModal(false)} variant="secondary" className="w-full sm:w-auto">
            {t('common.cancel')}
          </AdminButton>
          <AdminButton
            onClick={importGeneratedProducts}
            disabled={generateImporting || generatePreview.length === 0}
            variant="primary"
            className="w-full sm:w-auto"
          >
            {generateImporting
              ? t('selectionAdmin.importing')
              : t('selectionAdmin.importConfirm', { count: generatePreview.length })}
          </AdminButton>
        </div>
      </div>
    </div>
  );
}
