/**
 * 选型分类数据包搬运弹窗（本地站 ↔ 服务器站）：
 * - SelectionExportModal  勾选分类导出 zip（设置 + 产品 + 图片/PDF 资产）
 * - SelectionImportModal  上传 zip → 预览对比 → 确认导入（slug 覆盖更新/新建，产品按型号合并不删）
 */
import { useEffect, useState } from 'react';
import {
  analyzeSelectionTransfer,
  commitSelectionTransfer,
  exportSelectionCategories,
  type SelectionCategory,
} from '../../api/selections';
import Icon from '../shared/Icon';

const MODAL_OVERLAY_CLASS = 'fixed inset-0 z-[320] bg-black/50 p-0 sm:flex sm:items-center sm:justify-center sm:p-4';
const MODAL_PANEL_CLASS =
  'fixed left-3 right-3 top-[max(1rem,env(safe-area-inset-top))] bottom-[max(1rem,env(safe-area-inset-bottom))] flex min-h-0 flex-col bg-surface-container-low rounded-2xl border border-outline-variant/20 p-4 space-y-4 shadow-2xl sm:relative sm:inset-auto sm:w-full sm:max-w-lg sm:max-h-[90dvh] sm:p-5 sm:rounded-xl';

/**
 * 数据包弹窗点遮罩不关闭（只留底部按钮 + Esc）：
 * 弹窗打开有 100-300ms 渲染空窗期，期间用户的「补点/重试点」会落在全屏遮罩上，
 * 遮罩可关时会被误判为「闪退」；导入预览误关还要重新上传 zip。
 */
function useEscapeToClose(open: boolean, enabled: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && enabled) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, enabled, onClose]);
}

/** blob 触发浏览器下载：走 downloadBrowserBlob（revoke 带 60s 延迟）。
 *  不能在 a.click() 后同步 revokeObjectURL：浏览器下载是异步读 blob 的，
 *  包一大（数据包带图片资产可到几十 MB）revoke 会先于读取完成，下载到的 zip 被截断，
 *  导入端报「无法读取压缩包或 manifest 损坏」。 */
async function downloadBlob(blob: Blob, filename: string) {
  const { downloadBrowserBlob } = await import('../../lib/browserDownload');
  await downloadBrowserBlob(blob, filename);
}

// ========== 导出弹窗 ==========

