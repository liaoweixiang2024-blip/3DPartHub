/**
 * 选型分类数据包搬运弹窗（本地站 ↔ 服务器站）：
 * - SelectionExportModal  勾选分类导出 zip（设置 + 产品 + 图片/PDF 资产）
 * - SelectionImportModal  上传 zip → 预览对比 → 确认导入（slug 覆盖更新/新建，产品按型号合并不删）
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
      await downloadBlob(
        blob,
        t('selectionAdmin.exportFilename', { count: ids.length, date: new Date().toISOString().slice(0, 10) }),
      );
      toast(t('selectionAdmin.exportDoneToast', { count: ids.length }), 'success');
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('selectionAdmin.exportFailed'), 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className={MODAL_OVERLAY_CLASS}>
      <div className={MODAL_PANEL_CLASS} onClick={(e) => e.stopPropagation()}>
        <div className="shrink-0 space-y-1">
          <h2 className="text-base font-bold text-on-surface">{t('selectionAdmin.transferExportTitle')}</h2>
          <p className="text-xs text-on-surface-variant">{t('selectionAdmin.transferExportDesc')}</p>
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
          <span className="text-sm font-medium text-on-surface">
            {t('selectionAdmin.selectAllCategories', { count: categories.length })}
          </span>
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
              <span className="shrink-0 text-xs text-on-surface-variant/60">
                {t('selectionAdmin.nModelsFull', { count: cat.productCount ?? 0 })}
              </span>
            </label>
          ))}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-outline-variant/10 pt-3">
          <button
            onClick={onClose}
            className="rounded-lg bg-surface-container-high/40 px-4 py-2.5 text-sm text-on-surface-variant hover:bg-surface-container-high sm:py-2"
          >
            {t('common.close')}
          </button>
          <button
            onClick={handleExport}
            disabled={selectedIds.size === 0 || exporting}
            className="rounded-lg bg-primary-container px-4 py-2.5 text-sm font-bold text-on-primary hover:opacity-90 disabled:opacity-50 sm:py-2"
          >
            {exporting
              ? t('selectionAdmin.packing')
              : t('selectionAdmin.exportNCategories', { count: selectedIds.size })}
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
  const { t } = useTranslation();

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
      toast(t('selectionAdmin.zipRequired'), 'error');
      return;
    }
    setBusy(true);
    setFileName(file.name);
    try {
      const data = await analyzeSelectionTransfer(file);
      setPreview(data);
      setPhase('preview');
    } catch (err) {
      toast(err instanceof Error ? err.message : t('selectionAdmin.packageParseFailed'), 'error');
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
      const catPart = t('selectionAdmin.catPart', {
        created: data.categories.created,
        updated: data.categories.updated,
      });
      const prodPart = t('selectionAdmin.prodPart', {
        created: data.products.created,
        updated: data.products.updated,
      });
      if (data.failed.length > 0) {
        toast(t('selectionAdmin.importDoneWithFailures', { count: data.failed.length }), 'info');
      } else {
        toast(t('selectionAdmin.importDoneToast', { cats: catPart, products: prodPart }), 'success');
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : t('selectionAdmin.importFailed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={MODAL_OVERLAY_CLASS}>
      <div className={MODAL_PANEL_CLASS} onClick={(e) => e.stopPropagation()}>
        <div className="shrink-0 space-y-1">
          <h2 className="text-base font-bold text-on-surface">{t('selectionAdmin.transferImportTitle')}</h2>
          <p className="text-xs text-on-surface-variant">
            {phase === 'pick' && t('selectionAdmin.importPickDesc')}
            {phase === 'preview' && t('selectionAdmin.importPreviewDesc')}
            {phase === 'done' && t('selectionAdmin.importDoneDesc')}
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
              <span className="text-sm text-on-surface-variant">
                {busy ? t('selectionAdmin.analyzing') : t('selectionAdmin.pickPackage')}
              </span>
              <span className="mt-1 text-[10px] text-on-surface-variant/50">
                {t('selectionAdmin.packageLimits', { size: maxPackageMb })}
              </span>
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
                  {t('selectionAdmin.reselect')}
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
                      {c.exists
                        ? t('selectionAdmin.overwriteUpdate', { count: c.current_product_count })
                        : t('selectionAdmin.createNew')}
                    </span>
                    <span className="w-14 shrink-0 text-right text-xs text-on-surface-variant/60">
                      {t('selectionAdmin.nModelsFull', { count: c.product_count })}
                    </span>
                  </div>
                ))}
              </div>
              <div className="rounded-lg bg-surface-container-high/40 px-3 py-2 text-[11px] leading-5 text-on-surface-variant">
                {t('selectionAdmin.assetsTotal', { count: preview.assets.total })}
                {preview.assets.missing > 0 && (
                  <span className="text-amber-600">
                    {t('selectionAdmin.assetsMissing', { count: preview.assets.missing })}
                  </span>
                )}
                {t('selectionAdmin.importMergeHint')}
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
                  {result.failed.length > 0
                    ? t('selectionAdmin.donePartial', { count: result.failed.length })
                    : t('selectionAdmin.importSuccessLabel')}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-surface-container-high/40 px-3 py-2">
                  <p className="text-on-surface-variant">{t('selectionAdmin.catLabel')}</p>
                  <p className="font-bold text-on-surface">
                    {t('selectionAdmin.catStatLine', {
                      created: result.categories.created,
                      updated: result.categories.updated,
                    })}
                  </p>
                </div>
                <div className="rounded-lg bg-surface-container-high/40 px-3 py-2">
                  <p className="text-on-surface-variant">{t('selectionAdmin.prodLabel')}</p>
                  <p className="font-bold text-on-surface">
                    {t('selectionAdmin.prodStatLine', {
                      created: result.products.created,
                      updated: result.products.updated,
                    })}
                  </p>
                </div>
              </div>
              <p className="text-xs text-on-surface-variant">
                {t('selectionAdmin.assetsRestored', { count: result.assets.restored })}
              </p>
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
            {phase === 'preview' ? t('common.cancel') : phase === 'done' ? t('selectionAdmin.done') : t('common.close')}
          </button>
          {phase === 'preview' && (
            <button
              onClick={handleCommit}
              disabled={busy}
              className="rounded-lg bg-primary-container px-4 py-2.5 text-sm font-bold text-on-primary hover:opacity-90 disabled:opacity-50 sm:py-2"
            >
              {busy
                ? t('selectionAdmin.importing')
                : t('selectionAdmin.confirmImportN', { count: preview?.categories.length ?? 0 })}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
