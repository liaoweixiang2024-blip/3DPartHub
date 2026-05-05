import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { startTransition, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import useSWR from 'swr';
import { createInquiry } from '../api/inquiries';
import {
  type ColumnDef,
  filterSelectionProducts,
  getSelectionCategories,
  getSelectionModelMatches,
  type SelectionProduct,
  type SelectionComponent,
  createSelectionShare,
} from '../api/selections';
import { AdminContentPanel, AdminManagementPage } from '../components/shared/AdminManagementPage';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import Icon from '../components/shared/Icon';
import LoginConfirmDialog from '../components/shared/LoginConfirmDialog';
import { isLoginDialogEnabled } from '../components/shared/ProtectedLink';
import SafeImage from '../components/shared/SafeImage';
import { useToast } from '../components/shared/Toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useImeSafeSearchInput } from '../hooks/useImeSafeSearchInput';
import { useMediaQuery } from '../layouts/hooks/useMediaQuery';
import { getBusinessConfig } from '../lib/businessConfig';
import { copyText } from '../lib/clipboard';
import { downloadKitList, formatKitList, getKitListTitle } from '../lib/kitList';
import { getCachedPublicSettings } from '../lib/publicSettings';
import { compareOptionValues } from '../lib/selectionSort';
import { useAuthStore } from '../stores/useAuthStore';

function sv(specs: Record<string, string>, key: string): string {
  if (specs[key]) return specs[key];
  return '—';
}

function isManualColumn(col?: ColumnDef) {
  return col?.inputType === 'manual';
}

function isPresetColumn(col?: ColumnDef) {
  return col?.inputType === 'preset';
}

function normalizeManualValue(col: ColumnDef | undefined, value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (!col?.suffix) return trimmed;
  return trimmed.toUpperCase().endsWith(col.suffix.toUpperCase()) ? trimmed : `${trimmed}${col.suffix}`;
}

function columnLabel(columns: ColumnDef[], key: string) {
  const col = columns.find((item) => item.key === key);
  return col?.label || key;
}

function replaceManualPlaceholders(
  text: string | null | undefined,
  entries: Array<readonly [string, string]>,
  columns: ColumnDef[],
) {
  if (!text) return text;
  let next = text;
  for (const [key, value] of entries) {
    const col = columns.find((item) => item.key === key);
    next = next.replaceAll(`[${key}]`, value);
    if (col?.legacyPlaceholder) next = next.replaceAll(col.legacyPlaceholder, value);
  }
  return next;
}

function displayProductName(product: SelectionProduct) {
  const rawName = product.name?.trim();
  const modelNo = product.modelNo?.trim();
  if (!rawName) return modelNo || '';
  if (!modelNo) return rawName;
  return (
    rawName
      .replace(modelNo, '')
      .replace(/[\s\-—_]+$/g, '')
      .replace(/^[\s\-—_]+/g, '')
      .trim() || rawName
  );
}

function applyManualSpecs(
  product: SelectionProduct,
  columns: ColumnDef[],
  specs: Record<string, string>,
): SelectionProduct {
  const userEntries = columns
    .filter((col) => (isManualColumn(col) || isPresetColumn(col)) && specs[col.key])
    .map((col) => {
      const raw = specs[col.key];
      const value = isManualColumn(col) ? normalizeManualValue(col, raw) : raw;
      return [col.key, value] as const;
    });

  if (!userEntries.length) return product;

  const nextSpecs = { ...(product.specs as Record<string, string>) };
  for (const [key, value] of userEntries) nextSpecs[key] = value;
  if (typeof nextSpecs['型号'] === 'string') {
    nextSpecs['型号'] = replaceManualPlaceholders(nextSpecs['型号'], userEntries, columns) || nextSpecs['型号'];
  }

  const modelNo = replaceManualPlaceholders(product.modelNo, userEntries, columns);
  const name = replaceManualPlaceholders(product.name, userEntries, columns) || product.name;

  let nextComponents = product.components;
  const outletComponents: SelectionComponent[] = [];
  for (const col of columns) {
    if (!isPresetColumn(col) || !col.dependsOn || !specs[col.key]) continue;
    const routeIndex = col.dependsOn.minIndex;
    outletComponents.push({
      name: `第${routeIndex}路出口接头`,
      modelNo: `PL${specs[col.key]}-02`,
      qty: 1,
    });
  }
  if (outletComponents.length > 0) {
    const existing = (nextComponents || []) as SelectionComponent[];
    nextComponents = [...existing, ...outletComponents];
    nextSpecs['BOM条数'] = String(nextComponents.length);
  }

  return { ...product, name, modelNo, specs: nextSpecs, components: nextComponents };
}

function formatModelCount(count: number) {
  return `${count} 个型号`;
}

function stableJson(value: unknown): string {
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(',')}}`;
}

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debouncedValue;
}

const selectionMotion =
  'transition-[transform,border-color,background-color,box-shadow,color,opacity] duration-150 ease-out motion-reduce:transition-none motion-reduce:transform-none';
const selectionPress = `${selectionMotion} active:scale-[0.985]`;

/* ── Inquiry Dialog ── */

interface ItemState {
  qty: number;
  remark: string;
}

function InquiryDialog({
  open,
  onClose,
  products,
}: {
  open: boolean;
  onClose: () => void;
  products: SelectionProduct[];
}) {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [itemStates, setItemStates] = useState<Record<string, ItemState>>({});
  const [remark, setRemark] = useState('');
  const [company, setCompany] = useState(user?.company || '');
  const [contactName, setContactName] = useState(user?.username || '');
  const [contactPhone, setContactPhone] = useState(user?.phone || '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  /* init item states when products change */
  useEffect(() => {
    setItemStates((prev) => {
      const missing: Record<string, ItemState> = {};
      products.forEach((p) => {
        if (!prev[p.id]) missing[p.id] = { qty: 1, remark: '' };
      });
      return Object.keys(missing).length ? { ...missing, ...prev } : prev;
    });
  }, [products]);

  if (!open) return null;

  const getItem = (id: string): ItemState => itemStates[id] || { qty: 1, remark: '' };
  const updateItem = (id: string, patch: Partial<ItemState>) =>
    setItemStates((prev) => ({ ...prev, [id]: { ...(prev[id] || { qty: 1, remark: '' }), ...patch } }));

  const submit = async () => {
    if (!products.length) return;
    setSubmitting(true);
    setError('');
    try {
      const r = await createInquiry({
        items: products.map((p) => ({
          productId: p.id,
          productName: p.name,
          modelNo: p.modelNo || undefined,
          qty: getItem(p.id).qty,
          remark: getItem(p.id).remark || undefined,
        })),
        remark: remark || undefined,
        company: company || undefined,
        contactName: contactName || undefined,
        contactPhone: contactPhone || undefined,
      });
      navigate(`/my-inquiries/${r.id}`);
    } catch (e: any) {
      setError(e.response?.data?.detail || '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  const specSummary = (specs: Record<string, string>) => {
    const entries = Object.entries(specs)
      .filter(([, v]) => v && v !== '—')
      .slice(0, 3);
    return entries.map(([k, v]) => `${k}:${v}`).join(' ');
  };

  return (
    <div
      className="fixed inset-0 z-[120] bg-black/40 backdrop-blur-sm p-0 md:flex md:items-center md:justify-center md:p-4"
      onClick={onClose}
    >
      <div
        className="fixed left-3 right-3 top-[max(1rem,env(safe-area-inset-top))] bottom-[max(1rem,env(safe-area-inset-bottom))] bg-surface-container-low rounded-2xl border border-outline-variant/20 shadow-2xl flex min-h-0 flex-col md:relative md:inset-auto md:w-full md:max-w-xl md:max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant/10 shrink-0">
          <h3 className="text-base font-bold text-on-surface">提交询价单</h3>
          <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface">
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
          {/* Product list with qty + remark */}
          <div>
            <p className="text-sm font-medium text-on-surface mb-2">询价产品（{products.length} 项）</p>
            <div className="space-y-2">
              {products.map((p) => {
                const st = getItem(p.id);
                const displayName = displayProductName(p);
                return (
                  <div
                    key={p.id}
                    className="rounded-lg border border-outline-variant/15 bg-surface-container-lowest px-3 py-2.5 space-y-2"
                  >
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                      <p className="text-sm text-on-surface font-medium truncate flex-1">{displayName || p.modelNo}</p>
                      {p.modelNo && p.name !== p.modelNo && (
                        <p className="text-xs text-on-surface-variant truncate max-w-[50%]">型号编号：{p.modelNo}</p>
                      )}
                    </div>
                    {p.specs && (
                      <p className="text-[11px] text-on-surface-variant/60 truncate">
                        {specSummary(p.specs as Record<string, string>)}
                      </p>
                    )}
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-on-surface-variant">数量</span>
                        <input
                          type="number"
                          min={1}
                          value={st.qty}
                          onChange={(e) => updateItem(p.id, { qty: Math.max(1, parseInt(e.target.value) || 1) })}
                          className="w-14 bg-surface-container text-on-surface text-xs rounded px-2 py-1 border border-outline-variant/15 outline-none focus:border-primary-container text-center"
                        />
                      </div>
                      <input
                        value={st.remark}
                        onChange={(e) => updateItem(p.id, { remark: e.target.value })}
                        placeholder="备注（选填）"
                        className="flex-1 bg-surface-container text-on-surface text-xs rounded px-2 py-1 border border-outline-variant/15 outline-none focus:border-primary-container"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Contact info */}
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
            <div>
              <label className="block text-xs text-on-surface-variant mb-1">公司名称</label>
              <input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                className="w-full bg-surface-container-lowest text-on-surface text-sm rounded-lg px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs text-on-surface-variant mb-1">联系人</label>
              <input
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                className="w-full bg-surface-container-lowest text-on-surface text-sm rounded-lg px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container transition-colors"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs text-on-surface-variant mb-1">联系电话</label>
              <input
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                className="w-full bg-surface-container-lowest text-on-surface text-sm rounded-lg px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container transition-colors"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-on-surface-variant mb-1">整体备注</label>
            <textarea
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              rows={2}
              placeholder="选填：交期要求、包装要求等"
              className="w-full bg-surface-container-lowest text-on-surface text-sm rounded-lg px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container resize-none transition-colors"
            />
          </div>
          {error && <p className="text-xs text-error">{error}</p>}
        </div>
        <div className="px-5 py-3 border-t border-outline-variant/10 flex gap-2 shrink-0">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 text-sm font-medium border border-outline-variant/40 text-on-surface-variant rounded-xl hover:bg-surface-container-high/50 transition-colors"
          >
            取消
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="flex-1 py-2.5 text-sm font-bold bg-primary-container text-on-primary rounded-xl hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {submitting ? '提交中...' : '提交询价'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Result Card ── */

function ResultCard({
  product,
  columns,
  kitListTitle,
  selected,
  onToggleSelect,
  onInquiry,
  expandedKits,
  onToggleKit,
  navigate,
  isMobile,
}: {
  product: SelectionProduct;
  columns: ColumnDef[];
  kitListTitle: string;
  selected: boolean;
  onToggleSelect: () => void;
  onInquiry: () => void;
  expandedKits: Set<string>;
  onToggleKit: (id: string) => void;
  navigate: ReturnType<typeof useNavigate>;
  isMobile: boolean;
}) {
  const expanded = expandedKits.has(product.id);
  const comps = (product.isKit && product.components ? product.components : []) as SelectionComponent[];
  const specCols = columns.filter((c) => !c.hideInResults);
  const catalogPdf = product.categoryCatalogPdf;
  const isCatalogImage = catalogPdf && /\.(jpe?g|png|gif|webp|svg)(\?.*)?$/i.test(catalogPdf);
  const [showCatalog, setShowCatalog] = useState(true);
  const { toast } = useToast();
  const displayName = displayProductName(product);
  const primaryTitle = product.modelNo || displayName || product.name;

  const handleCopy = async () => {
    const parts = [product.modelNo || displayName].filter(Boolean) as string[];
    if (displayName && displayName !== product.modelNo) parts.push(displayName);
    await copyText(parts.join(' '));
    toast('已复制型号和名称', 'success');
  };
  const handleCopyKitList = async () => {
    await copyText(formatKitList(product, comps, kitListTitle));
    toast(`已复制${kitListTitle}`, 'success');
  };
  const handleDownloadKitList = () => {
    downloadKitList(product, comps, kitListTitle);
    toast(`已下载${kitListTitle}`, 'success');
  };

  return (
    <div
      className={`rounded-xl md:rounded-2xl border overflow-hidden ${selectionMotion} ${selected ? 'border-primary-container/40 bg-primary-container/5 shadow-sm' : 'border-outline-variant/15 bg-surface-container-low hover:border-outline-variant/25'}`}
    >
      <div className="flex items-start gap-3 px-3 md:px-4 py-3 md:py-3.5">
        {product.image && (
          <SafeImage
            src={product.image}
            alt=""
            className="w-16 h-16 md:w-20 md:h-20 rounded-lg object-cover shrink-0 border border-outline-variant/10"
            fallbackIcon="image"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggleSelect}
              className="h-4 w-4 rounded accent-primary-container shrink-0"
            />
            <span className="font-mono text-sm md:text-base font-bold text-on-surface break-all">{primaryTitle}</span>
            <button
              onClick={handleCopy}
              aria-label="复制型号和名称"
              className={`text-on-surface-variant/50 hover:text-on-surface-variant ${selectionPress}`}
            >
              <Icon name="content_copy" size={14} />
            </button>
            {product.isKit && (
              <span className="text-[10px] md:text-xs font-medium text-primary-container bg-primary-container/10 px-1.5 md:px-2 py-0.5 rounded-full">
                套件
              </span>
            )}
          </div>
          {displayName && displayName !== primaryTitle && (
            <p className="text-xs md:text-sm text-on-surface-variant mt-0.5 truncate">{displayName}</p>
          )}
        </div>
      </div>

      <div className="px-3 md:px-4 pb-2.5 md:pb-3">
        <div
          className={`grid gap-x-3 md:gap-x-4 gap-y-0.5 md:gap-y-1 ${isMobile ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-3'}`}
        >
          {specCols.map((col) => {
            const v = sv(product.specs as Record<string, string>, col.key);
            if (v === '—') return null;
            return (
              <div key={col.key} className="text-xs md:text-sm min-w-0">
                <span className="text-on-surface-variant">{col.label}: </span>
                <span className="text-on-surface font-medium break-words">{v}</span>
              </div>
            );
          })}
        </div>
      </div>

      {product.isKit && comps.length > 0 && (
        <div className="border-t border-outline-variant/10">
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 md:px-4 py-2 md:py-2.5 text-xs md:text-sm text-on-surface-variant">
            <span>
              {kitListTitle}（{comps.length}）
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => onToggleKit(product.id)}
                className={`inline-flex items-center gap-1 rounded-md border border-outline-variant/20 px-2 py-1 hover:bg-surface-container-high/40 ${selectionPress}`}
              >
                <Icon name={expanded ? 'visibility_off' : 'visibility'} size={14} />
                <span>{expanded ? '收起清单' : '查看清单'}</span>
              </button>
              <button
                onClick={handleCopyKitList}
                className={`inline-flex items-center gap-1 rounded-md border border-outline-variant/20 px-2 py-1 hover:bg-surface-container-high/40 ${selectionPress}`}
              >
                <Icon name="content_copy" size={14} />
                <span>复制清单</span>
              </button>
              <button
                onClick={handleDownloadKitList}
                className={`inline-flex items-center gap-1 rounded-md border border-outline-variant/20 px-2 py-1 hover:bg-surface-container-high/40 ${selectionPress}`}
              >
                <Icon name="download" size={14} />
                <span>下载清单</span>
              </button>
            </div>
          </div>
          {expanded && (
            <div className="px-3 md:px-4 pb-3">
              <div className="overflow-x-auto rounded-lg border border-outline-variant/10">
                <table className="min-w-full text-xs md:text-sm">
                  <thead className="bg-surface-container-high text-on-surface-variant">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium whitespace-nowrap">#</th>
                      <th className="px-2 py-1.5 text-left font-medium whitespace-nowrap">名称</th>
                      <th className="px-2 py-1.5 text-left font-medium whitespace-nowrap">型号</th>
                      <th className="px-2 py-1.5 text-right font-medium whitespace-nowrap">数量</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comps.map((c, i) => (
                      <tr key={i} className="border-t border-outline-variant/10">
                        <td className="px-2 py-1.5 text-on-surface-variant whitespace-nowrap">{i + 1}</td>
                        <td className="px-2 py-1.5 text-on-surface whitespace-nowrap">{c.name}</td>
                        <td className="px-2 py-1.5 text-on-surface-variant whitespace-nowrap">{c.modelNo || '—'}</td>
                        <td className="px-2 py-1.5 text-right text-on-surface whitespace-nowrap">{c.qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {catalogPdf && (
        <div className="border-t border-outline-variant/10">
          <button
            onClick={() => setShowCatalog((v) => !v)}
            className={`w-full px-3 md:px-4 py-1.5 flex items-center justify-between text-xs text-on-surface-variant hover:bg-surface-container-high/30 ${selectionPress}`}
          >
            <span className="flex items-center gap-1">
              <Icon name="menu_book" size={14} />
              画册资料
            </span>
            <Icon name={showCatalog ? 'expand_less' : 'expand_more'} size={16} />
          </button>
          {showCatalog && (
            <div className="px-3 md:px-4 pb-3">
              {isCatalogImage ? (
                <img
                  src={catalogPdf}
                  alt="画册"
                  className="max-h-80 rounded border border-outline-variant/10 object-contain"
                />
              ) : (
                <iframe
                  src={catalogPdf}
                  className="w-full h-80 rounded border border-outline-variant/10"
                  title="画册 PDF"
                />
              )}
            </div>
          )}
        </div>
      )}

      <div className="border-t border-outline-variant/10 px-3 md:px-4 py-2 md:py-2.5 flex items-center gap-1.5 md:gap-2 flex-wrap">
        <button
          onClick={onInquiry}
          className={`px-2.5 md:px-3 py-1 md:py-1.5 text-xs md:text-sm font-bold bg-primary-container text-on-primary rounded-lg hover:opacity-90 ${selectionPress}`}
        >
          询价
        </button>
        {product.categoryCatalogPdf && (
          <a
            href={product.categoryCatalogPdf}
            target="_blank"
            rel="noopener"
            className={`px-2.5 md:px-3 py-1 md:py-1.5 text-xs md:text-sm font-medium border border-outline-variant/30 text-on-surface-variant rounded-lg hover:bg-surface-container-high/50 inline-flex items-center gap-1 ${selectionPress}`}
          >
            <Icon name="menu_book" size={14} />
            <span>画册</span>
          </a>
        )}
        {product.pdfUrl && (
          <a
            href={product.pdfUrl}
            target="_blank"
            rel="noopener"
            className={`px-2.5 md:px-3 py-1 md:py-1.5 text-xs md:text-sm font-medium border border-outline-variant/30 text-on-surface-variant rounded-lg hover:bg-surface-container-high/50 inline-flex items-center gap-1 ${selectionPress}`}
          >
            <Icon name="library_books" size={14} />
            <span>规格书</span>
          </a>
        )}
        {product.matchedModelId ? (
          <a
            href={`/model/${product.matchedModelId}`}
            target="_blank"
            rel="noopener"
            className={`px-2.5 md:px-3 py-1 md:py-1.5 text-xs md:text-sm font-medium border border-outline-variant/30 text-on-surface-variant rounded-lg hover:bg-surface-container-high/50 inline-flex items-center gap-1 ${selectionPress}`}
          >
            <Icon name="view_in_ar" size={14} />
            <span>模型</span>
          </a>
        ) : null}
        <button
          onClick={() =>
            navigate(`/support`, {
              state: { modelNo: product.modelNo || product.name, specs: product.specs, source: 'selection' as const },
            })
          }
          className={`px-2.5 md:px-3 py-1 md:py-1.5 text-xs md:text-sm font-medium border border-outline-variant/30 text-on-surface-variant rounded-lg hover:bg-surface-container-high/50 inline-flex items-center gap-1 ${selectionPress}`}
        >
          <Icon name="support_agent" size={14} />
          <span>技术支持</span>
        </button>
      </div>
    </div>
  );
}

/* ══════════════ Main Page ══════════════ */

export default function SelectionPage() {
  const { data: settingsData } = useSWR('publicSettings', () => getCachedPublicSettings());
  const business = getBusinessConfig(settingsData);
  const pageTitle = (settingsData?.selection_page_title as string) || '产品选型';
  const pageDesc = (settingsData?.selection_page_desc as string) || '先选产品大类，再按参数逐步缩小范围';
  useDocumentTitle(pageTitle);
  const isCategoryTablet = useMediaQuery('(min-width: 640px)');
  const isCategoryWide = useMediaQuery('(min-width: 1280px)');
  const isCategoryUltraWide = useMediaQuery('(min-width: 1536px)');
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const prefersReducedMotion = useReducedMotion();
  const navigate = useNavigate();
  const location = useLocation();
  const previewCategoryImages = useMemo(
    () => new URLSearchParams(location.search).get('previewImages') === '1',
    [location.search],
  );
  const { user } = useAuthStore();
  const { toast } = useToast();
  const [inquiryOpen, setInquiryOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedKits, setExpandedKits] = useState<Set<string>>(new Set());

  /* wizard state */
  const [groupId, setGroupId] = useState<string | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const [specs, setSpecs] = useState<Record<string, string>>({});
  const [manualDrafts, setManualDrafts] = useState<Record<string, string>>({});
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [autoSelectedFields, setAutoSelectedFields] = useState<Set<string>>(new Set());
  const {
    value: searchDraft,
    draftValue: searchDraftInputValue,
    setValue: setSearchDraft,
    inputProps: searchDraftInputProps,
  } = useImeSafeSearchInput();
  const search = useDebouncedValue(searchDraft.trim(), 250);
  const [pressedCategoryKey, setPressedCategoryKey] = useState<string | null>(null);

  /* recently viewed subcategories (localStorage) */
  const RECENT_KEY = 'selection:recent';
  const [, setRecentSlugs] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').slice(0, 6);
    } catch {
      return [];
    }
  });
  function pushRecent(slug: string) {
    setRecentSlugs((prev) => {
      const next = [slug, ...prev.filter((s) => s !== slug)].slice(0, 6);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        return next;
      }
      return next;
    });
  }

  /* data */
  const {
    data: cats = [],
    error: categoriesError,
    isLoading: categoriesLoading,
    mutate: retryCategories,
  } = useSWR('selections/categories', getSelectionCategories);

  /* pre-fill from share link state or URL params */
  const shareStateRef = useRef<{ shareSlug?: string; shareSpecs?: Record<string, string> } | null>(null);
  if (!shareStateRef.current) {
    const state = location.state as { shareSlug?: string; shareSpecs?: Record<string, string> } | null;
    if (state?.shareSlug) shareStateRef.current = state;
  }

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const g = params.get('g');
    if (g && !groupId) {
      setGroupId(g);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply share slug/specs once cats are loaded
  useEffect(() => {
    const share = shareStateRef.current;
    if (!share?.shareSlug || !cats.length || slug) return;
    setSlug(share.shareSlug);
    if (share.shareSpecs) {
      setSpecs(share.shareSpecs);
      setAutoSelectedFields(new Set());
    }
    const match = cats.find((c) => c.slug === share.shareSlug);
    if (match?.groupId) setGroupId(match.groupId);
    shareStateRef.current = null;
    window.history.replaceState({}, '');
  }, [cats, slug]);

  /* derive groups and standalone categories from API categories */
  interface DerivedGroup {
    id: string;
    name: string;
    icon: string;
    image: string | null;
    sortOrder: number;
    children: { slug: string; name: string; icon: string }[];
  }
  const groups = useMemo<DerivedGroup[]>(() => {
    const map = new Map<string, DerivedGroup>();
    for (const c of cats) {
      if (!c.groupId || !c.groupName) continue;
      if (!map.has(c.groupId)) {
        map.set(c.groupId, {
          id: c.groupId,
          name: c.groupName,
          icon: c.groupIcon || 'category',
          image: c.groupImage || null,
          sortOrder: c.sortOrder,
          children: [],
        });
      } else if (!map.get(c.groupId)!.image && c.groupImage) {
        map.get(c.groupId)!.image = c.groupImage;
      }
      map.get(c.groupId)!.sortOrder = Math.min(map.get(c.groupId)!.sortOrder, c.sortOrder);
      map.get(c.groupId)!.children.push({ slug: c.slug, name: c.name, icon: c.icon || 'category' });
    }
    return Array.from(map.values()).sort((a, b) => a.sortOrder - b.sortOrder);
  }, [cats]);

  // Standalone categories without a group
  const standaloneCats = useMemo(() => cats.filter((c) => !c.groupId || !c.groupName), [cats]);
  const catBySlug = useMemo(() => new Map(cats.map((c) => [c.slug, c])), [cats]);

  const group = useMemo(() => groups.find((g) => g.id === groupId) ?? null, [groups, groupId]);

  const liveCat = slug ? (cats.find((c) => c.slug === slug) ?? null) : null;
  const fields = useMemo(() => {
    if (liveCat?.columns?.length) {
      return liveCat.columns.filter((col) => !col.displayOnly).map((col) => col.key);
    }
    return [];
  }, [liveCat]);

  const columns = useMemo(() => {
    if (liveCat?.columns?.length) return liveCat.columns;
    return [];
  }, [liveCat]);

  const manualFields = useMemo(
    () => new Set(columns.filter((col) => isManualColumn(col) || isPresetColumn(col)).map((col) => col.key)),
    [columns],
  );
  const specKeys = useMemo(() => fields.filter((f) => specs[f]), [fields, specs]);

  const curField = useMemo(() => {
    for (const f of fields) {
      if (specs[f]) continue;
      if (skipped.has(f)) continue;
      return f;
    }
    return null;
  }, [fields, specs, skipped]);

  const phase: 'group' | 'sub' | 'wizard' = !groupId ? 'group' : !slug ? 'sub' : 'wizard';
  const resultBatchSize = isDesktop ? 80 : 40;
  const filterSpecKey = useMemo(
    () =>
      fields
        .filter((field) => specs[field])
        .map((field) => `${field}=${specs[field]}`)
        .join('|'),
    [fields, specs],
  );
  const skippedKey = useMemo(() => Array.from(skipped).sort().join('|'), [skipped]);
  const filterField = search ? null : curField;
  const includeFilterItems = Boolean(search || !curField);
  const filterAutoAdvance = Boolean(!search && curField);
  const filterResetKey = `${slug || ''}:${search}:${filterSpecKey}:${skippedKey}:${filterField || ''}`;
  const [resultPageSize, setResultPageSize] = useState(resultBatchSize);
  const suppressAutoAdvanceScrollRef = useRef(false);
  const pendingAutoAdvanceScrollRef = useRef(false);

  useEffect(() => {
    setResultPageSize(resultBatchSize);
  }, [filterResetKey, resultBatchSize]);

  const {
    data: filterData,
    isLoading,
    error: filterError,
    mutate: retryFilter,
  } = useSWR(
    liveCat
      ? [
          'sel-filter',
          liveCat.slug,
          filterSpecKey,
          skippedKey,
          filterField || '',
          search,
          includeFilterItems,
          filterAutoAdvance,
          resultPageSize,
        ]
      : null,
    () =>
      filterSelectionProducts(liveCat!.slug, {
        specs,
        field: filterField,
        search,
        skipped: Array.from(skipped),
        autoAdvance: filterAutoAdvance,
        page: 1,
        pageSize: resultPageSize,
        includeItems: includeFilterItems,
      }),
    { revalidateOnFocus: false },
  );
  const [showFilterLoading, setShowFilterLoading] = useState(false);
  const shouldShowFilterLoading = Boolean(showFilterLoading || (isLoading && !filterData));
  useEffect(() => {
    if (!isLoading) {
      setShowFilterLoading(false);
      return;
    }
    const timer = setTimeout(() => setShowFilterLoading(true), 180);
    return () => clearTimeout(timer);
  }, [isLoading]);

  useEffect(() => {
    if (!filterData?.autoAdvanced?.length) return;
    const nextSpecs = filterData.resolvedSpecs ?? specs;
    const nextSkipped = new Set(filterData.resolvedSkipped ?? []);
    const specsChanged = stableJson(nextSpecs) !== stableJson(specs);
    const skippedChanged = stableJson(Array.from(nextSkipped).sort()) !== stableJson(Array.from(skipped).sort());
    if (!specsChanged && !skippedChanged) return;
    suppressAutoAdvanceScrollRef.current = true;
    pendingAutoAdvanceScrollRef.current = true;
    startTransition(() => {
      if (specsChanged) setSpecs(nextSpecs);
      if (skippedChanged) setSkipped(nextSkipped);
      setAutoSelectedFields((prev) => {
        const next = new Set(prev);
        for (const item of filterData.autoAdvanced ?? []) {
          if (item.reason === 'single' && item.field) next.add(item.field);
        }
        for (const field of Object.keys(nextSpecs)) {
          if (!nextSpecs[field]) next.delete(field);
        }
        return next;
      });
    });
  }, [filterData?.autoAdvanced, filterData?.resolvedSpecs, filterData?.resolvedSkipped, specs, skipped]);

  const filtered = useMemo(() => filterData?.items ?? [], [filterData?.items]);
  const filteredTotal = filterData?.total ?? 0;
  const categoryProductCount = liveCat?.productCount ?? 0;

  const options = useMemo(() => {
    if (!curField) return [];
    if (manualFields.has(curField)) return [];
    const entries = (filterData?.options ?? []).map(({ val, count }) => [val, count] as const);
    // Get sortType from column definition
    const colDef = columns.find((c) => c.key === curField);
    const sortType = colDef?.sortType;
    // Use custom optionOrder if defined
    const savedOrderRaw = (liveCat?.optionOrder as Record<string, string[] | string>)?.[curField];
    const savedOrder = Array.isArray(savedOrderRaw) ? savedOrderRaw : [];
    if (savedOrder && savedOrder.length > 0) {
      const orderMap = new Map(savedOrder.map((v, i) => [v, i]));
      entries.sort((a, b) => {
        const ia = orderMap.get(a[0]) ?? Infinity;
        const ib = orderMap.get(b[0]) ?? Infinity;
        if (ia !== ib) return ia - ib;
        return compareOptionValues(sortType, a[0], b[0], business.threadPriority);
      });
    } else {
      entries.sort((a, b) => compareOptionValues(sortType, a[0], b[0], business.threadPriority));
    }
    return entries.map(([val, count]) => ({ val, count }));
  }, [filterData?.options, curField, liveCat?.optionOrder, columns, manualFields, business.threadPriority]);

  const visibleFiltered = filtered;
  const remainingResultCount = Math.max(filteredTotal - visibleFiltered.length, 0);
  const hasMoreResults = remainingResultCount > 0;
  const loadMoreResults = useCallback(() => {
    setResultPageSize((count) => Math.min(count + resultBatchSize, filteredTotal || count + resultBatchSize));
  }, [filteredTotal, resultBatchSize]);
  const visibleModelNos = useMemo(
    () => Array.from(new Set(visibleFiltered.map((p) => p.modelNo).filter(Boolean) as string[])),
    [visibleFiltered],
  );
  const shouldLoadModelMatches = Boolean(search || !curField);
  const { data: modelMatchMap = {} } = useSWR(
    shouldLoadModelMatches && visibleModelNos.length ? ['sel-model-matches', visibleModelNos.join('|')] : null,
    () => getSelectionModelMatches(visibleModelNos),
    { revalidateOnFocus: false },
  );
  const withVisibleMatch = useCallback(
    (product: SelectionProduct) => {
      const matched = product.modelNo ? modelMatchMap[product.modelNo] : undefined;
      if (!matched) return product;
      return { ...product, matchedModelId: matched.id, matchedModelThumbnail: matched.thumbnailUrl };
    },
    [modelMatchMap],
  );
  const selectedProds = filtered.filter((p) => selectedIds.has(p.id)).map((p) => applyManualSpecs(p, columns, specs));

  /* auto-scroll ref */
  const curStepRef = useRef<HTMLDivElement>(null);
  const wizardWrapRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const mobileMainRef = useRef<HTMLElement>(null);
  const lastUserScrollAtRef = useRef(0);
  const resultRevealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* track user-initiated undo to suppress immediate auto-skip */
  const userUndoRef = useRef(false);

  /* auto-skip preset columns whose dependsOn condition is not met */
  useEffect(() => {
    if (!curField) return;
    const colDef = columns.find((c) => c.key === curField);
    if (!colDef?.dependsOn) return;
    const countValue = Number(specs[colDef.dependsOn.field]) || 0;
    if (countValue >= colDef.dependsOn.minIndex) return;
    startTransition(() => {
      setSkipped((p) => new Set(p).add(curField));
    });
  }, [curField, columns, specs]);

  /* auto-skip: single-value params get auto-selected; zero-option params get skipped */
  useEffect(() => {
    if (filterAutoAdvance) return;
    if (isLoading || search || !curField) return;
    if (manualFields.has(curField)) return;
    const colDef = columns.find((c) => c.key === curField);
    if (options.length === 0 && filteredTotal > 0 && colDef?.required !== true) {
      // Some product rows do not have every column. Skip empty columns instead of trapping users on a dead step.
      suppressAutoAdvanceScrollRef.current = true;
      pendingAutoAdvanceScrollRef.current = true;
      startTransition(() => {
        setSkipped((p) => new Set(p).add(curField));
      });
      return;
    }
    if (userUndoRef.current) {
      // After user manually undoes, suppress auto-select for one cycle so they can re-choose
      userUndoRef.current = false;
      return;
    }
    if (options.length === 1 && colDef?.autoSelectSingle !== false) {
      suppressAutoAdvanceScrollRef.current = true;
      pendingAutoAdvanceScrollRef.current = true;
      startTransition(() => {
        setSpecs((p) => ({ ...p, [curField]: options[0].val }));
        setAutoSelectedFields((p) => new Set(p).add(curField));
      });
    }
  }, [curField, options, search, isLoading, filteredTotal, manualFields, columns, filterAutoAdvance]);

  useEffect(() => {
    if (!filterAutoAdvance) return;
    if (isLoading || search || !curField) return;
    if (manualFields.has(curField)) return;
    const colDef = columns.find((c) => c.key === curField);
    if (options.length === 1 && colDef?.autoSelectSingle !== false) {
      suppressAutoAdvanceScrollRef.current = true;
      pendingAutoAdvanceScrollRef.current = true;
      startTransition(() => {
        setSpecs((p) => ({ ...p, [curField]: options[0].val }));
        setAutoSelectedFields((p) => new Set(p).add(curField));
      });
      return;
    }
    if (colDef?.required === true) return;
    if (options.length > 0 || filteredTotal <= 0) return;
    suppressAutoAdvanceScrollRef.current = true;
    pendingAutoAdvanceScrollRef.current = true;
    startTransition(() => {
      setSkipped((p) => new Set(p).add(curField));
    });
  }, [columns, curField, filterAutoAdvance, filteredTotal, isLoading, manualFields, options, search]);

  /* auto-scroll to current step — desktop uses container.scrollTo to avoid sidebar shift */
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (search) return;
    if (!curField) return;
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    if (suppressAutoAdvanceScrollRef.current) {
      suppressAutoAdvanceScrollRef.current = false;
      return;
    }
    scrollTimerRef.current = setTimeout(() => {
      const el = curStepRef.current;
      if (!el) return;
      if (isDesktop) {
        const container = scrollContainerRef.current;
        if (!container) return;
        const cRect = container.getBoundingClientRect();
        const eRect = el.getBoundingClientRect();
        const target = eRect.top - cRect.top + container.scrollTop - cRect.height / 2 + eRect.height / 2;
        container.scrollTo({ top: target, behavior: 'smooth' });
      } else {
        wizardWrapRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
      }
    }, 200);
    return () => {
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    };
  }, [curField, search, isDesktop]);

  const autoAdvanceScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!pendingAutoAdvanceScrollRef.current || search || phase !== 'wizard' || isLoading) return;
    if (!curField) {
      pendingAutoAdvanceScrollRef.current = false;
      return;
    }

    const colDef = curField ? columns.find((c) => c.key === curField) : undefined;
    const isManual = curField ? manualFields.has(curField) : false;
    const willAutoConfirm = Boolean(
      curField && !isManual && options.length === 1 && colDef?.autoSelectSingle !== false,
    );
    const willAutoSkip = Boolean(
      curField && !isManual && options.length === 0 && filteredTotal > 0 && colDef?.required !== true,
    );
    if (willAutoConfirm || willAutoSkip) return;

    if (autoAdvanceScrollTimerRef.current) clearTimeout(autoAdvanceScrollTimerRef.current);
    autoAdvanceScrollTimerRef.current = setTimeout(() => {
      const el = curStepRef.current;
      if (!el) return;

      if (isDesktop) {
        const container = scrollContainerRef.current;
        if (!container) return;
        const cRect = container.getBoundingClientRect();
        const eRect = el.getBoundingClientRect();
        const target = eRect.top - cRect.top + container.scrollTop - cRect.height / 2 + eRect.height / 2;
        container.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
      } else {
        wizardWrapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      pendingAutoAdvanceScrollRef.current = false;
    }, 140);

    return () => {
      if (autoAdvanceScrollTimerRef.current) clearTimeout(autoAdvanceScrollTimerRef.current);
    };
  }, [columns, curField, filteredTotal, isDesktop, isLoading, manualFields, options.length, phase, search]);

  useEffect(() => {
    const markUserScroll = () => {
      lastUserScrollAtRef.current = Date.now();
    };
    window.addEventListener('wheel', markUserScroll, { passive: true });
    window.addEventListener('touchstart', markUserScroll, { passive: true });
    return () => {
      window.removeEventListener('wheel', markUserScroll);
      window.removeEventListener('touchstart', markUserScroll);
    };
  }, []);

  useEffect(() => {
    if (search || curField || phase !== 'wizard' || isLoading || filteredTotal <= 0) return;
    if (resultRevealTimerRef.current) clearTimeout(resultRevealTimerRef.current);
    resultRevealTimerRef.current = setTimeout(() => {
      if (Date.now() - lastUserScrollAtRef.current < 260) return;
      const el = resultRef.current;
      if (!el) return;

      if (isDesktop) {
        const container = scrollContainerRef.current;
        if (!container) return;
        const cRect = container.getBoundingClientRect();
        const eRect = el.getBoundingClientRect();
        const target = eRect.top - cRect.top + container.scrollTop - 18;
        container.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
      } else {
        wizardWrapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 120);

    return () => {
      if (resultRevealTimerRef.current) clearTimeout(resultRevealTimerRef.current);
    };
  }, [curField, filteredTotal, filterSpecKey, isDesktop, isLoading, phase, search, skippedKey]);

  /* handlers */
  const pickGroup = useCallback(
    (id: string) => {
      setPressedCategoryKey(`group:${id}`);
      setGroupId(id);
      setSlug(null);
      setSpecs({});
      setManualDrafts({});
      setSkipped(new Set());
      setAutoSelectedFields(new Set());
      setSearchDraft('');
      setSelectedIds(new Set());
      setExpandedKits(new Set());
      window.setTimeout(() => setPressedCategoryKey(null), 260);
    },
    [setSearchDraft],
  );
  const pickSub = useCallback(
    (s: string) => {
      setPressedCategoryKey(`sub:${s}`);
      suppressAutoAdvanceScrollRef.current = true;
      pendingAutoAdvanceScrollRef.current = false;
      pushRecent(s);
      setSlug(s);
      setSpecs({});
      setManualDrafts({});
      setSkipped(new Set());
      setAutoSelectedFields(new Set());
      setSearchDraft('');
      setSelectedIds(new Set());
      setExpandedKits(new Set());
      window.setTimeout(() => setPressedCategoryKey(null), 260);
    },
    [setSearchDraft],
  );
  const pickVal = useCallback((key: string, val: string) => {
    setAutoSelectedFields((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setSpecs((p) => ({ ...p, [key]: val }));
  }, []);
  const dropVal = useCallback(
    (key: string) => {
      userUndoRef.current = true;
      setSpecs((prev) => {
        const keys = Object.keys(prev);
        const i = keys.indexOf(key);
        const next: Record<string, string> = {};
        for (let j = 0; j < i; j++) next[keys[j]] = prev[keys[j]];
        return next;
      });
      setAutoSelectedFields((prev) => {
        const next = new Set<string>();
        const keys = Object.keys(specs);
        const i = keys.indexOf(key);
        for (let j = 0; j < i; j++) {
          if (prev.has(keys[j])) next.add(keys[j]);
        }
        return next;
      });
      setSkipped(new Set());
      setSearchDraft('');
    },
    [specs, setSearchDraft],
  );
  const goHome = useCallback(() => {
    startTransition(() => {
      setGroupId(null);
      setSlug(null);
      setSpecs({});
      setManualDrafts({});
      setSkipped(new Set());
      setAutoSelectedFields(new Set());
      setSearchDraft('');
      setSelectedIds(new Set());
      setExpandedKits(new Set());
    });
  }, [setSearchDraft]);
  const restart = useCallback(() => {
    startTransition(() => {
      setSpecs({});
      setManualDrafts({});
      setSkipped(new Set());
      setAutoSelectedFields(new Set());
      setSearchDraft('');
      setSelectedIds(new Set());
      setExpandedKits(new Set());
    });
  }, [setSearchDraft]);
  const toggleSel = useCallback(
    (id: string) =>
      setSelectedIds((p) => {
        const n = new Set(p);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      }),
    [],
  );
  const toggleKit = useCallback(
    (id: string) =>
      setExpandedKits((p) => {
        const n = new Set(p);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      }),
    [],
  );

  /* ── share handler ── */
  const [sharing, setSharing] = useState(false);

  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [loginDialogReason, setLoginDialogReason] = useState('');

  function requireLogin(reason: string) {
    if (isLoginDialogEnabled()) {
      setLoginDialogReason(reason);
      setLoginDialogOpen(true);
    } else {
      navigate('/login', { state: { from: location.pathname } });
    }
  }

  async function handleShare(withResults = false) {
    if (!slug) return;
    if (!user) {
      requireLogin('分享选型');
      return;
    }
    setSharing(true);
    try {
      const productIds =
        withResults && filteredTotal > 0
          ? (
              await filterSelectionProducts(slug, {
                specs,
                field: null,
                search,
                page: 1,
                pageSize: filteredTotal,
                includeItems: true,
              })
            ).items.map((p) => p.id)
          : [];
      const payload = {
        categorySlug: slug,
        specs: withResults ? specs : {},
        productIds,
      };
      const result = await createSelectionShare(payload);
      const url = `${window.location.origin}/selection/s/${result.token}`;
      await copyText(url);
      toast('分享链接已复制到剪贴板', 'success');
    } catch (err: any) {
      if (import.meta.env.DEV)
        console.error('[Share] Error:', err?.response?.status, err?.response?.data, err?.message);
      toast(`分享失败: ${err?.response?.data?.message || err?.message || '未知错误'}`, 'error');
    } finally {
      setSharing(false);
    }
  }

  const totalProductCount = useMemo(() => cats.reduce((sum, c) => sum + (c.productCount ?? 0), 0), [cats]);
  const previewImages = [
    "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 120'%3E%3Crect width='160' height='120' rx='18' fill='%23F4F2EF'/%3E%3Cg transform='translate(34 26)' fill='none' stroke='%23D97706' stroke-width='8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M28 20h52'/%3E%3Cpath d='M80 20v44'/%3E%3Cpath d='M28 20v44'/%3E%3Cpath d='M16 64h24'/%3E%3Cpath d='M68 64h24'/%3E%3Cpath d='M44 12h20'/%3E%3C/g%3E%3C/svg%3E",
    "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 120'%3E%3Crect width='160' height='120' rx='18' fill='%23F4F2EF'/%3E%3Cg transform='translate(28 28)' fill='none' stroke='%23D97706' stroke-width='8' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='52' cy='34' r='24'/%3E%3Cpath d='M10 34h18'/%3E%3Cpath d='M76 34h18'/%3E%3Cpath d='M52 10V0'/%3E%3Cpath d='M36 0h32'/%3E%3Cpath d='M40 34h24'/%3E%3C/g%3E%3C/svg%3E",
    "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 120'%3E%3Crect width='160' height='120' rx='18' fill='%23F4F2EF'/%3E%3Cg transform='translate(30 22)' fill='none' stroke='%23D97706' stroke-width='8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M16 70C42 18 70 18 96 70'/%3E%3Cpath d='M16 70h24'/%3E%3Cpath d='M72 70h24'/%3E%3Cpath d='M51 20v28'/%3E%3Cpath d='M39 34h24'/%3E%3C/g%3E%3C/svg%3E",
  ];

  const categoryPreviewImage = (seed: string) => {
    let hash = 0;
    for (const ch of seed) hash = (hash + ch.charCodeAt(0)) % previewImages.length;
    return previewImages[hash];
  };

  const categoryMedia = (image: string | null | undefined, icon: string | null | undefined, previewSeed: string) => {
    const mediaImage = image || (previewCategoryImages ? categoryPreviewImage(previewSeed) : '');
    const fallbackIcon = icon || 'inventory_2';

    if (!mediaImage) {
      return (
        <span className="flex aspect-[2/1] w-28 shrink-0 items-center justify-center bg-surface-container-low text-primary-container/40 md:w-44">
          <Icon name={fallbackIcon} size={32} />
        </span>
      );
    }

    return (
      <span className="aspect-[2/1] w-28 shrink-0 overflow-hidden md:w-44">
        <SafeImage
          src={mediaImage}
          alt=""
          className="h-full w-full object-cover"
          fallbackClassName="bg-surface-container-high"
          fallbackIcon={fallbackIcon}
        />
      </span>
    );
  };

  /* Page chrome is provided by AdminManagementPage so this page follows the same shell as admin/user list pages. */
  const pageHeader = null;

  /* ── group selection ── */
  const categoryStatsUnavailable = (categoriesLoading || categoriesError) && cats.length === 0;
  const categoryGroupCountText = categoryStatsUnavailable ? '—' : groups.length + standaloneCats.length;
  const categoryCountText = categoryStatsUnavailable ? '—' : cats.length;
  const totalProductCountText = categoryStatsUnavailable ? '—' : totalProductCount;
  const selectionStatItems = [
    { label: '产品分类', value: categoryCountText, icon: 'account_tree' },
    { label: '型号', value: totalProductCountText, icon: 'inventory_2' },
  ];
  const topCategoryItems = useMemo(() => {
    const groupItems = groups.map((g) => {
      const groupImage = g.image || g.children.map((child) => catBySlug.get(child.slug)?.image).find(Boolean) || null;
      return {
        key: `group:${g.id}`,
        type: 'group' as const,
        sortOrder: g.sortOrder,
        active: pressedCategoryKey === `group:${g.id}`,
        image: groupImage,
        icon: g.icon,
        name: g.name,
        description: `${g.children.length} 个分类`,
        previewSeed: g.id,
        onClick: () => pickGroup(g.id),
      };
    });
    const categoryItems = standaloneCats.map((c) => ({
      key: `cat:${c.id}`,
      type: 'category' as const,
      sortOrder: c.sortOrder,
      active: pressedCategoryKey === `sub:${c.slug}`,
      image: c.image,
      icon: c.icon,
      name: c.name,
      description: formatModelCount(c.productCount ?? 0),
      previewSeed: c.slug,
      onClick: () => pickSub(c.slug),
    }));
    return [...groupItems, ...categoryItems].sort((a, b) => a.sortOrder - b.sortOrder);
  }, [catBySlug, groups, pickGroup, pickSub, pressedCategoryKey, standaloneCats]);
  const subCategoryItems = useMemo(() => {
    if (!group) return [];
    return group.children
      .map((ch, index) => {
        const childCat = catBySlug.get(ch.slug);
        return {
          key: `sub:${ch.slug}`,
          type: 'category' as const,
          sortOrder: childCat?.sortOrder ?? index,
          active: pressedCategoryKey === `sub:${ch.slug}`,
          image: childCat?.image,
          icon: childCat?.icon || ch.icon,
          name: childCat?.name || ch.name,
          description: childCat ? formatModelCount(childCat.productCount ?? 0) : '待配置型号',
          previewSeed: ch.slug,
          onClick: () => pickSub(ch.slug),
        };
      })
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [catBySlug, group, pickSub, pressedCategoryKey]);
  const categoryColumns = isCategoryUltraWide ? 4 : isCategoryWide ? 3 : isCategoryTablet ? 2 : 1;
  const categoryPanelClass = 'p-3 md:p-4';
  const categoryGridClass =
    'mx-auto grid w-full max-w-[1800px] grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4';
  const categoryCardClass = (active: boolean) =>
    `group flex w-full items-stretch rounded-lg border text-left ${selectionMotion} active:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-container/60 overflow-hidden ${
      active
        ? 'border-primary-container/45 bg-primary-container/8 shadow-[0_8px_20px_rgba(249,115,22,0.12)]'
        : 'border-outline-variant/12 bg-surface-container/50 shadow-[0_1px_2px_rgba(15,23,42,0.04)] group-hover:border-primary-container/28 group-hover:bg-surface-container/80'
    }`;
  const categoryTitleClass = 'block truncate text-sm font-semibold leading-5 text-on-surface md:text-base';
  const categoryDescriptionClass = 'mt-0.5 block truncate text-xs leading-4 text-on-surface-variant';
  type CategoryRenderItem = (typeof topCategoryItems)[number];
  const categoryItemMotionProps = (index: number) =>
    prefersReducedMotion
      ? { initial: false as const }
      : {
          initial: { opacity: 0, y: 8 },
          whileInView: { opacity: 1, y: 0, scale: 1 },
          viewport: { once: true, amount: 0.25, margin: '-12px 0px -12px 0px' },
          transition: {
            duration: 0.16,
            delay: Math.min((index % categoryColumns) * 0.015, 0.045),
            ease: 'easeOut' as const,
          },
        };
  const renderCategoryItem = (
    {
      key,
      active,
      image,
      icon,
      name,
      description,
      previewSeed,
      onClick,
    }: {
      key: string;
      active: boolean;
      image?: string | null;
      icon?: string | null;
      name: string;
      description?: string | null;
      previewSeed: string;
      onClick: () => void;
    },
    index: number,
  ) => (
    <motion.button
      key={key}
      onClick={onClick}
      className={categoryCardClass(active)}
      whileHover={prefersReducedMotion ? undefined : { y: -1 }}
      whileTap={prefersReducedMotion ? undefined : { scale: 0.985 }}
      {...categoryItemMotionProps(index)}
    >
      {categoryMedia(image, icon, previewSeed)}
      <div className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 md:px-3.5">
        <div className="min-w-0 flex-1">
          <strong className={categoryTitleClass}>{name}</strong>
          {description ? <small className={categoryDescriptionClass}>{description}</small> : null}
        </div>
        <Icon
          name={active ? 'check' : 'chevron_right'}
          size={17}
          className="shrink-0 text-on-surface-variant/45 transition-colors group-hover:text-primary-container"
        />
      </div>
    </motion.button>
  );
  const renderCategoryGrid = (items: CategoryRenderItem[]) => (
    <div className={categoryGridClass}>{items.map((item, index) => renderCategoryItem(item, index))}</div>
  );
  const categoryStatusContent =
    categoriesLoading && cats.length === 0 ? (
      <div className="flex items-center justify-center py-12">
        <Icon name="progress_activity" size={24} className="animate-spin text-on-surface-variant/30" />
        <span className="ml-3 text-sm text-on-surface-variant">正在加载分类...</span>
      </div>
    ) : categoriesError && cats.length === 0 ? (
      <div className="text-center py-12">
        <Icon name="error" size={36} className="mx-auto mb-2 text-error/45" />
        <p className="text-sm font-medium text-on-surface">分类加载失败</p>
        <p className="mt-1 text-xs text-on-surface-variant">请稍后重试，或检查服务是否被限流</p>
        <button onClick={() => void retryCategories()} className="mt-3 text-sm text-primary-container hover:underline">
          重试
        </button>
      </div>
    ) : null;

  const groupContent = (
    <div className={categoryPanelClass}>
      {categoryStatusContent}
      {!categoryStatusContent && topCategoryItems.length > 0 && renderCategoryGrid(topCategoryItems)}
      {!categoryStatusContent && groups.length === 0 && standaloneCats.length === 0 && (
        <div className="text-center py-10">
          <Icon name="inventory_2" size={40} className="mx-auto mb-3 text-on-surface-variant/20" />
          <p className="text-sm text-on-surface-variant">暂无可选分类</p>
        </div>
      )}
    </div>
  );

  /* ── subcategory selection ── */
  async function handleShareSub(chSlug: string) {
    if (!user) {
      requireLogin('分享选型');
      return;
    }
    setSharing(true);
    try {
      const url = `${window.location.origin}/selection?g=${encodeURIComponent(chSlug)}`;
      await copyText(url);
      toast('分享链接已复制到剪贴板', 'success');
    } catch {
      toast('分享失败', 'error');
    } finally {
      setSharing(false);
    }
  }

  const subContent = group && <div className={categoryPanelClass}>{renderCategoryGrid(subCategoryItems)}</div>;

  /* ── wizard steps rendering (shared between desktop split and mobile combined) ── */
  const stepsJSX = fields.map((field, i) => {
    const isCompleted = !!specs[field];
    const isSkipped = skipped.has(field);
    const isCurrent = curField === field;
    const hasMore = i < fields.length - 1;
    const colDef = columns.find((c) => c.key === field);
    const fieldLabel = colDef?.label || field;
    const isManual = isManualColumn(colDef);
    const isPreset = isPresetColumn(colDef);

    if (isCompleted) {
      return (
        <div key={field}>
          <button
            onClick={() => dropVal(field)}
            className={`w-full flex items-center gap-2.5 rounded-xl bg-primary-container/8 border border-primary-container/12 px-3 md:px-4 py-2.5 text-left hover:bg-primary-container/15 ${selectionPress}`}
          >
            <div className="w-5 h-5 md:w-6 md:h-6 rounded-full bg-primary-container/25 flex items-center justify-center shrink-0">
              <Icon name="check" size={12} className="text-primary-container" />
            </div>
            <span className="text-xs sm:text-sm text-on-surface-variant shrink-0">{fieldLabel}:</span>
            <span className="text-xs sm:text-sm font-bold text-on-surface truncate">{specs[field]}</span>
            <Icon name="close" size={12} className="text-on-surface-variant/30 ml-auto shrink-0" />
          </button>
          {hasMore && <div className="w-px h-3 bg-primary-container/20 ml-5 md:ml-6" />}
        </div>
      );
    }

    if (isSkipped) {
      return (
        <div key={field}>
          <div className="flex items-center gap-2.5 px-3 md:px-4 py-2.5 bg-surface-container-low/50 rounded-lg">
            <div className="w-5 h-5 md:w-6 md:h-6 rounded-full bg-on-surface-variant/10 flex items-center justify-center shrink-0">
              <Icon name="remove" size={10} className="text-on-surface-variant/30" />
            </div>
            <span className="text-xs sm:text-sm text-on-surface-variant/30 line-through">{fieldLabel}</span>
            <span className="text-[10px] text-on-surface-variant/20 ml-1">不适用</span>
          </div>
          {hasMore && <div className="w-px h-2 bg-on-surface-variant/5 ml-5 md:ml-6" />}
        </div>
      );
    }

    if (isCurrent) {
      return (
        <div key={field} ref={curStepRef}>
          <div className="rounded-2xl border-2 border-primary-container/30 bg-surface-container-low overflow-hidden shadow-sm">
            <div className="px-4 sm:px-5 py-4 sm:py-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-6 h-6 md:w-7 md:h-7 rounded-full bg-primary-container text-on-primary flex items-center justify-center text-xs font-bold shrink-0">
                    {i + 1}
                  </div>
                  <h3 className="text-sm sm:text-base font-bold text-on-surface">选择{fieldLabel}</h3>
                </div>
                <span className="text-xs text-on-surface-variant bg-surface-container-high px-2.5 py-1 rounded-full shrink-0">
                  {formatModelCount(filteredTotal)}
                </span>
              </div>
              {isManual ? (
                <form
                  className="space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const value = normalizeManualValue(colDef, manualDrafts[field] ?? specs[field] ?? '');
                    if (value) pickVal(field, value);
                  }}
                >
                  <div className="flex flex-col sm:flex-row gap-2">
                    <div className="relative flex-1">
                      <input
                        value={manualDrafts[field] ?? specs[field] ?? ''}
                        onChange={(e) => setManualDrafts((prev) => ({ ...prev, [field]: e.target.value }))}
                        placeholder={colDef?.placeholder || `请填写${fieldLabel}`}
                        className="w-full rounded-xl border border-outline-variant/20 bg-surface-container px-3 sm:px-4 py-2.5 pr-12 text-sm text-on-surface outline-none focus:border-primary-container transition-colors"
                      />
                      {colDef?.suffix && (
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-on-surface-variant">
                          {colDef.suffix}
                        </span>
                      )}
                    </div>
                    <button
                      type="submit"
                      disabled={!String(manualDrafts[field] ?? specs[field] ?? '').trim()}
                      className="rounded-xl bg-primary-container px-4 py-2.5 text-sm font-bold text-on-primary disabled:opacity-40"
                    >
                      确认
                    </button>
                  </div>
                  <p className="text-xs text-on-surface-variant">
                    定制值不参与固定库存筛选，提交询价时会写入规格并替换型号占位符。
                  </p>
                </form>
              ) : isPreset ? (
                <div className="flex flex-wrap gap-2">
                  {(colDef?.presetOptions || []).map((opt) => (
                    <button
                      key={opt}
                      onClick={() => pickVal(field, opt)}
                      className="rounded-xl border border-outline-variant/20 bg-surface-container-low hover:border-primary-container/40 px-4 py-2.5 text-sm font-medium text-on-surface transition-all active:scale-[0.97]"
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              ) : shouldShowFilterLoading ? (
                <div className="py-6 text-center">
                  <p className="text-sm text-on-surface-variant">正在匹配可选项...</p>
                </div>
              ) : options.length > 0 ? (
                (() => {
                  const fieldImages = liveCat?.optionImages?.[field];
                  const hasFieldImages = fieldImages && Object.keys(fieldImages).length > 0;
                  const displayMode = colDef?.optionDisplay || 'auto';
                  return displayMode === 'image' || (displayMode === 'auto' && hasFieldImages);
                })() ? (
                  <div
                    className="grid gap-3"
                    style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${isDesktop ? 130 : 100}px, 1fr))` }}
                  >
                    {options.map(({ val }) => {
                      const uploadedImg = liveCat?.optionImages?.[field]?.[val];
                      const selected = specs[field] === val;
                      return (
                        <button
                          key={val}
                          onClick={() => pickVal(field, val)}
                          className={`group relative flex flex-col items-stretch rounded-xl border transition-all duration-150 active:scale-[0.97] ${
                            selected
                              ? 'border-primary-container shadow-sm scale-[1.02]'
                              : 'border-outline-variant/20 bg-surface-container-low hover:border-primary-container/40'
                          }`}
                        >
                          {/* Image area */}
                          <div
                            className={`relative w-full aspect-square flex items-center justify-center rounded-t-lg overflow-hidden bg-white`}
                          >
                            {uploadedImg ? (
                              <SafeImage
                                src={uploadedImg}
                                alt={val}
                                className="w-[85%] h-[85%] object-contain"
                                fallbackIcon="inventory_2"
                              />
                            ) : (
                              <Icon name="inventory_2" size={28} className="text-on-surface-variant/20" />
                            )}
                            {/* Selected check */}
                            {selected && (
                              <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-primary-container flex items-center justify-center">
                                <Icon name="check" size={14} className="text-on-primary" />
                              </div>
                            )}
                          </div>
                          {/* Label */}
                          <div className="px-2 py-2 text-center">
                            <span className="text-xs sm:text-sm font-medium text-on-surface leading-tight line-clamp-2">
                              {val}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {options.map(({ val, count }) => (
                      <button
                        key={val}
                        onClick={() => pickVal(field, val)}
                        className="rounded-lg border border-outline-variant/20 bg-surface-container px-3 sm:px-4 py-2 sm:py-2.5 text-sm text-on-surface hover:border-primary-container/50 hover:bg-primary-container/5 active:scale-95 transition-all min-h-[40px]"
                      >
                        <span className="font-medium">{val}</span>
                        {colDef?.showCount !== false && (
                          <span className="text-on-surface-variant/40 ml-1.5 text-xs">({count})</span>
                        )}
                      </button>
                    ))}
                  </div>
                )
              ) : (
                <div className="text-center py-6">
                  <p className="text-sm text-on-surface-variant">
                    {colDef?.required === true ? `必填字段“${fieldLabel}”缺少可选数据` : '当前条件下没有可选项'}
                  </p>
                  {colDef?.required === true ? (
                    <p className="mt-1 text-xs text-on-surface-variant/70">
                      当前匹配型号缺少这个字段，请回退修改条件或到后台补全数据。
                    </p>
                  ) : null}
                  {specKeys.length > 0 ? (
                    <button
                      onClick={() => dropVal(specKeys[specKeys.length - 1])}
                      className="mt-2 text-sm text-primary-container hover:underline"
                    >
                      回退上一步
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setSlug(null);
                        setSpecs({});
                        setManualDrafts({});
                        setSkipped(new Set());
                        setAutoSelectedFields(new Set());
                      }}
                      className="mt-2 text-sm text-primary-container hover:underline"
                    >
                      返回选择其他分类
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="flex h-1">
              {fields.map((_, fi) => (
                <div
                  key={fi}
                  className={`flex-1 transition-colors duration-300 ${specs[fields[fi]] ? 'bg-primary-container' : skipped.has(fields[fi]) ? 'bg-on-surface-variant/10' : 'bg-outline-variant/10'}`}
                />
              ))}
            </div>
          </div>
          {hasMore && <div className="w-px h-3 bg-outline-variant/10 ml-5 md:ml-6" />}
        </div>
      );
    }

    return (
      <div key={field}>
        <div className="flex items-center gap-2.5 px-3 md:px-4 py-2.5 text-on-surface-variant/25">
          <div className="w-5 h-5 md:w-6 md:h-6 rounded-full border border-current flex items-center justify-center text-[10px] shrink-0">
            {i + 1}
          </div>
          <span className="text-xs sm:text-sm">{fieldLabel}</span>
        </div>
        {hasMore && <div className="w-px h-2 bg-outline-variant/8 ml-5 md:ml-6" />}
      </div>
    );
  });

  const isMobileResultView = !isDesktop && phase === 'wizard' && !search && !curField;
  const wizardTransitionKey = search ? `search-${search}` : curField ? `field-${curField}` : 'selection-results';
  const wizardTransition = {
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -4 },
    transition: { duration: 0.16, ease: 'easeOut' },
  } as const;

  /* ── results block (only rendered when !curField) ── */
  const resultsJSX = !curField && (
    <div ref={resultRef}>
      <div
        className={`flex items-center justify-between ${isMobileResultView ? 'pt-0' : 'mt-4 border-t border-outline-variant/15 pt-3'}`}
      >
        <div>
          <h3 className="text-base font-bold text-on-surface">选型结果</h3>
          <p className="text-sm text-on-surface-variant mt-0.5">
            {filteredTotal > 0 ? `共匹配 ${formatModelCount(filteredTotal)}` : '暂无匹配型号'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {filteredTotal > 0 && (
            <button
              onClick={() => handleShare(true)}
              disabled={sharing}
              className={`text-sm text-primary-container hover:underline shrink-0 inline-flex items-center gap-1 disabled:opacity-50 ${selectionPress}`}
            >
              <Icon name="share" size={14} />
              {sharing ? '生成中...' : '生成结果链接'}
            </button>
          )}
          {specKeys.length > 0 && (
            <button
              onClick={restart}
              className={`text-sm text-on-surface-variant hover:text-primary-container shrink-0 ${selectionPress}`}
            >
              重新选择
            </button>
          )}
        </div>
      </div>
      {shouldShowFilterLoading ? (
        <div className="py-8 text-center">
          <p className="text-sm text-on-surface-variant">正在整理选型结果...</p>
        </div>
      ) : filteredTotal > 0 ? (
        <div className="space-y-3 mt-3 pb-6">
          {visibleFiltered.map((p) => (
            <ResultCard
              key={p.id}
              product={applyManualSpecs(withVisibleMatch(p), columns, specs)}
              columns={columns}
              kitListTitle={getKitListTitle((liveCat?.optionOrder || null) as Record<string, unknown> | null, p)}
              selected={selectedIds.has(p.id)}
              onToggleSelect={() => toggleSel(p.id)}
              onInquiry={() => {
                toggleSel(p.id);
                setInquiryOpen(true);
              }}
              expandedKits={expandedKits}
              onToggleKit={toggleKit}
              navigate={navigate}
              isMobile={!isDesktop}
            />
          ))}
          {hasMoreResults && (
            <button
              onClick={loadMoreResults}
              className={`w-full rounded-xl border border-outline-variant/20 bg-surface-container px-4 py-2.5 text-sm font-medium text-on-surface-variant hover:border-primary-container/40 hover:text-primary-container ${selectionPress}`}
            >
              继续加载（还剩 {remainingResultCount} 个）
            </button>
          )}
        </div>
      ) : (
        <div className="text-center py-10">
          <Icon name="search_off" size={36} className="mx-auto mb-2 text-on-surface-variant/20" />
          <p className="text-sm text-on-surface-variant">暂无匹配型号</p>
          <button onClick={restart} className="mt-3 text-sm text-primary-container hover:underline">
            重新选择
          </button>
        </div>
      )}
    </div>
  );

  /* ── wizard content: non-wizard-step states (loading / empty / search) ── */
  const wizardContent = filterError ? (
    <div className="text-center py-16 px-4">
      <Icon name="error" size={40} className="mx-auto mb-3 text-error/50" />
      <p className="text-sm font-medium text-on-surface">选型数据加载失败</p>
      <p className="mt-1 text-xs text-on-surface-variant">选型接口暂时不可用，请稍后重试</p>
      <div className="mt-4 flex items-center justify-center gap-3">
        <button
          onClick={() => retryFilter()}
          className="rounded-lg bg-primary-container px-4 py-2 text-sm font-bold text-on-primary hover:opacity-90"
        >
          重试
        </button>
        <button
          onClick={() => {
            setSlug(null);
            setSpecs({});
            setManualDrafts({});
            setSkipped(new Set());
            setAutoSelectedFields(new Set());
          }}
          className="rounded-lg border border-outline-variant/30 px-4 py-2 text-sm text-on-surface-variant hover:bg-surface-container-high/50"
        >
          返回分类列表
        </button>
      </div>
    </div>
  ) : !liveCat || (!search && specKeys.length === 0 && categoryProductCount === 0) ? (
    <div className="text-center py-16">
      <Icon name="inventory_2" size={40} className="mx-auto mb-3 text-on-surface-variant/20" />
      <p className="text-sm text-on-surface">当前分类暂无型号数据</p>
      <button
        onClick={() => {
          setSlug(null);
          setSpecs({});
          setManualDrafts({});
          setSkipped(new Set());
          setAutoSelectedFields(new Set());
        }}
        className="mt-3 text-sm text-primary-container hover:underline"
      >
        选择其他分类
      </button>
      {user?.role === 'ADMIN' && (
        <Link
          to="/admin/selections"
          className="mt-3 ml-4 inline-flex items-center gap-1 text-xs text-primary-container hover:underline"
        >
          <Icon name="tune" size={14} />
          前往管理
        </Link>
      )}
    </div>
  ) : search ? (
    <div className="px-4 md:px-6 py-4 md:py-6">
      {pageHeader}
      {filteredTotal > 0 ? (
        <div className="space-y-3 pb-4">
          {visibleFiltered.map((p) => (
            <ResultCard
              key={p.id}
              product={applyManualSpecs(withVisibleMatch(p), columns, specs)}
              columns={columns}
              kitListTitle={getKitListTitle((liveCat?.optionOrder || null) as Record<string, unknown> | null, p)}
              selected={selectedIds.has(p.id)}
              onToggleSelect={() => toggleSel(p.id)}
              onInquiry={() => {
                toggleSel(p.id);
                setInquiryOpen(true);
              }}
              expandedKits={expandedKits}
              onToggleKit={toggleKit}
              navigate={navigate}
              isMobile={!isDesktop}
            />
          ))}
          {hasMoreResults && (
            <button
              onClick={loadMoreResults}
              className={`w-full rounded-xl border border-outline-variant/20 bg-surface-container px-4 py-2.5 text-sm font-medium text-on-surface-variant hover:border-primary-container/40 hover:text-primary-container ${selectionPress}`}
            >
              继续加载（还剩 {remainingResultCount} 个）
            </button>
          )}
        </div>
      ) : (
        <div className="text-center py-12">
          <Icon name="search_off" size={36} className="mx-auto mb-2 text-on-surface-variant/20" />
          <p className="text-sm text-on-surface-variant">没有找到匹配型号</p>
        </div>
      )}
    </div>
  ) : null; /* wizard steps + results rendered separately via stepsJSX / resultsJSX */

  /* ── batch action bar ── */
  const actionBar = selectedIds.size > 0 && (
    <div
      className={`border-t border-outline-variant/15 bg-surface/95 px-3 py-2 backdrop-blur-sm flex items-center justify-between ${
        isDesktop
          ? 'shrink-0 z-10 md:px-4'
          : 'fixed inset-x-3 z-40 rounded-xl border shadow-[0_16px_36px_rgba(15,23,42,0.18)]'
      }`}
      style={
        !isDesktop
          ? { bottom: 'calc(3.9rem + env(safe-area-inset-bottom, 0px) + var(--visual-viewport-bottom, 0px))' }
          : undefined
      }
    >
      <span className="text-xs text-on-surface-variant md:text-sm">
        已选 <strong className="text-on-surface">{selectedIds.size}</strong> 项
      </span>
      <div className="flex gap-2">
        <button
          onClick={() => setSelectedIds(new Set())}
          className={`px-2.5 py-1.5 text-xs text-on-surface-variant hover:bg-surface-container-high rounded-lg ${selectionPress}`}
        >
          取消
        </button>
        <button
          onClick={() => setInquiryOpen(true)}
          className={`px-3 py-1.5 text-xs font-bold bg-primary-container text-on-primary rounded-lg hover:opacity-90 md:px-4 md:text-sm ${selectionPress}`}
        >
          一键询价
        </button>
      </div>
    </div>
  );

  const shellTitle = (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1 md:gap-1.5">
      {isDesktop ? (
        <>
          <button onClick={goHome} className={`truncate hover:text-primary-container ${selectionPress}`}>
            {pageTitle}
          </button>
          {group && (
            <>
              <Icon name="chevron_right" size={16} className="shrink-0 text-on-surface-variant/35" />
              {!slug ? (
                <span className="truncate">{group.name}</span>
              ) : (
                <button
                  onClick={() => {
                    setSlug(null);
                    setSpecs({});
                    setManualDrafts({});
                    setSkipped(new Set());
                    setAutoSelectedFields(new Set());
                    setSearchDraft('');
                  }}
                  className={`truncate hover:text-primary-container ${selectionPress}`}
                >
                  {group.name}
                </button>
              )}
            </>
          )}
          {liveCat && (
            <>
              <Icon name="chevron_right" size={16} className="shrink-0 text-on-surface-variant/35" />
              <span className="truncate text-primary-container">{liveCat.name}</span>
            </>
          )}
        </>
      ) : (
        <>
          {liveCat && group ? (
            <>
              <span className="shrink-0 text-on-surface">选择</span>
              <button
                onClick={() => {
                  setSlug(null);
                  setSpecs({});
                  setManualDrafts({});
                  setSkipped(new Set());
                  setAutoSelectedFields(new Set());
                  setSearchDraft('');
                }}
                className={`max-w-[6.25rem] truncate text-on-surface-variant hover:text-primary-container ${selectionPress}`}
              >
                {group.name}
              </button>
              <Icon name="chevron_right" size={14} className="shrink-0 text-on-surface-variant/35" />
              <span className="min-w-0 flex-1 truncate text-primary-container">{liveCat.name}</span>
            </>
          ) : liveCat ? (
            <>
              <span className="shrink-0 text-on-surface">选择</span>
              <span className="min-w-0 flex-1 truncate text-primary-container">{liveCat.name}</span>
            </>
          ) : group ? (
            <>
              <button
                onClick={goHome}
                className={`max-w-[5.25rem] truncate text-on-surface-variant hover:text-primary-container ${selectionPress}`}
              >
                {pageTitle}
              </button>
              <Icon name="chevron_right" size={14} className="shrink-0 text-on-surface-variant/35" />
              <span className="min-w-0 flex-1 truncate text-on-surface">{group.name}</span>
            </>
          ) : (
            <span className="truncate text-on-surface">{pageTitle}</span>
          )}
        </>
      )}
    </span>
  );

  const shellDescription =
    phase === 'group'
      ? pageDesc
      : phase === 'sub'
        ? '先选择产品分类，再按参数逐步缩小范围'
        : curField
          ? `按参数列定义顺序筛选，当前匹配 ${formatModelCount(filteredTotal)}`
          : `已完成筛选，共匹配 ${formatModelCount(filteredTotal)}`;

  const mobileSelectedSummary =
    !isDesktop && phase === 'wizard' && specKeys.length > 0 && !search ? (
      <div className="flex min-w-0 items-stretch overflow-x-auto border-t border-outline-variant/10 pt-1.5 scrollbar-none">
        {specKeys.map((k, index) => {
          const autoSelected = autoSelectedFields.has(k);
          return (
            <button
              key={k}
              onClick={() => dropVal(k)}
              disabled={autoSelected}
              className={`min-w-[4.9rem] shrink-0 px-2 text-left transition-colors ${index > 0 ? 'border-l border-outline-variant/12' : ''} ${
                autoSelected ? 'cursor-default text-on-surface-variant/45' : 'hover:text-primary-container'
              }`}
            >
              <span className="block truncate text-[9px] leading-3 text-on-surface-variant">
                {columnLabel(columns, k)}
              </span>
              <span
                className={`block truncate text-[11px] font-semibold leading-4 ${autoSelected ? 'text-on-surface-variant/55' : 'text-on-surface'}`}
              >
                {specs[k]}
              </span>
            </button>
          );
        })}
        <button
          onClick={() => {
            setSpecs({});
            setManualDrafts({});
            setSkipped(new Set());
            setAutoSelectedFields(new Set());
          }}
          className="shrink-0 border-l border-outline-variant/12 px-2 text-[10px] font-medium text-on-surface-variant transition-colors hover:text-primary-container"
        >
          清空
        </button>
      </div>
    ) : null;

  const groupProductTotal =
    group?.children.reduce((sum, child) => sum + (catBySlug.get(child.slug)?.productCount ?? 0), 0) ?? 0;

  const toolbarSummary =
    phase === 'group' ? (
      <div className="flex min-w-0 items-center gap-4 overflow-x-auto scrollbar-none text-xs text-on-surface-variant">
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="text-sm font-semibold text-on-surface">产品大类</span>
          <span className="rounded-full bg-primary-container/8 px-2 py-0.5 text-[10px] font-medium tabular-nums text-primary-container">
            {categoryGroupCountText}
          </span>
        </span>
        <span className="h-3 w-px shrink-0 bg-outline-variant/15" />
        {selectionStatItems.map((item) => (
          <span key={item.label} className="shrink-0">
            {item.label}{' '}
            <strong className="ml-0.5 tabular-nums text-sm font-semibold text-on-surface">
              {typeof item.value === 'number' ? item.value.toLocaleString() : item.value}
            </strong>
          </span>
        ))}
      </div>
    ) : phase === 'sub' && group ? (
      <div className="flex min-w-0 items-center gap-4 overflow-x-auto scrollbar-none text-xs text-on-surface-variant">
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="text-sm font-semibold text-on-surface">产品分类</span>
          <span className="rounded-full bg-primary-container/8 px-2 py-0.5 text-[10px] font-medium tabular-nums text-primary-container">
            {group.children.length}
          </span>
        </span>
        <span className="h-3 w-px shrink-0 bg-outline-variant/15" />
        <span className="shrink-0">
          型号{' '}
          <strong className="ml-0.5 tabular-nums text-sm font-semibold text-on-surface">
            {groupProductTotal.toLocaleString()}
          </strong>
        </span>
      </div>
    ) : phase === 'wizard' ? (
      <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto scrollbar-none md:gap-2">
        <span className="shrink-0 whitespace-nowrap text-xs text-on-surface-variant tabular-nums">
          已选 {specKeys.length}/{fields.length}
        </span>
        {specKeys.map((k) => {
          const autoSelected = autoSelectedFields.has(k);
          return (
            <button
              key={k}
              onClick={() => dropVal(k)}
              disabled={autoSelected}
              className={`hidden h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs md:inline-flex ${
                autoSelected
                  ? 'cursor-default bg-surface-container-high text-on-surface-variant/55'
                  : `bg-primary-container/10 text-primary-container hover:bg-primary-container/18 ${selectionPress}`
              }`}
            >
              <span className="text-on-surface-variant/70">{columnLabel(columns, k)}</span>
              <span className="max-w-[9rem] truncate font-medium">{specs[k]}</span>
              {!autoSelected ? <Icon name="close" size={10} /> : null}
            </button>
          );
        })}
        {specKeys.length > 0 ? (
          <button
            onClick={() => {
              setSpecs({});
              setManualDrafts({});
              setSkipped(new Set());
              setAutoSelectedFields(new Set());
              setSearchDraft('');
            }}
            className={`hidden h-8 shrink-0 items-center rounded-full px-2.5 text-xs font-medium text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface md:inline-flex ${selectionPress}`}
          >
            清空
          </button>
        ) : null}
      </div>
    ) : null;

  const handleToolbarShare = () => {
    if (!user) {
      requireLogin('分享选型');
      return;
    }
    if (phase === 'wizard' && liveCat) {
      void handleShare(false);
      return;
    }
    if (phase === 'sub' && group) {
      void handleShareSub(group.id);
      return;
    }
    void copyText(`${window.location.origin}/selection`).then(
      () => toast('分享链接已复制到剪贴板', 'success'),
      () => toast('分享失败', 'error'),
    );
  };
  const toolbarShareLabel = phase === 'group' ? '生成大类链接' : '生成分类链接';

  const selectionToolbarCore = (
    <div className="flex min-h-0 items-center gap-2 md:min-h-11 md:flex-wrap md:justify-between md:gap-3">
      <div className={`min-w-0 items-center gap-2 md:gap-3 ${phase === 'wizard' ? 'hidden shrink-0 md:flex' : 'flex'}`}>
        {toolbarSummary}
      </div>
      <div
        className={`flex min-h-8 flex-nowrap items-center justify-end gap-1.5 md:ml-auto md:min-h-9 md:flex-wrap md:gap-2 ${phase === 'wizard' ? 'min-w-0 flex-1' : 'ml-auto'}`}
      >
        {phase === 'wizard' && liveCat ? (
          <div className="relative min-w-[9.5rem] flex-1 sm:w-64 sm:flex-none">
            <Icon
              name="search"
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant"
            />
            <input
              type="text"
              {...searchDraftInputProps}
              placeholder="输入型号或名称"
              className={`h-8 w-full rounded-lg border border-outline-variant/15 bg-surface-container pl-8 pr-7 text-xs text-on-surface outline-none focus:border-primary-container md:h-9 md:pr-8 md:text-sm ${selectionMotion}`}
            />
            {searchDraftInputValue && (
              <button
                onClick={() => setSearchDraft('')}
                className={`absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface ${selectionPress}`}
              >
                <Icon name="close" size={14} />
              </button>
            )}
          </div>
        ) : null}
        {isDesktop ? (
          <button
            onClick={handleToolbarShare}
            disabled={sharing}
            data-tooltip-ignore
            className={`inline-flex h-9 items-center justify-center gap-1.5 px-3 text-xs font-bold text-on-surface-variant hover:text-on-surface disabled:opacity-50 ${selectionPress}`}
            aria-label={sharing ? '生成中' : toolbarShareLabel}
          >
            <Icon name="share" size={14} />
            <span>{sharing ? '生成中' : toolbarShareLabel}</span>
          </button>
        ) : null}
        {isDesktop && phase !== 'group' ? (
          <button
            onClick={goHome}
            data-tooltip-ignore
            className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface md:h-9 md:w-auto md:gap-1.5 md:px-3 ${selectionPress}`}
            aria-label="全部分类"
          >
            <Icon name="inventory_2" size={14} />
            <span className="hidden text-xs font-bold md:inline">全部分类</span>
          </button>
        ) : null}
        {!isDesktop && phase === 'wizard' ? (
          <span
            className="inline-flex h-8 shrink-0 items-center text-[11px] font-semibold text-primary-container tabular-nums"
            aria-label={`已选 ${specKeys.length}/${fields.length}`}
          >
            已选 {specKeys.length}/{fields.length}
          </span>
        ) : null}
      </div>
    </div>
  );

  const selectionToolbar =
    !isDesktop && phase === 'wizard' ? (
      <div className="flex w-full flex-col items-stretch gap-2">
        {selectionToolbarCore}
        {mobileSelectedSummary}
      </div>
    ) : (
      selectionToolbarCore
    );

  const shellActions =
    !isDesktop && phase === 'wizard' && liveCat ? (
      <div className="flex items-center gap-1">
        <button
          onClick={() => handleShare(false)}
          disabled={sharing}
          data-tooltip-ignore
          className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface disabled:opacity-50 ${selectionPress}`}
          aria-label={sharing ? '生成中' : '生成分类链接'}
        >
          <Icon name="share" size={15} />
        </button>
        <button
          onClick={goHome}
          data-tooltip-ignore
          className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface ${selectionPress}`}
          aria-label="全部分类"
        >
          <Icon name="inventory_2" size={15} />
        </button>
      </div>
    ) : null;

  const selectionPhaseKey =
    phase === 'group'
      ? 'selection-groups'
      : phase === 'sub'
        ? `selection-sub-${groupId || 'none'}`
        : `selection-wizard-${slug || 'none'}`;
  const desktopScrollContainerClass = 'h-full min-h-0 overflow-y-auto overflow-x-hidden custom-scrollbar';

  useEffect(() => {
    if (isDesktop) return;
    const frame = window.requestAnimationFrame(() => {
      mobileMainRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isDesktop, selectionPhaseKey]);

  const contentBody = (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={selectionPhaseKey}
        initial={{ opacity: 0.9 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0.96 }}
        transition={{ duration: 0.12, ease: 'easeOut' }}
        className="min-w-0"
      >
        {phase === 'group' && groupContent}
        {phase === 'sub' && subContent}
        {phase === 'wizard' &&
          (wizardContent || (
            <div ref={wizardWrapRef} className="px-4 py-4 md:px-5 md:py-5">
              {pageHeader}
              <div className="space-y-0">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div key={wizardTransitionKey} {...wizardTransition} className="min-w-0">
                    {isMobileResultView ? (
                      resultsJSX
                    ) : (
                      <>
                        {stepsJSX}
                        {resultsJSX}
                      </>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          ))}
      </motion.div>
    </AnimatePresence>
  );

  /* ══════════ Desktop Layout ══════════ */
  if (isDesktop) {
    return (
      <>
        <AdminPageShell>
          <AdminManagementPage
            title={shellTitle}
            description={shellDescription}
            toolbar={selectionToolbar}
            contentClassName="min-h-0"
          >
            <AdminContentPanel scroll>
              <div ref={scrollContainerRef} className={desktopScrollContainerClass}>
                {contentBody}
              </div>
              {actionBar}
            </AdminContentPanel>
          </AdminManagementPage>
          <InquiryDialog open={inquiryOpen} onClose={() => setInquiryOpen(false)} products={selectedProds} />
        </AdminPageShell>
        <LoginConfirmDialog
          open={loginDialogOpen}
          onClose={() => setLoginDialogOpen(false)}
          reason={loginDialogReason}
          returnUrl={location.pathname + location.search}
        />
      </>
    );
  }

  /* ══════════ Mobile Layout ══════════ */
  return (
    <>
      <AdminPageShell
        mobileMainRef={mobileMainRef}
        mobileContentClassName="flex flex-col gap-3 px-3 py-3 pb-4 min-h-full"
      >
        <AdminManagementPage
          title={shellTitle}
          description={shellDescription}
          actions={shellActions}
          toolbar={selectionToolbar}
          className="flex-1 h-auto min-h-[auto] flex flex-col gap-3"
          contentClassName="flex-1 min-h-[auto] flex flex-col"
        >
          <AdminContentPanel className="flex-1">
            {contentBody}
            {selectedIds.size > 0 && <div className="h-28" />}
            {actionBar}
          </AdminContentPanel>
        </AdminManagementPage>

        <InquiryDialog open={inquiryOpen} onClose={() => setInquiryOpen(false)} products={selectedProds} />
      </AdminPageShell>
      <LoginConfirmDialog
        open={loginDialogOpen}
        onClose={() => setLoginDialogOpen(false)}
        reason={loginDialogReason}
        returnUrl={location.pathname + location.search}
      />
    </>
  );
}
