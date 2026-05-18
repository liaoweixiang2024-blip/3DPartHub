import type { ColumnDef, SelectionCategory } from '../../api/selections';
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
import { parseGenerateValues } from './selectionAdminUtils';
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
            <h2 className="text-base font-bold text-on-surface">批量生成产品组合</h2>
            <p className="mt-1 text-xs text-on-surface-variant">
              按当前已选分类的参数列组合生成型号；不允许的组合写到排除规则里。相同型号会自动更新。
            </p>
          </div>
          <div className="rounded-lg border border-primary-container/15 bg-primary-container/5 px-3 py-2 text-xs text-on-surface-variant">
            将生成到当前分类：<span className="font-bold text-on-surface">{generateCat.name}</span>，共{' '}
            {selectableGenerateColumns.length} 个生成字段。
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto pr-0.5 space-y-4">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <label>
              <span className={APP_FIELD_LABEL_CLASS}>型号模板</span>
              <AppTextInput
                value={generateModelTemplate}
                onChange={(e) => setGenerateModelTemplate(e.target.value)}
                placeholder={`如：${generateTemplateExample}`}
              />
              <span className={APP_FIELD_HELP_CLASS}>
                只把需要组成型号的字段写进模板，例如 `[系列]-[规格]`，不要把所有参数都拼进去。
              </span>
            </label>
            <label>
              <span className={APP_FIELD_LABEL_CLASS}>名称模板</span>
              <AppTextInput
                value={generateNameTemplate}
                onChange={(e) => setGenerateNameTemplate(e.target.value)}
                placeholder="不填则使用型号"
              />
              <span className={APP_FIELD_HELP_CLASS}>
                名称建议写产品名称本身，不要带型号编号；不填时会用型号编号兜底。
              </span>
            </label>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {selectableGenerateColumns.map((col) => {
              const values = parseGenerateValues(generateOptionTexts[col.key] || '');
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
                    <span>{values.length} 个</span>
                  </span>
                  <AppTextArea
                    value={generateOptionTexts[col.key] || ''}
                    onChange={(e) => {
                      setGenerateOptionTexts((prev) => ({ ...prev, [col.key]: e.target.value }));
                      setGeneratePreview([]);
                    }}
                    placeholder="一行一个选项，也支持逗号分隔"
                    rows={5}
                    className="resize-y text-xs"
                  />
                </label>
              );
            })}
          </div>

          <label className="block">
            <span className={APP_FIELD_LABEL_CLASS}>排除规则（每行一条，全部条件满足时不生成）</span>
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
            <span className={APP_FIELD_HELP_CLASS}>`*` 表示该字段有值就匹配；多个禁止值可用 `|` 分隔。</span>
          </label>

          <div className="space-y-2 rounded-xl border border-outline-variant/10 bg-surface-container-lowest p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-bold text-on-surface">生成预览</p>
                <p className="text-xs text-on-surface-variant">
                  {generatePreview.length
                    ? `将生成 ${generatePreview.length} 条产品，预览 ${3 + selectableGenerateColumns.length} 列${generatePreviewSearch ? `，已筛选 ${filteredGeneratePreview.length} 条` : ''}`
                    : '点击预览后再确认导入'}
                </p>
              </div>
              <AdminButton type="button" onClick={refreshGeneratePreview} size="sm" variant="secondary">
                生成预览
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
                    placeholder="搜索名称、型号或参数"
                    className="sm:w-72"
                  />
                  <div className="flex items-center gap-2 text-xs text-on-surface-variant">
                    <span>每页</span>
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
                          {size} 条
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
                        <AdminTableHeadCell className="h-8 px-2 py-1.5">名称</AdminTableHeadCell>
                        <AdminTableHeadCell className="h-8 px-2 py-1.5">型号编号</AdminTableHeadCell>
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
                            没有匹配的预览数据
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-col gap-2 text-xs text-on-surface-variant sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    第 {generatePreviewPage} / {generatePreviewTotalPages} 页，显示{' '}
                    {filteredGeneratePreview.length
                      ? `${generatePreviewStart + 1}-${Math.min(generatePreviewStart + generatePreviewPageSize, filteredGeneratePreview.length)}`
                      : '0'}{' '}
                    / {filteredGeneratePreview.length} 条
                  </span>
                  <div className="flex items-center gap-1">
                    <AdminButton
                      type="button"
                      onClick={() => setGeneratePreviewPage(1)}
                      disabled={generatePreviewPage <= 1}
                      size="sm"
                      variant="secondary"
                    >
                      首页
                    </AdminButton>
                    <AdminButton
                      type="button"
                      onClick={() => setGeneratePreviewPage((page) => Math.max(1, page - 1))}
                      disabled={generatePreviewPage <= 1}
                      size="sm"
                      variant="secondary"
                    >
                      上一页
                    </AdminButton>
                    <AdminButton
                      type="button"
                      onClick={() => setGeneratePreviewPage((page) => Math.min(generatePreviewTotalPages, page + 1))}
                      disabled={generatePreviewPage >= generatePreviewTotalPages}
                      size="sm"
                      variant="secondary"
                    >
                      下一页
                    </AdminButton>
                    <AdminButton
                      type="button"
                      onClick={() => setGeneratePreviewPage(generatePreviewTotalPages)}
                      disabled={generatePreviewPage >= generatePreviewTotalPages}
                      size="sm"
                      variant="secondary"
                    >
                      末页
                    </AdminButton>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 shrink-0 pt-2 border-t border-outline-variant/10 sm:flex sm:justify-end">
          <AdminButton onClick={() => setShowGenerateModal(false)} variant="secondary" className="w-full sm:w-auto">
            取消
          </AdminButton>
          <AdminButton
            onClick={importGeneratedProducts}
            disabled={generateImporting || generatePreview.length === 0}
            variant="primary"
            className="w-full sm:w-auto"
          >
            {generateImporting ? '导入中...' : `确认导入 ${generatePreview.length} 条`}
          </AdminButton>
        </div>
      </div>
    </div>
  );
}