export function SelectionExportModal({
  open,
  onClose,
  categories,
  toast,
}: {
  open: boolean;
  onClose: () => void;
  categories: SelectionCategory[];
  toast: (message: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  useEscapeToClose(open, !exporting, onClose);

  if (!open) return null;

  const allSelected = categories.length > 0 && selectedIds.size === categories.length;
  const toggleAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(categories.map((c) => c.id)));
  };
  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleExport = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0 || exporting) return;
    setExporting(true);
    try {
      const blob = await exportSelectionCategories(ids);
      await downloadBlob(blob, `选型导出-${ids.length}个分类-${new Date().toISOString().slice(0, 10)}.zip`);
      toast(`已导出 ${ids.length} 个分类（含设置、产品与图片）`, 'success');
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : '导出失败', 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className={MODAL_OVERLAY_CLASS}>
      <div className={MODAL_PANEL_CLASS} onClick={(e) => e.stopPropagation()}>
        <div className="shrink-0 space-y-1">
          <h2 className="text-base font-bold text-on-surface">导出选型数据包</h2>
          <p className="text-xs text-on-surface-variant">
            打包所选分类的完整数据：参数列设置、选项图片/画册配置、全部产品（含子零件清单）和图片/PDF 文件。导出的 zip
            可在另一台站点「导入数据包」一键还原。
          </p>
        </div>

        <label
          className="flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-outline-variant/15 bg-surface-container-high/30 px-3 py-2"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            name="transfer-export-select-all"
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            className="h-4 w-4 rounded accent-primary-container"
          />
          <span className="text-sm font-medium text-on-surface">全选（{categories.length} 个分类）</span>
        </label>

        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-0.5">
          {categories.map((cat) => (
            <label
              key={cat.id}
              className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-surface-container-high/30"
            >
              <input
                name="transfer-export-cat"
                type="checkbox"
                checked={selectedIds.has(cat.id)}
                onChange={() => toggleOne(cat.id)}
                className="h-4 w-4 shrink-0 rounded accent-primary-container"
              />
              <span className="min-w-0 flex-1 truncate text-sm text-on-surface">{cat.name}</span>
              {cat.groupName && (
                <span className="shrink-0 rounded-full bg-surface-container-high/60 px-2 py-0.5 text-[10px] text-on-surface-variant">
                  {cat.groupName}
                </span>
              )}
              <span className="shrink-0 text-xs text-on-surface-variant/60">{cat.productCount ?? 0} 型号</span>
            </label>
          ))}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-outline-variant/10 pt-3">
          <button
            onClick={onClose}
            className="rounded-lg bg-surface-container-high/40 px-4 py-2.5 text-sm text-on-surface-variant hover:bg-surface-container-high sm:py-2"
          >
            关闭
          </button>
          <button
            onClick={handleExport}
            disabled={selectedIds.size === 0 || exporting}
            className="rounded-lg bg-primary-container px-4 py-2.5 text-sm font-bold text-on-primary hover:opacity-90 disabled:opacity-50 sm:py-2"
          >
            {exporting ? '打包中...' : `导出 ${selectedIds.size} 个分类`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ========== 导入弹窗 ==========

type ImportPreview = Awaited<ReturnType<typeof analyzeSelectionTransfer>>;
type ImportResult = Awaited<ReturnType<typeof commitSelectionTransfer>>;

export function SelectionImportModal({
  open,
  onClose,
  onImported,
  toast,
  maxPackageMb,
}: {
  open: boolean;
  onClose: () => void;
  /** 导入成功后刷新页面数据（分类/产品列表） */
  onImported: () => void;
  toast: (message: string, type?: 'success' | 'error' | 'info') => void;
  maxPackageMb: number;
}) {
  const [phase, setPhase] = useState<'pick' | 'preview' | 'done'>('pick');
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const reset = () => {
    setPhase('pick');
    setBusy(false);
    setFileName('');
    setPreview(null);
    setResult(null);
  };

  const close = () => {
    if (busy) return;
    onClose();
    reset();
  };

  // Esc 关闭（busy 中禁用）；遮罩点击不关闭——见顶部注释
  useEscapeToClose(open, !busy, close);

  if (!open) return null;

  const handleFile = async (file: File) => {
    if (busy) return;
    if (!file.name.toLowerCase().endsWith('.zip')) {
      toast('请选择「导出数据包」产出的 .zip 文件', 'error');
      return;
    }
    setBusy(true);
    setFileName(file.name);
    try {
      const data = await analyzeSelectionTransfer(file);
      setPreview(data);
      setPhase('preview');
    } catch (err) {
      toast(err instanceof Error ? err.message : '解析数据包失败', 'error');
      setFileName('');
    } finally {
      setBusy(false);
    }
  };

  const handleCommit = async () => {
    if (!preview || busy) return;
    setBusy(true);
    try {
      const data = await commitSelectionTransfer(preview.import_id);
      setResult(data);
      setPhase('done');
      onImported();
      const catPart = `${data.categories.created} 新建 / ${data.categories.updated} 更新`;
      const prodPart = `${data.products.created} 新增 / ${data.products.updated} 更新`;
      if (data.failed.length > 0) {
        toast(`导入完成（${data.failed.length} 个分类失败，详见弹窗）`, 'info');
      } else {
        toast(`导入完成：分类 ${catPart}，产品 ${prodPart}`, 'success');
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : '导入失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={MODAL_OVERLAY_CLASS}>
      <div className={MODAL_PANEL_CLASS} onClick={(e) => e.stopPropagation()}>
        <div className="shrink-0 space-y-1">
          <h2 className="text-base font-bold text-on-surface">导入选型数据包</h2>
          <p className="text-xs text-on-surface-variant">
            {phase === 'pick' && '选择「导出数据包」产出的 zip（含分类设置、产品和图片）。'}
            {phase === 'preview' && '导入前请确认清单：已存在的分类将被覆盖更新，产品按型号合并。'}
            {phase === 'done' && '导入完成。'}
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-0.5">
          {phase === 'pick' && (
            <label
              className="flex h-36 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-outline-variant/30 transition-colors hover:border-primary-container/50 hover:bg-primary-container/5"
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
                if (f) handleFile(f);
              }}
            >
              <Icon name="inventory_2" size={28} className="mb-2 text-on-surface-variant/40" />
              <span className="text-sm text-on-surface-variant">{busy ? '解析中...' : '点击选择或拖拽导入数据包'}</span>
              <span className="mt-1 text-[10px] text-on-surface-variant/50">.zip，最大 {maxPackageMb}MB</span>
              <input
                name="transfer-import-file"
                type="file"
                accept=".zip"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.target.value = '';
                }}
              />
            </label>
          )}

          {phase === 'preview' && preview && (
            <>
              <div className="flex items-center gap-2 text-sm">
                <Icon name="inventory_2" size={16} className="text-primary-container" />
                <span className="truncate font-medium text-on-surface">{fileName}</span>
                <button
                  type="button"
                  onClick={reset}
                  className="ml-auto shrink-0 text-xs text-primary-container hover:underline"
                >
                  重新选择
                </button>
              </div>
              <div className="overflow-hidden rounded-lg border border-outline-variant/10">
                {preview.categories.map((c) => (
                  <div
                    key={c.slug}
                    className="flex items-center gap-2 border-b border-outline-variant/5 px-3 py-2 last:border-b-0"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-on-surface">{c.name}</span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        c.exists ? 'bg-amber-500/10 text-amber-600' : 'bg-green-500/10 text-green-600'
                      }`}
                    >
                      {c.exists ? `覆盖更新（已有 ${c.current_product_count} 型号）` : '新建'}
                    </span>
                    <span className="w-14 shrink-0 text-right text-xs text-on-surface-variant/60">
                      {c.product_count} 型号
                    </span>
                  </div>
                ))}
              </div>
              <div className="rounded-lg bg-surface-container-high/40 px-3 py-2 text-[11px] leading-5 text-on-surface-variant">
                资产文件：共 {preview.assets.total} 个
                {preview.assets.missing > 0 && (
                  <span className="text-amber-600">（{preview.assets.missing} 个缺失，对应图片将无法显示）</span>
                )}
                。同名分类的设置将被覆盖，产品按型号合并；服务器上多出的型号会保留，不会被删除。
              </div>
            </>
          )}

          {phase === 'done' && result && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <Icon
                  name={result.failed.length > 0 ? 'warning' : 'check_circle'}
                  size={18}
                  className={result.failed.length > 0 ? 'text-amber-500' : 'text-green-500'}
                />
                <span className="font-bold text-on-surface">
                  {result.failed.length > 0 ? `导入完成，${result.failed.length} 个分类失败` : '导入成功'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-surface-container-high/40 px-3 py-2">
                  <p className="text-on-surface-variant">分类</p>
                  <p className="font-bold text-on-surface">
                    新建 {result.categories.created} · 更新 {result.categories.updated}
                  </p>
                </div>
                <div className="rounded-lg bg-surface-container-high/40 px-3 py-2">
                  <p className="text-on-surface-variant">产品</p>
                  <p className="font-bold text-on-surface">
                    新增 {result.products.created} · 更新 {result.products.updated}
                  </p>
                </div>
              </div>
              <p className="text-xs text-on-surface-variant">资产文件已还原 {result.assets.restored} 个。</p>
              {result.failed.length > 0 && (
                <div className="space-y-1 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                  {result.failed.map((f, i) => (
                    <p key={i} className="text-xs text-amber-600">
                      {f.slug}：{f.reason}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-outline-variant/10 pt-3">
          <button
            onClick={close}
            disabled={busy}
            className="rounded-lg bg-surface-container-high/40 px-4 py-2.5 text-sm text-on-surface-variant hover:bg-surface-container-high disabled:opacity-50 sm:py-2"
          >
            {phase === 'preview' ? '取消' : phase === 'done' ? '完成' : '关闭'}
          </button>
          {phase === 'preview' && (
            <button
              onClick={handleCommit}
              disabled={busy}
              className="rounded-lg bg-primary-container px-4 py-2.5 text-sm font-bold text-on-primary hover:opacity-90 disabled:opacity-50 sm:py-2"
            >
              {busy ? '导入中...' : `确认导入 ${preview?.categories.length ?? 0} 个分类`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
