import { motion } from 'framer-motion';
import { useCallback, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import type { CategoryItem } from '../../api/categories';
import { categoriesApi } from '../../api/categories';
import { modelApi } from '../../api/models';
import { dialogPanelMotion } from '../../lib/motion';
import Icon from '../shared/Icon';
import { useToast } from '../shared/Toast';
import { formatSize } from './shared';

type AnalyzedModel = {
  index: number;
  name: string;
  original_format: string;
  original_size: number;
  category_name: string | null;
  has_original: boolean;
  drawings: number;
};

type ImportResult = {
  imported: number;
  skipped: number;
  failed: number;
  details?: Array<{ name: string; reason: string }>;
};

/**
 * 模型库搬运导入弹窗（两步）：
 * 1. 上传本地站「导出模型」产出的 zip → 解析清单
 * 2. 逐个指定分类（自动匹配同名分类，可一键统一）→ 确认导入 → 结果汇总
 */
export default function ImportModelsDialog({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const { toast } = useToast();
  const [stage, setStage] = useState<'pick' | 'map' | 'result'>('pick');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [importId, setImportId] = useState('');
  const [models, setModels] = useState<AnalyzedModel[]>([]);
  const [dropped, setDropped] = useState(0);
  const [categoryByIndex, setCategoryByIndex] = useState<Map<number, string | null>>(new Map());
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: catData } = useSWR('/categories-import', () => categoriesApi.tree());
  const categories = useMemo<CategoryItem[]>(() => catData?.items || [], [catData]);

  const flatCategories = useMemo(() => {
    const list: Array<{ id: string; label: string }> = [];
    const walk = (nodes: CategoryItem[], prefix: string) => {
      for (const node of nodes) {
        list.push({ id: node.id, label: prefix ? `${prefix} / ${node.name}` : node.name });
        if (node.children?.length) walk(node.children, node.name);
      }
    };
    walk(categories, '');
    return list;
  }, [categories]);

  // 自动匹配：包内分类名 → 服务器同名分类（根级或任意层级按名称匹配）
  const autoMatchCategoryId = useCallback(
    (categoryName: string | null): string | null => {
      if (!categoryName) return null;
      const match = flatCategories.find((c) => c.label === categoryName || c.label.endsWith(` / ${categoryName}`));
      return match?.id || null;
    },
    [flatCategories],
  );

  const handleAnalyze = useCallback(async () => {
    if (!file || uploading) return;
    setUploading(true);
    setProgress(0);
    try {
      const resp = await modelApi.importModelsAnalyze(file, {
        onUploadProgress: (e) => {
          if (e.total) setProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
        },
      });
      const mapping = new Map<number, string | null>();
      for (const m of resp.models) mapping.set(m.index, autoMatchCategoryId(m.category_name));
      setImportId(resp.import_id);
      setModels(resp.models);
      setDropped(resp.dropped_no_preview);
      setCategoryByIndex(mapping);
      setStage('map');
    } catch (err) {
      toast(err instanceof Error ? err.message : '解析导入包失败', 'error');
    } finally {
      setUploading(false);
    }
  }, [autoMatchCategoryId, file, toast, uploading]);

  const handleCommit = useCallback(async () => {
    if (importing || !importId) return;
    setImporting(true);
    try {
      const resp = await modelApi.importModelsCommit(
        importId,
        models.map((m) => ({ index: m.index, categoryId: categoryByIndex.get(m.index) ?? null })),
      );
      setResult(resp);
      setStage('result');
      if (resp.imported > 0) onImported();
    } catch (err) {
      toast(err instanceof Error ? err.message : '导入失败', 'error');
    } finally {
      setImporting(false);
    }
  }, [categoryByIndex, importId, importing, models, onImported, toast]);

  const setAllCategories = (categoryId: string | null) => {
    setCategoryByIndex(new Map(models.map((m) => [m.index, categoryId])));
  };

  return (
    <div
      className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={() => !uploading && !importing && onClose()}
    >
      <motion.div
        variants={dialogPanelMotion}
        initial="initial"
        animate="animate"
        exit="exit"
        className="flex max-h-[85dvh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-outline-variant/20 bg-surface-container-low shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-outline-variant/10 px-5 py-4">
          <h3 className="font-headline text-base font-bold text-on-surface">导入模型</h3>
          <button
            type="button"
            onClick={onClose}
            disabled={uploading || importing}
            className="text-on-surface-variant hover:text-on-surface disabled:opacity-40"
            aria-label="关闭"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {stage === 'pick' && (
            <>
              <div className="rounded-sm bg-surface-container-high px-3 py-2.5 text-xs leading-relaxed text-on-surface-variant">
                <p className="mb-1 font-medium text-on-surface">操作步骤</p>
                <p>1. 在本地站「模型管理 → 全部模型」勾选模型，点「导出选中」得到 zip 包</p>
                <p>2. 在此处上传该包，导入时可为每个模型指定分类（自动匹配同名分类）</p>
              </div>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={uploading}
                className={`mt-4 flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors ${
                  file
                    ? 'border-primary/50 bg-primary-container/5'
                    : 'border-outline-variant/30 hover:border-primary/50 hover:bg-surface-container/50'
                } ${uploading ? 'pointer-events-none opacity-60' : ''}`}
              >
                <Icon
                  name={file ? 'check_circle' : 'upload_file'}
                  size={28}
                  className={file ? 'text-primary' : 'text-on-surface-variant'}
                />
                {file ? (
                  <span className="break-all text-sm font-medium text-on-surface">{file.name}</span>
                ) : (
                  <span className="text-sm text-on-surface-variant">点击选择模型导出包（zip）</span>
                )}
                <input
                  ref={inputRef}
                  type="file"
                  accept=".zip"
                  className="hidden"
                  onChange={(e) => {
                    setFile(e.target.files?.[0] || null);
                    e.target.value = '';
                  }}
                />
              </button>
              {uploading && (
                <div className="mt-3">
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-container-highest">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
                  </div>
                  <p className="mt-1 text-center text-xs text-on-surface-variant">上传解析中 {progress}%...</p>
                </div>
              )}
            </>
          )}

          {stage === 'map' && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-on-surface-variant">
                  识别到 <strong className="text-primary">{models.length}</strong> 个模型
                  {dropped > 0 && <span className="ml-1 text-error">（{dropped} 个缺预览已忽略）</span>}
                </p>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-on-surface-variant">统一归类到：</span>
                  <select
                    onChange={(e) => setAllCategories(e.target.value === '__none' ? null : e.target.value || null)}
                    value=""
                    className="max-w-[200px] rounded-sm border border-outline-variant/30 bg-surface-container-lowest px-2 py-1 text-xs text-on-surface"
                  >
                    <option value="">选择分类…</option>
                    <option value="__none">不设分类</option>
                    {flatCategories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="mt-3 max-h-[46dvh] overflow-y-auto rounded-sm border border-outline-variant/10">
                {models.map((m) => {
                  const value = categoryByIndex.get(m.index);
                  const autoMatched = value && m.category_name && autoMatchCategoryId(m.category_name) === value;
                  return (
                    <div
                      key={m.index}
                      className="flex flex-wrap items-center gap-2 border-b border-outline-variant/10 px-3 py-2.5 last:border-b-0"
                    >
                      <div className="min-w-[180px] flex-1">
                        <p className="truncate text-sm font-medium text-on-surface">{m.name}</p>
                        <p className="mt-0.5 text-[11px] text-on-surface-variant">
                          {m.original_format.toUpperCase()} · {formatSize(m.original_size)}
                          {m.drawings > 0 && ` · ${m.drawings} 张图纸`}
                          {!m.has_original && ' · 无原始文件'}
                          {m.category_name && ` · 包内分类：${m.category_name}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {autoMatched && (
                          <span className="rounded-sm bg-primary-container/20 px-1.5 py-0.5 text-[10px] text-primary">
                            已匹配
                          </span>
                        )}
                        <select
                          value={value || ''}
                          onChange={(e) =>
                            setCategoryByIndex((prev) => new Map(prev).set(m.index, e.target.value || null))
                          }
                          disabled={importing}
                          className="max-w-[220px] rounded-sm border border-outline-variant/30 bg-surface-container-lowest px-2 py-1.5 text-xs text-on-surface"
                        >
                          <option value="">不设分类</option>
                          {flatCategories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {stage === 'result' && result && (
            <div className="py-2">
              <div className="flex flex-col items-center gap-1 py-4 text-center">
                <Icon
                  name="check_circle"
                  size={48}
                  className={result.imported > 0 ? 'text-primary' : 'text-on-surface-variant/40'}
                />
                <p className="text-lg font-semibold text-on-surface">导入完成</p>
                <p className="text-sm text-on-surface-variant">
                  成功 <strong className="text-primary">{result.imported}</strong> 个
                  {result.skipped > 0 && `，跳过 ${result.skipped} 个`}
                  {result.failed > 0 && `，失败 ${result.failed} 个`}
                </p>
              </div>
              {result.details && result.details.length > 0 && (
                <div className="mt-2 max-h-[40dvh] overflow-y-auto rounded-sm bg-surface-container-high px-3 py-2">
                  {result.details.map((d, i) => (
                    <p key={i} className="py-1 text-xs text-on-surface-variant">
                      <span className="font-medium text-on-surface">{d.name}</span>：{d.reason}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-2 border-t border-outline-variant/10 px-5 py-3">
          {stage === 'pick' && (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={uploading}
                className="flex-1 rounded-sm border border-outline-variant/20 px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={!file || uploading}
                className="flex-1 rounded-sm bg-primary-container px-4 py-2 text-sm font-medium text-on-primary hover:opacity-90 disabled:opacity-50"
              >
                {uploading ? '解析中...' : '上传并解析'}
              </button>
            </>
          )}
          {stage === 'map' && (
            <>
              <button
                type="button"
                onClick={() => setStage('pick')}
                disabled={importing}
                className="flex-1 rounded-sm border border-outline-variant/20 px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface disabled:opacity-50"
              >
                重新选包
              </button>
              <button
                type="button"
                onClick={handleCommit}
                disabled={importing}
                className="flex-1 rounded-sm bg-primary-container px-4 py-2 text-sm font-medium text-on-primary hover:opacity-90 disabled:opacity-50"
              >
                {importing ? '导入中...' : `导入 ${models.length} 个模型`}
              </button>
            </>
          )}
          {stage === 'result' && (
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-sm bg-primary-container px-4 py-2 text-sm font-medium text-on-primary hover:opacity-90"
            >
              完成
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
