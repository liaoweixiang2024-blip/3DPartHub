import type { SelectionComponent } from '../../api/selections';
import Icon from '../shared/Icon';
import type { SelectionImportPolicy } from './selectionAdminUtils';

export interface BatchParsedItem {
  name: string;
  modelNo?: string;
  specs?: Record<string, string>;
  image?: string;
  pdfUrl?: string;
  isKit?: boolean;
  components?: SelectionComponent[];
}

export interface BatchImportModalProps {
  showBatchModal: boolean;
  setShowBatchModal: (v: boolean) => void;
  batchParsed: BatchParsedItem[] | null;
  setBatchParsed: React.Dispatch<React.SetStateAction<BatchParsedItem[] | null>>;
  batchErrors: string[];
  setBatchErrors: React.Dispatch<React.SetStateAction<string[]>>;
  batchImporting: boolean;
  handleBatchImport: () => void;
  handleExcelFile: (file: File) => void;
  downloadProductImportTemplate: () => void;
  uploadPolicy: SelectionImportPolicy;
}

export function BatchImportModal({
  showBatchModal,
  setShowBatchModal,
  batchParsed,
  setBatchParsed,
  batchErrors,
  setBatchErrors,
  batchImporting,
  handleBatchImport,
  handleExcelFile,
  downloadProductImportTemplate,
  uploadPolicy,
}: BatchImportModalProps) {
  if (!showBatchModal) return null;

  return (
    <div
      className="fixed inset-0 z-[320] bg-black/50 p-0 sm:flex sm:items-center sm:justify-center sm:p-4"
      onClick={() => {
        setShowBatchModal(false);
        setBatchParsed(null);
        setBatchErrors([]);
      }}
    >
      <div
        className="fixed left-3 right-3 top-[max(1rem,env(safe-area-inset-top))] bottom-[max(1rem,env(safe-area-inset-bottom))] flex min-h-0 flex-col bg-surface-container-low rounded-2xl border border-outline-variant/20 p-4 space-y-4 shadow-2xl sm:relative sm:inset-auto sm:w-full sm:max-w-lg sm:max-h-[90dvh] sm:p-5 sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 space-y-2">
          <h2 className="text-base font-bold text-on-surface">批量导入产品</h2>
          <p className="text-xs text-on-surface-variant">
            支持 .xlsx / .csv。按当前分类参数列生成模板；相同"型号编号"的产品会自动更新。
          </p>
          <div className="rounded-lg bg-surface-container-high/40 px-3 py-2 text-[11px] leading-5 text-on-surface-variant">
            <span className="font-bold text-on-surface">填写规则：</span>
            名称只写产品名称，不要带型号编号；型号编号单独填在"型号编号"列。后面的参数列必须和当前分类参数列对应。
          </div>
          <button
            type="button"
            onClick={downloadProductImportTemplate}
            className="inline-flex items-center gap-1 rounded-md border border-outline-variant/20 px-2.5 py-1.5 text-xs font-bold text-on-surface-variant hover:bg-surface-container-high"
          >
            <Icon name="download" size={14} /> 下载当前分类模板
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto pr-0.5 space-y-4">
          {/* File upload area */}
          {!batchParsed && (
            <div className="space-y-3">
              <label
                className="flex flex-col items-center justify-center w-full h-36 border-2 border-dashed border-outline-variant/30 rounded-lg cursor-pointer hover:border-primary-container/50 hover:bg-primary-container/5 transition-colors"
                onDragOver={(e) => {
                  e.preventDefault();
                  e.currentTarget.classList.add('border-primary-container/60', 'bg-primary-container/5');
                }}
                onDragLeave={(e) => {
                  e.currentTarget.classList.remove('border-primary-container/60', 'bg-primary-container/5');
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.currentTarget.classList.remove('border-primary-container/60', 'bg-primary-container/5');
                  const f = e.dataTransfer.files?.[0];
                  if (f) handleExcelFile(f);
                }}
              >
                <Icon name="upload_file" size={28} className="text-on-surface-variant/40 mb-2" />
                <span className="text-sm text-on-surface-variant">点击选择或拖拽导入文件</span>
                <span className="text-[10px] text-on-surface-variant/50 mt-1">
                  .xlsx / .csv，最大 {uploadPolicy.selectionImportMaxSizeMb}MB，最多{' '}
                  {uploadPolicy.selectionImportMaxRows} 行
                </span>
                <input
                  type="file"
                  accept=".xlsx,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleExcelFile(f);
                    e.target.value = '';
                  }}
                />
              </label>
              {batchErrors.length > 0 && (
                <div className="space-y-1">
                  {batchErrors.map((err, i) => (
                    <p key={i} className="text-xs text-error">
                      {err}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Preview parsed data */}
          {batchParsed && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <Icon name="check_circle" size={16} className="text-green-500" />
                <span className="text-on-surface font-medium">解析成功：{batchParsed.length} 条产品</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setBatchParsed(null);
                  setBatchErrors([]);
                }}
                className="text-xs text-primary-container hover:underline"
              >
                重新选择文件
              </button>
              <div className="max-h-48 overflow-y-auto scrollbar-hidden rounded-lg border border-outline-variant/10">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-surface-container-low text-on-surface-variant">
                      <th className="px-2 py-1.5 text-left">#</th>
                      <th className="px-2 py-1.5 text-left">名称</th>
                      <th className="px-2 py-1.5 text-left">型号</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batchParsed.slice(0, 20).map((p, i) => (
                      <tr key={i} className="border-t border-outline-variant/5">
                        <td className="px-2 py-1 text-on-surface-variant/50">{i + 1}</td>
                        <td className="px-2 py-1 text-on-surface truncate max-w-[150px]">{p.name}</td>
                        <td className="px-2 py-1 text-on-surface font-mono">{p.modelNo}</td>
                      </tr>
                    ))}
                    {batchParsed.length > 20 && (
                      <tr className="border-t border-outline-variant/5">
                        <td colSpan={3} className="px-2 py-1 text-on-surface-variant text-center">
                          ... 还有 {batchParsed.length - 20} 条
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {batchErrors.length > 0 && (
                <div className="space-y-1">
                  {batchErrors.map((err, i) => (
                    <p key={i} className="text-xs text-amber-500">
                      {err}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 shrink-0 pt-2 border-t border-outline-variant/10 sm:flex sm:justify-end">
          <button
            onClick={() => {
              setShowBatchModal(false);
              setBatchParsed(null);
              setBatchErrors([]);
            }}
            className="px-4 py-2.5 sm:py-2 text-sm text-on-surface-variant bg-surface-container-high/40 hover:bg-surface-container-high rounded-lg sm:rounded"
          >
            {batchParsed ? '取消' : '关闭'}
          </button>
          {batchParsed && (
            <button
              onClick={handleBatchImport}
              disabled={batchImporting}
              className="px-4 py-2.5 sm:py-2 text-sm font-bold bg-primary-container text-on-primary rounded-lg sm:rounded hover:opacity-90 disabled:opacity-50"
            >
              {batchImporting ? '导入中...' : `确认导入 ${batchParsed.length} 条`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
