import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import useSWR from "swr";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useMediaQuery } from "../layouts/hooks/useMediaQuery";
import TopNav from "../components/shared/TopNav";
import BottomNav from "../components/shared/BottomNav";
import AppSidebar from "../components/shared/Sidebar";
import MobileNavDrawer from "../components/shared/MobileNavDrawer";
import Icon from "../components/shared/Icon";
import SafeImage from "../components/shared/SafeImage";
import { useAuthStore } from "../stores/useAuthStore";
import {
  type ColumnDef,
  getSelectionCategories,
  getSelectionProducts,
  type SelectionProduct,
  type SelectionComponent,
  createSelectionShare,
} from "../api/selections";
import { createInquiry } from "../api/inquiries";
import { useToast } from "../components/shared/Toast";
import { compareOptionValues } from "../lib/selectionSort";
import { getCachedPublicSettings } from "../lib/publicSettings";
import { getBusinessConfig } from "../lib/businessConfig";
import { copyText } from "../lib/clipboard";

/* ── helpers ── */

function loadAliases(): Record<string, string[]> {
  const defaults: Record<string, string[]> = {
    "管径": ["适用管外径", "适用管径"],
    "适用管外径": ["管径", "适用管径"],
    "适用管径": ["适用管外径", "管径"],
  };
  try {
    const settings = getCachedPublicSettings();
    const raw = settings.field_aliases as string;
    if (raw) {
      const custom = JSON.parse(raw);
      if (typeof custom === "object" && custom !== null) return { ...defaults, ...custom };
    }
  } catch {
    // Invalid custom aliases fall back to built-in defaults.
  }
  return defaults;
}

let _aliases: Record<string, string[]> | null = null;
function getAliases(): Record<string, string[]> {
  if (!_aliases) _aliases = loadAliases();
  return _aliases;
}

function sv(specs: Record<string, string>, key: string): string {
  if (specs[key]) return specs[key];
  for (const a of getAliases()[key] ?? []) if (specs[a]) return specs[a];
  return "—";
}

function isManualColumn(col?: ColumnDef) {
  return col?.inputType === "manual";
}

function normalizeManualValue(col: ColumnDef | undefined, value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (!col?.suffix) return trimmed;
  return trimmed.toUpperCase().endsWith(col.suffix.toUpperCase()) ? trimmed : `${trimmed}${col.suffix}`;
}

function applyManualSpecs(product: SelectionProduct, columns: ColumnDef[], specs: Record<string, string>): SelectionProduct {
  const manualEntries = columns
    .filter((col) => isManualColumn(col) && specs[col.key])
    .map((col) => [col.key, normalizeManualValue(col, specs[col.key])] as const);

  if (!manualEntries.length) return product;

  const nextSpecs = { ...(product.specs as Record<string, string>) };
  for (const [key, value] of manualEntries) nextSpecs[key] = value;

  let modelNo = product.modelNo;
  if (modelNo) {
    for (const [key, value] of manualEntries) {
      modelNo = modelNo.replaceAll(`[${key}]`, value);
      if (key === "长度") modelNo = modelNo.replaceAll("[M]", value);
    }
  }

  return { ...product, modelNo, specs: nextSpecs };
}

const DEFAULT_CATEGORY_IMAGES: Record<string, string> = {};

function defaultCategoryImage(name: string) {
  const compact = name.replace(/\s+/g, "");
  if (DEFAULT_CATEGORY_IMAGES[name]) return DEFAULT_CATEGORY_IMAGES[name];
  for (const [key, value] of Object.entries(DEFAULT_CATEGORY_IMAGES)) {
    if (key.replace(/\s+/g, "") === compact) return value;
  }
  return "";
}

/* ── Inquiry Dialog ── */

interface ItemState { qty: number; remark: string }

function InquiryDialog({ open, onClose, products }: { open: boolean; onClose: () => void; products: SelectionProduct[] }) {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [itemStates, setItemStates] = useState<Record<string, ItemState>>({});
  const [remark, setRemark] = useState("");
  const [company, setCompany] = useState(user?.company || "");
  const [contactName, setContactName] = useState(user?.username || "");
  const [contactPhone, setContactPhone] = useState(user?.phone || "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  /* init item states when products change */
  useState(() => {
    const s: Record<string, ItemState> = {};
    products.forEach((p) => { if (!itemStates[p.id]) s[p.id] = { qty: 1, remark: "" }; });
    if (Object.keys(s).length) setItemStates((prev) => ({ ...s, ...prev }));
  });

  if (!open) return null;

  const getItem = (id: string): ItemState => itemStates[id] || { qty: 1, remark: "" };
  const updateItem = (id: string, patch: Partial<ItemState>) =>
    setItemStates((prev) => ({ ...prev, [id]: { ...(prev[id] || { qty: 1, remark: "" }), ...patch } }));

  const submit = async () => {
    if (!products.length) return;
    setSubmitting(true); setError("");
    try {
      const r = await createInquiry({
        items: products.map((p) => ({
          productId: p.id, productName: p.name, modelNo: p.modelNo || undefined,
          qty: getItem(p.id).qty, remark: getItem(p.id).remark || undefined,
        })),
        remark: remark || undefined, company: company || undefined,
        contactName: contactName || undefined, contactPhone: contactPhone || undefined,
      });
      navigate(`/my-inquiries/${r.id}`);
    } catch (e: any) { setError(e.response?.data?.detail || "提交失败"); }
    finally { setSubmitting(false); }
  };

  const specSummary = (specs: Record<string, string>) => {
    const entries = Object.entries(specs).filter(([, v]) => v && v !== "—").slice(0, 3);
    return entries.map(([k, v]) => `${k}:${v}`).join(" ");
  };

  return (
    <div className="fixed inset-0 z-[120] bg-black/40 backdrop-blur-sm p-0 md:flex md:items-center md:justify-center md:p-4" onClick={onClose}>
      <div className="fixed left-3 right-3 top-[max(1rem,env(safe-area-inset-top))] bottom-[max(1rem,env(safe-area-inset-bottom))] bg-surface-container-low rounded-2xl border border-outline-variant/20 shadow-2xl flex min-h-0 flex-col md:relative md:inset-auto md:w-full md:max-w-xl md:max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant/10 shrink-0">
          <h3 className="text-base font-bold text-on-surface">提交询价单</h3>
          <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface"><Icon name="close" size={20} /></button>
        </div>
        <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
          {/* Product list with qty + remark */}
          <div>
            <p className="text-sm font-medium text-on-surface mb-2">询价产品（{products.length} 项）</p>
            <div className="space-y-2">
              {products.map((p) => {
                const st = getItem(p.id);
                return (
                  <div key={p.id} className="rounded-lg border border-outline-variant/15 bg-surface-container-lowest px-3 py-2.5 space-y-2">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                      <p className="text-sm text-on-surface font-medium truncate flex-1">{p.modelNo || p.name}</p>
                      {p.modelNo && p.name !== p.modelNo && <p className="text-xs text-on-surface-variant truncate max-w-[50%]">{p.name}</p>}
                    </div>
                    {p.specs && <p className="text-[11px] text-on-surface-variant/60 truncate">{specSummary(p.specs as Record<string, string>)}</p>}
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-on-surface-variant">数量</span>
                        <input type="number" min={1} value={st.qty} onChange={(e) => updateItem(p.id, { qty: Math.max(1, parseInt(e.target.value) || 1) })}
                          className="w-14 bg-surface-container text-on-surface text-xs rounded px-2 py-1 border border-outline-variant/15 outline-none focus:border-primary-container text-center" />
                      </div>
                      <input value={st.remark} onChange={(e) => updateItem(p.id, { remark: e.target.value })} placeholder="备注（选填）"
                        className="flex-1 bg-surface-container text-on-surface text-xs rounded px-2 py-1 border border-outline-variant/15 outline-none focus:border-primary-container" />
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
              <input value={company} onChange={(e) => setCompany(e.target.value)} className="w-full bg-surface-container-lowest text-on-surface text-sm rounded-lg px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container transition-colors" />
            </div>
            <div>
              <label className="block text-xs text-on-surface-variant mb-1">联系人</label>
              <input value={contactName} onChange={(e) => setContactName(e.target.value)} className="w-full bg-surface-container-lowest text-on-surface text-sm rounded-lg px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container transition-colors" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs text-on-surface-variant mb-1">联系电话</label>
              <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className="w-full bg-surface-container-lowest text-on-surface text-sm rounded-lg px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container transition-colors" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-on-surface-variant mb-1">整体备注</label>
            <textarea value={remark} onChange={(e) => setRemark(e.target.value)} rows={2} placeholder="选填：交期要求、包装要求等"
              className="w-full bg-surface-container-lowest text-on-surface text-sm rounded-lg px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container resize-none transition-colors" />
          </div>
          {error && <p className="text-xs text-error">{error}</p>}
        </div>
        <div className="px-5 py-3 border-t border-outline-variant/10 flex gap-2 shrink-0">
          <button onClick={onClose} className="flex-1 py-2.5 text-sm font-medium border border-outline-variant/40 text-on-surface-variant rounded-xl hover:bg-surface-container-high/50 transition-colors">取消</button>
          <button onClick={submit} disabled={submitting} className="flex-1 py-2.5 text-sm font-bold bg-primary-container text-on-primary rounded-xl hover:opacity-90 disabled:opacity-50 transition-opacity">{submitting ? "提交中..." : "提交询价"}</button>
        </div>
      </div>
    </div>
  );
}

/* ── Result Card ── */

function ResultCard({ product, columns, selected, onToggleSelect, onInquiry, expandedKits, onToggleKit, navigate, isMobile }: {
  product: SelectionProduct; columns: ColumnDef[];
  selected: boolean; onToggleSelect: () => void; onInquiry: () => void;
  expandedKits: Set<string>; onToggleKit: (id: string) => void;
  navigate: ReturnType<typeof useNavigate>; isMobile: boolean;
}) {
  const expanded = expandedKits.has(product.id);
  const comps = (product.isKit && product.components ? product.components : []) as SelectionComponent[];
  const specCols = columns.filter((c) => c.key !== "型号");
  const { toast } = useToast();

  const handleCopy = async () => {
    const modelNo = product.modelNo || product.name;
    const parts = [modelNo];
    if (product.modelNo && product.name && product.name !== product.modelNo) {
      const cleanName = product.name.replace(product.modelNo, "").replace(/[\s\-—_]+$/g, "").replace(/^[\s\-—_]+/g, "");
      if (cleanName) parts.push(cleanName);
    }
    await copyText(parts.join(" "));
    toast("已复制型号和名称", "success");
  };

  return (
    <div className={`rounded-xl md:rounded-2xl border transition-colors overflow-hidden ${selected ? "border-primary-container/40 bg-primary-container/5" : "border-outline-variant/15 bg-surface-container-low"}`}>
      <div className="flex items-start gap-3 px-3 md:px-4 py-3 md:py-3.5">
        {product.image && (
          <SafeImage src={product.image} alt="" className="w-16 h-16 md:w-20 md:h-20 rounded-lg object-cover shrink-0 border border-outline-variant/10" fallbackIcon="image" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <input type="checkbox" checked={selected} onChange={onToggleSelect} className="h-4 w-4 rounded accent-primary-container shrink-0" />
            <span className="text-sm md:text-base font-bold text-on-surface break-all">{product.modelNo || product.name}</span>
            <button onClick={handleCopy} title="复制型号和名称" className="text-on-surface-variant/50 hover:text-on-surface-variant transition-colors"><Icon name="content_copy" size={14} /></button>
            {product.isKit && <span className="text-[10px] md:text-xs font-medium text-primary-container bg-primary-container/10 px-1.5 md:px-2 py-0.5 rounded-full">套件</span>}
          </div>
          {(() => {
            // Show name only if it's different from modelNo (remove modelNo part from name to avoid duplication)
            if (!product.modelNo || product.name === product.modelNo) return null;
            const cleanName = product.name.replace(product.modelNo, "").replace(/[\s\-—_]+$/g, "").replace(/^[\s\-—_]+/g, "");
            if (!cleanName) return null;
            return <p className="text-xs md:text-sm text-on-surface-variant mt-0.5 truncate">{cleanName}</p>;
          })()}
        </div>
      </div>

      <div className="px-3 md:px-4 pb-2.5 md:pb-3">
        <div className={`grid gap-x-3 md:gap-x-4 gap-y-0.5 md:gap-y-1 ${isMobile ? "grid-cols-2" : "grid-cols-2 md:grid-cols-3"}`}>
          {specCols.map((col) => {
            const v = sv(product.specs as Record<string, string>, col.key);
            if (v === "—") return null;
            return <div key={col.key} className="text-xs md:text-sm min-w-0"><span className="text-on-surface-variant">{col.label}: </span><span className="text-on-surface font-medium break-words">{v}</span></div>;
          })}
        </div>
      </div>

      {product.isKit && comps.length > 0 && (
        <div className="border-t border-outline-variant/10">
          <button onClick={() => onToggleKit(product.id)} className="w-full flex items-center justify-between px-3 md:px-4 py-2 md:py-2.5 text-xs md:text-sm text-on-surface-variant hover:bg-surface-container-high/30 transition-colors">
            <span>子零件（{comps.length}）</span>
            <Icon name={expanded ? "unfold_less" : "unfold_more"} size={16} />
          </button>
          {expanded && (
            <div className="px-3 md:px-4 pb-3 space-y-1">
              {comps.map((c, i) => (
                <div key={i} className="flex items-center gap-2 text-xs md:text-sm pl-2">
                  <span className="w-px h-3 bg-on-surface-variant/20 shrink-0" />
                  <span className="text-on-surface">{c.name}</span>
                  {c.modelNo && <span className="text-[10px] md:text-xs text-on-surface-variant">{c.modelNo}</span>}
                  {c.qty > 1 && <span className="text-[10px] md:text-xs text-on-surface-variant">&times;{c.qty}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="border-t border-outline-variant/10 px-3 md:px-4 py-2 md:py-2.5 flex items-center gap-1.5 md:gap-2 flex-wrap">
        <button onClick={onInquiry} className="px-2.5 md:px-3 py-1 md:py-1.5 text-xs md:text-sm font-bold bg-primary-container text-on-primary rounded-lg hover:opacity-90 transition-opacity">询价</button>
        {product.pdfUrl && (
          <a href={product.pdfUrl} target="_blank" rel="noopener" className="px-2.5 md:px-3 py-1 md:py-1.5 text-xs md:text-sm font-medium border border-outline-variant/30 text-on-surface-variant rounded-lg hover:bg-surface-container-high/50 transition-colors inline-flex items-center gap-1">
            <Icon name="library_books" size={14} /><span>规格书</span>
          </a>
        )}
        {product.matchedModelId ? (
          <a href={`/model/${product.matchedModelId}`} target="_blank" rel="noopener" className="px-2.5 md:px-3 py-1 md:py-1.5 text-xs md:text-sm font-medium border border-outline-variant/30 text-on-surface-variant rounded-lg hover:bg-surface-container-high/50 transition-colors inline-flex items-center gap-1">
            <Icon name="view_in_ar" size={14} /><span>模型</span>
          </a>
        ) : null}
        <button onClick={() => navigate(`/support`, { state: { modelNo: product.modelNo || product.name, specs: product.specs, source: 'selection' as const } })} className="px-2.5 md:px-3 py-1 md:py-1.5 text-xs md:text-sm font-medium border border-outline-variant/30 text-on-surface-variant rounded-lg hover:bg-surface-container-high/50 transition-colors inline-flex items-center gap-1">
          <Icon name="support_agent" size={14} /><span>技术支持</span>
        </button>
      </div>
    </div>
  );
}

/* ══════════════ Main Page ══════════════ */

export default function SelectionPage() {
  const { data: settingsData } = useSWR("publicSettings", () => getCachedPublicSettings());
  const business = getBusinessConfig(settingsData);
  const pageTitle = (settingsData?.selection_page_title as string) || "产品选型";
  const pageDesc = (settingsData?.selection_page_desc as string) || "选择产品大类，逐步筛选出精确型号";
  useDocumentTitle(pageTitle);
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const navigate = useNavigate();
  const location = useLocation();
  const previewCategoryImages = useMemo(
    () => new URLSearchParams(location.search).get("previewImages") === "1",
    [location.search]
  );
  const { user } = useAuthStore();
  const { toast } = useToast();
  const [navOpen, setNavOpen] = useState(false);
  const [inquiryOpen, setInquiryOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedKits, setExpandedKits] = useState<Set<string>>(new Set());

  /* wizard state */
  const [groupId, setGroupId] = useState<string | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const [specs, setSpecs] = useState<Record<string, string>>({});
  const [manualDrafts, setManualDrafts] = useState<Record<string, string>>({});
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  /* data */
  const { data: cats = [] } = useSWR("selections/categories", getSelectionCategories);

  /* pre-fill from share link state or URL params */
  const shareStateRef = useRef<{ shareSlug?: string; shareSpecs?: Record<string, string> } | null>(null);
  if (!shareStateRef.current) {
    const state = location.state as { shareSlug?: string; shareSpecs?: Record<string, string> } | null;
    if (state?.shareSlug) shareStateRef.current = state;
  }

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const g = params.get("g");
    if (g && !groupId) {
      setGroupId(g);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply share slug/specs once cats are loaded
  useEffect(() => {
    const share = shareStateRef.current;
    if (!share?.shareSlug || !cats.length || slug) return;
    setSlug(share.shareSlug);
    if (share.shareSpecs) setSpecs(share.shareSpecs);
    const match = cats.find((c) => c.slug === share.shareSlug);
    if (match?.groupId) setGroupId(match.groupId);
    shareStateRef.current = null;
    window.history.replaceState({}, "");
  }, [cats, slug]);

  /* derive groups and standalone categories from API categories */
  interface DerivedGroup {
    id: string;
    name: string;
    icon: string;
    image: string | null;
    imageFit: "cover" | "contain";
    children: { slug: string; name: string; icon: string }[];
  }
  const groups = useMemo<DerivedGroup[]>(() => {
    const map = new Map<string, DerivedGroup>();
    for (const c of cats) {
      if (!c.groupId || !c.groupName) continue;
      if (!map.has(c.groupId)) {
        map.set(c.groupId, { id: c.groupId, name: c.groupName, icon: c.groupIcon || "category", image: c.groupImage || null, imageFit: c.groupImageFit === "contain" ? "contain" : "cover", children: [] });
      } else if (!map.get(c.groupId)!.image && c.groupImage) {
        map.get(c.groupId)!.image = c.groupImage;
        map.get(c.groupId)!.imageFit = c.groupImageFit === "contain" ? "contain" : "cover";
      }
      map.get(c.groupId)!.children.push({ slug: c.slug, name: c.name, icon: c.icon || "category" });
    }
    return Array.from(map.values());
  }, [cats]);

  // Standalone categories without a group
  const standaloneCats = useMemo(() => cats.filter((c) => !c.groupId || !c.groupName), [cats]);
  const catBySlug = useMemo(() => new Map(cats.map((c) => [c.slug, c])), [cats]);

  const group = useMemo(() => groups.find((g) => g.id === groupId) ?? null, [groups, groupId]);

  const liveCat = slug ? cats.find((c) => c.slug === slug) ?? null : null;
  const { data: pData, isLoading } = useSWR(
    liveCat ? ["sel-prod", liveCat.slug] : null,
    () => getSelectionProducts(liveCat!.slug, 1, Math.max(liveCat!.productCount ?? 2000, 2000))
  );
  const all = useMemo(() => pData?.items ?? [], [pData]);

  const fields = useMemo(() => {
    if (liveCat?.columns?.length) {
      return liveCat.columns.filter((col) => col.key !== "型号" && !col.displayOnly).map((col) => col.key);
    }
    return [];
  }, [liveCat]);

  const columns = useMemo(() => {
    if (liveCat?.columns?.length) return liveCat.columns;
    return [];
  }, [liveCat]);

  const manualFields = useMemo(() => new Set(columns.filter(isManualColumn).map((col) => col.key)), [columns]);
  const specKeys = useMemo(() => fields.filter((f) => specs[f]), [fields, specs]);

  /* filtered */
  const filtered = useMemo(() => {
    if (search) {
      const q = search.toLowerCase();
      return all.filter((p) => (p.modelNo || "").toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
    }
    return all.filter((p) =>
      Object.entries(specs).every(([k, v]) => manualFields.has(k) || sv(p.specs as Record<string, string>, k) === v)
    );
  }, [all, specs, search, manualFields]);

  const curField = useMemo(() => {
    for (const f of fields) {
      if (specs[f]) continue;
      if (skipped.has(f)) continue;
      return f;
    }
    return null;
  }, [fields, specs, skipped]);

  const options = useMemo(() => {
    if (!curField) return [];
    if (manualFields.has(curField)) return [];
    const m = new Map<string, number>();
    filtered.forEach((p) => {
      const v = sv(p.specs as Record<string, string>, curField);
      if (v !== "—") m.set(v, (m.get(v) || 0) + 1);
    });
    const entries = Array.from(m.entries());
    // Get sortType from column definition
    const colDef = columns.find((c) => c.key === curField);
    const sortType = colDef?.sortType;
    // Use custom optionOrder if defined
    const savedOrder = (liveCat?.optionOrder as Record<string, string[]>)?.[curField];
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
  }, [filtered, curField, liveCat?.optionOrder, columns, manualFields, business.threadPriority]);

  const phase: "group" | "sub" | "wizard" = !groupId ? "group" : !slug ? "sub" : "wizard";
  const selectedProds = filtered.filter((p) => selectedIds.has(p.id)).map((p) => applyManualSpecs(p, columns, specs));

  /* auto-scroll ref */
  const curStepRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  /* track user-initiated undo to suppress immediate auto-skip */
  const userUndoRef = useRef(false);

  /* auto-skip: single-value params get auto-selected; zero-option params get skipped */
  useEffect(() => {
    if (isLoading || search || !curField) return;
    if (manualFields.has(curField)) return;
    if (options.length === 0 && all.length > 0) {
      // Always skip empty fields — never suppress this
      setSkipped((p) => new Set(p).add(curField));
      return;
    }
    if (userUndoRef.current) {
      // After user manually undoes, suppress auto-select for one cycle so they can re-choose
      userUndoRef.current = false;
      return;
    }
    if (options.length === 1) {
      setSpecs((p) => ({ ...p, [curField]: options[0].val }));
    }
  }, [curField, options, search, isLoading, all.length, manualFields]);

  /* auto-scroll to current step — desktop uses container.scrollTo to avoid sidebar shift */
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (search) return;
    clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = setTimeout(() => {
      const el = curField ? curStepRef.current : resultRef.current;
      if (!el) return;
      if (isDesktop) {
        const container = scrollContainerRef.current;
        if (!container) return;
        const cRect = container.getBoundingClientRect();
        const eRect = el.getBoundingClientRect();
        const target = eRect.top - cRect.top + container.scrollTop - cRect.height / 2 + eRect.height / 2;
        container.scrollTo({ top: target, behavior: "smooth" });
      } else {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 200);
    return () => clearTimeout(scrollTimerRef.current);
  }, [curField, search, isDesktop]);

  /* handlers */
  const pickGroup = useCallback((id: string) => {
    setGroupId(id); setSlug(null); setSpecs({}); setManualDrafts({}); setSkipped(new Set()); setSearch(""); setSelectedIds(new Set()); setExpandedKits(new Set());
  }, []);
  const pickSub = useCallback((s: string) => {
    setSlug(s); setSpecs({}); setManualDrafts({}); setSkipped(new Set()); setSearch(""); setSelectedIds(new Set()); setExpandedKits(new Set());
  }, []);
  const pickVal = useCallback((key: string, val: string) => setSpecs((p) => ({ ...p, [key]: val })), []);
  const dropVal = useCallback((key: string) => {
    userUndoRef.current = true;
    setSpecs((prev) => {
      const keys = Object.keys(prev);
      const i = keys.indexOf(key);
      const next: Record<string, string> = {};
      for (let j = 0; j < i; j++) next[keys[j]] = prev[keys[j]];
      return next;
    });
    setSkipped(new Set());
    setSearch("");
  }, []);
  const goHome = useCallback(() => {
    setGroupId(null); setSlug(null); setSpecs({}); setManualDrafts({}); setSkipped(new Set()); setSearch(""); setSelectedIds(new Set()); setExpandedKits(new Set());
  }, []);
  const restart = useCallback(() => {
    setSpecs({}); setManualDrafts({}); setSkipped(new Set()); setSearch(""); setSelectedIds(new Set()); setExpandedKits(new Set());
  }, []);
  const toggleSel = useCallback((id: string) => setSelectedIds((p) => {
    const n = new Set(p);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  }), []);
  const toggleKit = useCallback((id: string) => setExpandedKits((p) => {
    const n = new Set(p);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  }), []);

  /* ── share handler ── */
  const [sharing, setSharing] = useState(false);

  function requireLogin() {
    toast("请先登录后分享", "error");
    navigate("/login", { state: { from: location.pathname + location.search } });
  }

  async function handleShare(withResults = false) {
    if (!slug) return;
    if (!user) { requireLogin(); return; }
    setSharing(true);
    try {
      const payload = {
        categorySlug: slug,
        specs: withResults ? specs : {},
        productIds: withResults ? filtered.map((p) => p.id) : [],
      };
      console.log("[Share] Request payload:", JSON.stringify(payload).slice(0, 500));
      const result = await createSelectionShare(payload);
      const url = `${window.location.origin}/selection/s/${result.token}`;
      await copyText(url);
      toast("分享链接已复制到剪贴板", "success");
    } catch (err: any) {
      console.error("[Share] Error:", err?.response?.status, err?.response?.data, err?.message);
      toast(`分享失败: ${err?.response?.data?.message || err?.message || "未知错误"}`, "error");
    } finally {
      setSharing(false);
    }
  }

  const totalProductCount = useMemo(
    () => cats.reduce((sum, c) => sum + (c.productCount ?? 0), 0),
    [cats]
  );
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

  const categoryMedia = (image: string | null | undefined, icon: string | null | undefined, name: string, previewSeed: string, imageFit: "cover" | "contain" = "cover") => {
    const defaultImage = defaultCategoryImage(name);
    const mediaImage = image || defaultImage || (previewCategoryImages ? categoryPreviewImage(previewSeed) : "");
    const fallbackIcon = icon || "category";

    if (!mediaImage) {
      return (
        <div className="h-12 w-12 shrink-0 rounded-xl bg-surface-container-high border border-outline-variant/10 flex items-center justify-center">
          <Icon name={fallbackIcon} size={22} className="text-primary-container" />
        </div>
      );
    }

    return (
      <div className="w-full aspect-[3.25/1] md:aspect-[2.35/1] rounded-xl bg-surface-container-high border border-outline-variant/10 overflow-hidden shrink-0">
        <SafeImage
          src={mediaImage}
          alt={name}
          className={imageFit === "contain" ? "w-full h-full object-contain p-2" : "w-full h-full object-cover md:scale-[1.12] md:group-hover:scale-[1.18] transition-transform duration-500"}
          fallbackClassName="bg-surface-container-high"
          fallbackIcon={fallbackIcon}
        />
      </div>
    );
  };

  /* ── page header — matches other pages' style (h2 title row inside content area) ── */
  const pageHeader = (
    <div className="mb-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-1.5 font-headline text-xl md:text-2xl font-bold tracking-tight text-on-surface uppercase min-w-0 overflow-x-auto scrollbar-none">
          <button onClick={goHome} className="hover:text-primary-container transition-colors shrink-0">{pageTitle}</button>
          {group && (
            <>
              <Icon name="chevron_right" size={18} className="text-on-surface-variant/30 shrink-0" />
              {!slug ? (
                <span className="shrink-0">{group.name}</span>
              ) : (
                <button onClick={() => { setSlug(null); setSpecs({}); setManualDrafts({}); setSkipped(new Set()); setSearch(""); }}
                  className="hover:text-primary-container transition-colors shrink-0">{group.name}</button>
              )}
            </>
          )}
          {liveCat && (
            <>
              <Icon name="chevron_right" size={18} className="text-on-surface-variant/30 shrink-0" />
              <span className="text-primary-container shrink-0">{liveCat.name}</span>
            </>
          )}
        </div>
      </div>
      {slug && liveCat && (
        <div className="flex items-center gap-3 mt-3">
          <span className="text-sm text-on-surface-variant shrink-0">{filtered.length} 个型号</span>
          <div className="relative flex-1 max-w-xs">
            <Icon name="search" size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索型号..."
              className="w-full rounded-lg border border-outline-variant/15 bg-surface-container pl-7 pr-6 py-1.5 text-sm text-on-surface outline-none focus:border-primary-container transition-colors" />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface"><Icon name="close" size={14} /></button>
            )}
          </div>
          <button onClick={() => handleShare(false)} disabled={sharing} className="text-sm text-primary-container hover:underline shrink-0 inline-flex items-center gap-1 disabled:opacity-50 ml-auto">
            <Icon name="share" size={14} />{sharing ? "..." : "分享此分类"}
          </button>
        </div>
      )}
    </div>
  );

  /* ── group selection ── */
  const groupContent = (
    <div className="px-4 md:px-8 lg:px-10 xl:px-12 pt-4 pb-6 md:py-8">
      <div className="mb-5 md:mb-7">
        <div className="md:hidden">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-container/8 text-primary-container">
              <Icon name="tune" size={18} />
            </span>
            <h1 className="text-xl font-headline font-bold text-on-surface leading-none">{pageTitle}</h1>
          </div>
          <p className="text-sm text-on-surface-variant mt-2 leading-relaxed">{pageDesc}</p>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 md:hidden">
          <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low px-3 py-2">
            <p className="text-[11px] text-on-surface-variant">大类</p>
            <p className="text-base font-bold text-on-surface">{groups.length + standaloneCats.length}</p>
          </div>
          <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low px-3 py-2">
            <p className="text-[11px] text-on-surface-variant">子类</p>
            <p className="text-base font-bold text-on-surface">{cats.length}</p>
          </div>
          <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low px-3 py-2">
            <p className="text-[11px] text-on-surface-variant">产品</p>
            <p className="text-base font-bold text-on-surface">{totalProductCount}</p>
          </div>
        </div>
        <div className="hidden md:flex flex-col xl:flex-row xl:items-stretch xl:justify-between gap-5 xl:gap-6 rounded-2xl border border-outline-variant/12 bg-surface-container-low px-6 py-5 shadow-sm">
          <div className="min-w-0 flex items-start gap-4">
            <div className="mt-1 h-12 w-1.5 rounded-full bg-primary-container" />
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full bg-primary-container/8 px-3 py-1 text-[11px] font-semibold text-primary-container">
                <Icon name="tune" size={14} />
                PRODUCT SELECTOR
              </div>
              <h1 className="mt-3 font-headline text-3xl font-bold tracking-tight text-on-surface whitespace-nowrap">{pageTitle}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-on-surface-variant">{pageDesc}</p>
            </div>
          </div>
          <div className="grid w-full grid-cols-3 gap-3 xl:w-auto xl:min-w-[360px]">
            <div className="rounded-xl border border-outline-variant/10 bg-surface px-4 py-3">
              <p className="text-xs text-on-surface-variant">大类</p>
              <p className="mt-1 text-2xl font-bold text-on-surface">{groups.length + standaloneCats.length}</p>
            </div>
            <div className="rounded-xl border border-outline-variant/10 bg-surface px-4 py-3">
              <p className="text-xs text-on-surface-variant">子类</p>
              <p className="mt-1 text-2xl font-bold text-on-surface">{cats.length}</p>
            </div>
            <div className="rounded-xl border border-outline-variant/10 bg-surface px-4 py-3">
              <p className="text-xs text-on-surface-variant">产品</p>
              <p className="mt-1 text-2xl font-bold text-on-surface">{totalProductCount}</p>
            </div>
          </div>
        </div>
      </div>
      {/* Standalone categories (no group) */}
      {standaloneCats.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3 md:mb-4">
            <h2 className="text-sm md:text-base font-bold text-on-surface">{groups.length > 0 ? "产品分类" : "选择大类"}</h2>
            <span className="text-xs text-on-surface-variant">{standaloneCats.length} 项</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5 md:gap-4">
            {standaloneCats.map((c) => (
              <button key={c.id} onClick={() => pickSub(c.slug)}
                className="group rounded-xl md:rounded-2xl border border-outline-variant/12 bg-surface-container-low p-2.5 md:p-3 text-left shadow-sm transition-all active:scale-[0.98] hover:-translate-y-0.5 hover:border-primary-container/35 hover:bg-surface hover:shadow-md">
                <div className={`${c.image || defaultCategoryImage(c.name) || previewCategoryImages ? "space-y-3" : "flex items-center gap-3"}`}>
                  {categoryMedia(c.image, c.icon, c.name, c.slug)}
                  <div className="min-w-0 flex-1 flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-sm md:text-base text-on-surface leading-snug line-clamp-2">{c.name}</div>
                      <div className="text-xs text-on-surface-variant mt-0.5">{c.productCount ?? 0} 个产品</div>
                    </div>
                    <span className="hidden md:flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-container-high text-on-surface-variant transition-colors group-hover:bg-primary-container group-hover:text-on-primary">
                      <Icon name="chevron_right" size={18} />
                    </span>
                    <Icon name="chevron_right" size={18} className="text-on-surface-variant/35 shrink-0 md:hidden" />
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
      {/* Grouped categories */}
      {groups.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3 md:mb-4">
            <h2 className="text-sm md:text-base font-bold text-on-surface">{standaloneCats.length > 0 ? "产品分组" : "选择大类"}</h2>
            <span className="text-xs text-on-surface-variant">{groups.length} 项</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5 md:gap-4">
            {groups.map((g) => {
              const childProductCount = g.children.reduce((sum, child) => {
                const cat = catBySlug.get(child.slug);
                return sum + (cat?.productCount ?? 0);
              }, 0);
              const groupImage = g.image || g.children.map((child) => catBySlug.get(child.slug)?.image).find(Boolean);
              const hasGroupImage = Boolean(groupImage || defaultCategoryImage(g.name) || previewCategoryImages);
              return (
                <button key={g.id} onClick={() => pickGroup(g.id)}
                  className="group rounded-xl md:rounded-2xl border border-outline-variant/12 bg-surface-container-low p-2.5 md:p-3 text-left shadow-sm transition-all active:scale-[0.98] hover:-translate-y-0.5 hover:border-primary-container/35 hover:bg-surface hover:shadow-md">
                  <div className={`${hasGroupImage ? "space-y-3" : "flex items-center gap-3"}`}>
                    {categoryMedia(groupImage, g.icon, g.name, g.id, g.imageFit)}
                    <div className="min-w-0 flex-1 flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-sm md:text-base text-on-surface leading-snug line-clamp-2">{g.name}</div>
                        <div className="text-xs text-on-surface-variant mt-0.5">{g.children.length} 个子类{childProductCount > 0 ? ` · ${childProductCount} 个产品` : ""}</div>
                      </div>
                      <span className="hidden md:flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-container-high text-on-surface-variant transition-colors group-hover:bg-primary-container group-hover:text-on-primary">
                        <Icon name="chevron_right" size={18} />
                      </span>
                      <Icon name="chevron_right" size={18} className="text-on-surface-variant/35 shrink-0 md:hidden" />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {groups.length === 0 && standaloneCats.length === 0 && (
        <div className="text-center py-10">
          <Icon name="inventory_2" size={40} className="mx-auto mb-3 text-on-surface-variant/20" />
          <p className="text-sm text-on-surface-variant">暂无产品分类</p>
        </div>
      )}
    </div>
  );

  /* ── subcategory selection ── */
  async function handleShareSub(chSlug: string) {
    setSharing(true);
    try {
      const url = `${window.location.origin}/selection?g=${encodeURIComponent(chSlug)}`;
      await copyText(url);
      toast("分享链接已复制到剪贴板", "success");
    } catch {
      toast("分享失败", "error");
    } finally {
      setSharing(false);
    }
  }

  const subContent = group && (
    <div className="px-4 md:px-6 py-6 md:py-10">
      {pageHeader}
      <p className="text-sm text-on-surface-variant -mt-4 mb-5">请选择产品子类
        <button onClick={() => handleShareSub(group.id)} disabled={sharing} className="ml-2 text-primary-container hover:underline disabled:opacity-50 inline-flex items-center gap-1">
          <Icon name="share" size={12} />{sharing ? "..." : "分享此大类"}
        </button>
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 md:gap-3">
        {group.children.map((ch) => (
          <button key={ch.slug} onClick={() => pickSub(ch.slug)}
            className="rounded-xl border border-outline-variant/15 bg-surface-container-low p-3.5 md:p-4 text-left hover:border-primary-container/40 hover:bg-primary-container/5 transition-all active:scale-[0.98]">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 md:w-10 md:h-10 rounded-lg bg-surface-container-high flex items-center justify-center shrink-0">
                <Icon name={ch.icon} size={18} className="text-primary-container" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-bold text-sm text-on-surface">{ch.name}</div>
                <div className="text-xs text-on-surface-variant mt-0.5">{ch.pageRange}</div>
              </div>
              <Icon name="chevron_right" size={20} className="text-on-surface-variant/40 shrink-0" />
            </div>
          </button>
        ))}
      </div>
    </div>
  );

  /* ── wizard steps rendering (shared between desktop split and mobile combined) ── */
  const stepsJSX = fields.map((field, i) => {
    const isCompleted = !!specs[field];
    const isSkipped = skipped.has(field);
    const isCurrent = curField === field;
    const hasMore = i < fields.length - 1;
    const colDef = columns.find((c) => c.key === field);
    const isManual = isManualColumn(colDef);

    if (isCompleted) {
      return (
        <div key={field}>
          <button onClick={() => dropVal(field)}
            className="w-full flex items-center gap-2.5 rounded-xl bg-primary-container/8 border border-primary-container/12 px-3 md:px-4 py-2.5 text-left hover:bg-primary-container/15 transition-colors">
            <div className="w-5 h-5 md:w-6 md:h-6 rounded-full bg-primary-container/25 flex items-center justify-center shrink-0">
              <Icon name="check" size={12} className="text-primary-container" />
            </div>
            <span className="text-xs sm:text-sm text-on-surface-variant shrink-0">{field}:</span>
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
            <span className="text-xs sm:text-sm text-on-surface-variant/30 line-through">{field}</span>
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
                  <div className="w-6 h-6 md:w-7 md:h-7 rounded-full bg-primary-container text-on-primary flex items-center justify-center text-xs font-bold shrink-0">{i + 1}</div>
                  <h3 className="text-sm sm:text-base font-bold text-on-surface">选择{field}</h3>
                </div>
                <span className="text-xs text-on-surface-variant bg-surface-container-high px-2.5 py-1 rounded-full shrink-0">{filtered.length} 件</span>
              </div>
              {isManual ? (
                <form
                  className="space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const value = normalizeManualValue(colDef, manualDrafts[field] ?? specs[field] ?? "");
                    if (value) pickVal(field, value);
                  }}
                >
                  <div className="flex flex-col sm:flex-row gap-2">
                    <div className="relative flex-1">
                      <input
                        value={manualDrafts[field] ?? specs[field] ?? ""}
                        onChange={(e) => setManualDrafts((prev) => ({ ...prev, [field]: e.target.value }))}
                        placeholder={colDef?.placeholder || `请输入${field}`}
                        className="w-full rounded-xl border border-outline-variant/20 bg-surface-container px-3 sm:px-4 py-2.5 pr-12 text-sm text-on-surface outline-none focus:border-primary-container transition-colors"
                      />
                      {colDef?.suffix && (
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-on-surface-variant">{colDef.suffix}</span>
                      )}
                    </div>
                    <button
                      type="submit"
                      disabled={!String(manualDrafts[field] ?? specs[field] ?? "").trim()}
                      className="rounded-xl bg-primary-container px-4 py-2.5 text-sm font-bold text-on-primary disabled:opacity-40"
                    >
                      确认
                    </button>
                  </div>
                  <p className="text-xs text-on-surface-variant">
                    该字段为定制输入，不会按固定库存长度筛选；提交询价时会写入规格并替换型号里的占位符。
                  </p>
                </form>
              ) : options.length > 0 ? (
                (() => {
                  // Per-field check: only use image cards if THIS field has uploaded images
                  const fieldImages = liveCat?.optionImages?.[field];
                  const hasFieldImages = fieldImages && Object.keys(fieldImages).length > 0;
                  return hasFieldImages;
                })() ? (
                  <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${isDesktop ? 130 : 100}px, 1fr))` }}>
                    {options.map(({ val }) => {
                      const uploadedImg = liveCat?.optionImages?.[field]?.[val];
                      const selected = specs[field] === val;
                      return (
                        <button key={val} onClick={() => pickVal(field, val)}
                          className={`group relative flex flex-col items-stretch rounded-xl border transition-all duration-150 active:scale-[0.97] ${
                            selected
                              ? "border-primary-container shadow-sm scale-[1.02]"
                              : "border-outline-variant/20 bg-surface-container-low hover:border-primary-container/40"
                          }`}>
                          {/* Image area */}
                          <div className={`relative w-full aspect-square flex items-center justify-center rounded-t-lg overflow-hidden bg-white`}>
                            {uploadedImg ? (
                              <SafeImage src={uploadedImg} alt={val} className="w-[85%] h-[85%] object-contain" fallbackIcon="category" />
                            ) : (
                              <Icon name="category" size={28} className="text-on-surface-variant/20" />
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
                            <span className="text-xs sm:text-sm font-medium text-on-surface leading-tight line-clamp-2">{val}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {options.map(({ val, count }) => (
                      <button key={val} onClick={() => pickVal(field, val)}
                        className="rounded-lg border border-outline-variant/20 bg-surface-container px-3 sm:px-4 py-2 sm:py-2.5 text-sm text-on-surface hover:border-primary-container/50 hover:bg-primary-container/5 active:scale-95 transition-all min-h-[40px]">
                        <span className="font-medium">{val}</span>
                        <span className="text-on-surface-variant/40 ml-1.5 text-xs">({count})</span>
                      </button>
                    ))}
                  </div>
                )
              ) : (
                <div className="text-center py-6">
                  <p className="text-sm text-on-surface-variant">当前条件下没有可选值</p>
                  {specKeys.length > 0 ? (
                    <button onClick={() => dropVal(specKeys[specKeys.length - 1])} className="mt-2 text-sm text-primary-container hover:underline">回退上一步</button>
                  ) : (
                    <button onClick={() => { setSlug(null); setSpecs({}); setManualDrafts({}); setSkipped(new Set()); }} className="mt-2 text-sm text-primary-container hover:underline">返回选择其他子类</button>
                  )}
                </div>
              )}
            </div>
            <div className="flex h-1">
              {fields.map((_, fi) => (
                <div key={fi} className={`flex-1 transition-colors duration-300 ${specs[fields[fi]] ? "bg-primary-container" : skipped.has(fields[fi]) ? "bg-on-surface-variant/10" : "bg-outline-variant/10"}`} />
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
          <div className="w-5 h-5 md:w-6 md:h-6 rounded-full border border-current flex items-center justify-center text-[10px] shrink-0">{i + 1}</div>
          <span className="text-xs sm:text-sm">{field}</span>
        </div>
        {hasMore && <div className="w-px h-2 bg-outline-variant/8 ml-5 md:ml-6" />}
      </div>
    );
  });

  /* ── results block (only rendered when !curField) ── */
  const resultsJSX = !curField && (
    <div ref={resultRef}>
      <div className="flex items-center justify-between mt-4 pt-3 border-t border-outline-variant/15">
        <div>
          <h3 className="text-base font-bold text-on-surface">选型结果</h3>
          <p className="text-sm text-on-surface-variant mt-0.5">{filtered.length > 0 ? `匹配到 ${filtered.length} 个型号` : "没有匹配的产品"}</p>
        </div>
        <div className="flex items-center gap-3">
          {filtered.length > 0 && (
            <button onClick={() => handleShare(true)} disabled={sharing} className="text-sm text-primary-container hover:underline shrink-0 inline-flex items-center gap-1 disabled:opacity-50">
              <Icon name="share" size={14} />{sharing ? "生成中..." : "分享结果"}
            </button>
          )}
          {specKeys.length > 0 && <button onClick={restart} className="text-sm text-primary-container hover:underline shrink-0">重新选型</button>}
        </div>
      </div>
      {filtered.length > 0 ? (
        <div className="space-y-3 mt-3 pb-6">
          {filtered.map((p) => (
            <ResultCard key={p.id} product={applyManualSpecs(p, columns, specs)} columns={columns} selected={selectedIds.has(p.id)}
              onToggleSelect={() => toggleSel(p.id)} onInquiry={() => { toggleSel(p.id); setInquiryOpen(true); }} expandedKits={expandedKits} onToggleKit={toggleKit} navigate={navigate} isMobile={!isDesktop} />
          ))}
        </div>
      ) : (
        <div className="text-center py-10">
          <Icon name="search_off" size={36} className="mx-auto mb-2 text-on-surface-variant/20" />
          <p className="text-sm text-on-surface-variant">没有匹配的产品</p>
          <button onClick={restart} className="mt-3 text-sm text-primary-container hover:underline">重新选型</button>
        </div>
      )}
    </div>
  );

  /* ── wizard content: non-wizard-step states (loading / empty / search) ── */
  const wizardContent = isLoading ? (
    <div className="flex items-center justify-center py-20">
      <Icon name="progress_activity" size={28} className="text-on-surface-variant/30 animate-spin" />
      <span className="ml-3 text-sm text-on-surface-variant">加载产品数据...</span>
    </div>
  ) : !liveCat || all.length === 0 ? (
    <div className="text-center py-16">
      <Icon name="inventory_2" size={40} className="mx-auto mb-3 text-on-surface-variant/20" />
      <p className="text-sm text-on-surface">当前分类暂无产品数据</p>
      <button onClick={() => { setSlug(null); setSpecs({}); setManualDrafts({}); setSkipped(new Set()); }}
        className="mt-3 text-sm text-primary-container hover:underline">返回选择其他子类</button>
      {user?.role === "ADMIN" && (
        <Link to="/admin/selections" className="mt-3 ml-4 inline-flex items-center gap-1 text-xs text-primary-container hover:underline"><Icon name="tune" size={14} />前往管理</Link>
      )}
    </div>
  ) : search ? (
    <div className="px-4 md:px-6 py-4 md:py-6">
      {pageHeader}
      {filtered.length > 0 ? (
        <div className="space-y-3 pb-4">
          {filtered.map((p) => (
            <ResultCard key={p.id} product={applyManualSpecs(p, columns, specs)} columns={columns} selected={selectedIds.has(p.id)}
              onToggleSelect={() => toggleSel(p.id)} onInquiry={() => { toggleSel(p.id); setInquiryOpen(true); }} expandedKits={expandedKits} onToggleKit={toggleKit} navigate={navigate} isMobile={!isDesktop} />
          ))}
        </div>
      ) : (
        <div className="text-center py-12">
          <Icon name="search_off" size={36} className="mx-auto mb-2 text-on-surface-variant/20" />
          <p className="text-sm text-on-surface-variant">未找到匹配的产品</p>
        </div>
      )}
    </div>
  ) : null; /* wizard steps + results rendered separately via stepsJSX / resultsJSX */

  /* ── batch action bar ── */
  const actionBar = selectedIds.size > 0 && (
    <div
      className="shrink-0 border-t border-outline-variant/15 bg-surface/95 backdrop-blur-sm px-3 md:px-4 py-2.5 flex items-center justify-between z-10"
      style={!isDesktop ? { marginBottom: "calc(3.5rem + env(safe-area-inset-bottom, 0px))" } : undefined}
    >
      <span className="text-sm text-on-surface-variant">已选 <strong className="text-on-surface">{selectedIds.size}</strong> 项</span>
      <div className="flex gap-2">
        <button onClick={() => setSelectedIds(new Set())} className="px-3 py-1.5 text-xs text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors">取消</button>
        <button onClick={() => setInquiryOpen(true)} className="px-4 py-1.5 text-sm font-bold bg-primary-container text-on-primary rounded-lg hover:opacity-90 transition-opacity">一键询价</button>
      </div>
    </div>
  );

  /* ══════════ Desktop Layout ══════════ */
  if (isDesktop) {
    return (
      <div className="flex flex-col h-dvh overflow-hidden">
        <TopNav />
        <div className="flex flex-1 overflow-hidden">
          <AppSidebar />
          <div className="flex min-w-0 flex-1 flex-col bg-surface">
            <div ref={scrollContainerRef} className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
              {phase === "group" && groupContent}
              {phase === "sub" && subContent}
              {phase === "wizard" && (wizardContent || (
                <div className="px-4 md:px-6 py-4 md:py-6">
                  {pageHeader}
                  <div className="space-y-0">
                    {stepsJSX}
                    {resultsJSX}
                  </div>
                </div>
              ))}
            </div>
            {actionBar}
          </div>
        </div>
        <InquiryDialog open={inquiryOpen} onClose={() => setInquiryOpen(false)} products={selectedProds} />
      </div>
    );
  }

  /* ══════════ Mobile Layout ══════════ */
  return (
    <div className="flex flex-col h-dvh bg-surface">
      <TopNav compact onMenuToggle={() => setNavOpen(true)} />
      <MobileNavDrawer open={navOpen} onClose={() => setNavOpen(false)} />

      {/* Main scroll area */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
        {/* sticky selected params bar */}
        {phase === "wizard" && specKeys.length > 0 && !search && (
          <div className="sticky top-0 z-10 bg-surface/95 backdrop-blur-sm border-b border-outline-variant/10 px-3 py-1.5 flex items-center gap-1.5 overflow-x-auto scrollbar-none">
            {specKeys.map((k) => (
              <button key={k} onClick={() => dropVal(k)}
                className="inline-flex items-center gap-1 rounded-full bg-primary-container/10 px-2 py-0.5 text-xs text-primary-container hover:bg-primary-container/20 transition-colors whitespace-nowrap shrink-0">
                <span className="text-on-surface-variant/60">{k}:</span>
                <span className="font-medium">{specs[k]}</span>
                <Icon name="close" size={10} className="ml-0.5 opacity-60" />
              </button>
            ))}
            <button onClick={() => { setSpecs({}); setManualDrafts({}); setSkipped(new Set()); }} className="text-xs text-on-surface-variant hover:text-primary-container transition-colors shrink-0 ml-1">重置</button>
          </div>
        )}

        {phase === "group" && groupContent}
        {phase === "sub" && subContent}
        {phase === "wizard" && (wizardContent || (
          /* mobile: steps + results in one scrollable area */
          <div className="px-4 py-4">
            {pageHeader}
            <div className="space-y-0">
              {stepsJSX}
              {resultsJSX}
            </div>
            {selectedIds.size > 0 && <div className="h-14" />}
            <div className="h-4" />
          </div>
        ))}

        {/* BottomNav clearance */}
        <div className="h-16" />
      </main>

      {actionBar}
      <BottomNav />
      <InquiryDialog open={inquiryOpen} onClose={() => setInquiryOpen(false)} products={selectedProds} />
    </div>
  );
}
