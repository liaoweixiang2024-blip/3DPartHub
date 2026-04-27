import { useState, useMemo, useEffect, useRef } from "react";
import useSWR from "swr";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { smartSortOptions } from "../lib/selectionSort";
import { useMediaQuery } from "../layouts/hooks/useMediaQuery";
import TopNav from "../components/shared/TopNav";
import BottomNav from "../components/shared/BottomNav";
import AppSidebar from "../components/shared/Sidebar";
import MobileNavDrawer from "../components/shared/MobileNavDrawer";
import Icon from "../components/shared/Icon";
import SafeImage from "../components/shared/SafeImage";
import { useToast } from "../components/shared/Toast";
import {
  getSelectionCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  createProduct,
  updateProduct,
  deleteProduct,
  batchImportProducts,
  uploadOptionImage,
  uploadOptionImageFromUrl,
  renameOptionValue,
  sortCategories,
  type SelectionCategory,
  type SelectionProduct,
  type SelectionComponent,
  type ColumnDef,
} from "../api/selections";

type Tab = "categories" | "products";

function getApiErrorMessage(err: unknown, fallback: string) {
  const data = (err as any)?.response?.data;
  return data?.detail || data?.message || (err as Error)?.message || fallback;
}

// ========== Column Editor ==========
function ColumnEditor({ columns, onChange }: { columns: ColumnDef[]; onChange: (cols: ColumnDef[]) => void }) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  function addColumn() {
    onChange([...columns, { key: `col_${columns.length}`, label: "", unit: "" }]);
  }
  function updateCol(i: number, field: keyof ColumnDef, value: string) {
    const next = [...columns];
    next[i] = { ...next[i], [field]: value };
    if (field === "key") next[i] = { ...next[i], key: value.replace(/\s+/g, "_").toLowerCase() };
    onChange(next);
  }
  function removeCol(i: number) {
    onChange(columns.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-bold text-on-surface-variant">参数列定义</label>
        <button onClick={addColumn} className="text-xs text-primary-container hover:underline">+ 添加列</button>
      </div>
      {columns.map((col, i) => (
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
          className={`flex items-center gap-1.5 rounded transition-opacity ${dragIdx === i ? "opacity-40" : ""}`}
        >
          <span className="cursor-grab active:cursor-grabbing text-on-surface-variant/40 shrink-0 select-none px-0.5">⠿</span>
          <input
            value={col.key}
            onChange={(e) => updateCol(i, "key", e.target.value)}
            placeholder="字段名 (key)"
            className="flex-1 bg-surface-container-lowest text-on-surface text-xs rounded px-2 py-1.5 border border-outline-variant/20 outline-none focus:border-primary-container"
          />
          <input
            value={col.label}
            onChange={(e) => updateCol(i, "label", e.target.value)}
            placeholder="显示名"
            className="flex-1 bg-surface-container-lowest text-on-surface text-xs rounded px-2 py-1.5 border border-outline-variant/20 outline-none focus:border-primary-container"
          />
          <input
            value={col.unit}
            onChange={(e) => updateCol(i, "unit", e.target.value)}
            placeholder="单位"
            className="w-16 bg-surface-container-lowest text-on-surface text-xs rounded px-2 py-1.5 border border-outline-variant/20 outline-none focus:border-primary-container"
          />
          <button onClick={() => removeCol(i)} className="text-error/70 hover:text-error shrink-0">
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ========== Content ==========
function Content() {
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("categories");
  const [catFilter, setCatFilter] = useState<"all" | "empty">("all");

  // Category state
  const [showCatModal, setShowCatModal] = useState(false);
  const [editCat, setEditCat] = useState<SelectionCategory | null>(null);
  const [catForm, setCatForm] = useState({ name: "", slug: "", description: "", icon: "", image: "", columns: [] as ColumnDef[] });
  const [deleteCatId, setDeleteCatId] = useState<string | null>(null);
  const [showCatSortModal, setShowCatSortModal] = useState(false);
  const [catSortItems, setCatSortItems] = useState<{ id: string; name: string }[]>([]);
  const [catSortDragIdx, setCatSortDragIdx] = useState<number | null>(null);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [groupItems, setGroupItems] = useState<{ id: string; name: string; icon: string; image: string; imageFit: "cover" | "contain"; catCount: number }[]>([]);
  const [groupForm, setGroupForm] = useState({ name: "", icon: "category", image: "", imageFit: "cover" as "cover" | "contain" });
  const [groupDragIdx, setGroupDragIdx] = useState<number | null>(null);
  const [manageGroupCatsId, setManageGroupCatsId] = useState<string | null>(null);
  const groupCoverInputRef = useRef<HTMLInputElement | null>(null);

  // Product state
  const [selectedCatId, setSelectedCatId] = useState<string>("");
  const [showProdModal, setShowProdModal] = useState(false);
  const [editProd, setEditProd] = useState<SelectionProduct | null>(null);
  const [prodForm, setProdForm] = useState({
    name: "",
    modelNo: "",
    specs: {} as Record<string, string>,
    image: "",
    pdfUrl: "",
    isKit: false,
    components: [] as SelectionComponent[],
  });
  const [deleteProdId, setDeleteProdId] = useState<string | null>(null);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchParsed, setBatchParsed] = useState<any[] | null>(null);
  const [batchErrors, setBatchErrors] = useState<string[]>([]);
  const [batchImporting, setBatchImporting] = useState(false);
  const [showOptImgModal, setShowOptImgModal] = useState(false);
  const [optImgField, setOptImgField] = useState<string>("");
  const [uploadingVal, setUploadingVal] = useState<string | null>(null);
  const [editOptVal, setEditOptVal] = useState<string | null>(null);

  const [renameField, setRenameField] = useState<string>("");
  const [renameOldVal, setRenameOldVal] = useState<string>("");
  const [renameNewVal, setRenameNewVal] = useState<string>("");
  const [renaming, setRenaming] = useState(false);

  // Lock body scroll when settings modal or sub-dialog is open
  useEffect(() => {
    if (showOptImgModal || editOptVal || renameOldVal) {
      const y = window.scrollY;
      document.body.style.position = "fixed";
      document.body.style.top = `-${y}px`;
      document.body.style.width = "100%";
      return () => {
        document.body.style.position = "";
        document.body.style.top = "";
        document.body.style.width = "";
        window.scrollTo(0, y);
      };
    }
  }, [showOptImgModal, editOptVal, renameOldVal]);
  const [orderItems, setOrderItems] = useState<string[]>([]);
  const [orderDragIdx, setOrderDragIdx] = useState<number | null>(null);
  const [optViewMode, setOptViewMode] = useState<"grid" | "list">("grid");

  const { data: categories = [], mutate: mutateCats } = useSWR("selections/categories", getSelectionCategories);

  // Products for selected category
  const { data: productsData, mutate: mutateProds } = useSWR(
    selectedCatId ? `selections/admin/products/${selectedCatId}` : null,
    async () => {
      const cat = categories.find((c) => c.id === selectedCatId);
      if (!cat) return null;
      const { default: client } = await import("../api/client");
      const { data: resp } = await client.get(`/selections/categories/${cat.slug}/products`, { params: { page_size: 5000 } });
      const d = (resp as any)?.data ?? resp;
      return d as { items: SelectionProduct[] };
    }
  );

  const products = useMemo(() => productsData?.items ?? [], [productsData]);
  const [prodSearch, setProdSearch] = useState("");
  const filteredProducts = useMemo(() => {
    if (!prodSearch) return products;
    const q = prodSearch.toLowerCase();
    return products.filter((p) =>
      (p.name || "").toLowerCase().includes(q) ||
      (p.modelNo || "").toLowerCase().includes(q) ||
      Object.values(p.specs as Record<string, string>).some((v) => v.toLowerCase().includes(q))
    );
  }, [products, prodSearch]);

  // ---- Category handlers ----
  function openNewCat() {
    setEditCat(null);
    setCatForm({ name: "", slug: "", description: "", icon: "", image: "", columns: [] });
    setShowCatModal(true);
  }
  function openEditCat(cat: SelectionCategory) {
    setEditCat(cat);
    setCatForm({ name: cat.name, slug: cat.slug, description: cat.description || "", icon: cat.icon || "", image: cat.image || "", columns: cat.columns as ColumnDef[] });
    setShowCatModal(true);
  }
  async function saveCat() {
    try {
      if (editCat) {
        await updateCategory(editCat.id, catForm);
        toast("分类已更新", "success");
      } else {
        await createCategory(catForm);
        toast("分类已创建", "success");
      }
      setShowCatModal(false);
      mutateCats();
    } catch (err: any) {
      toast(err.response?.data?.detail || "操作失败", "error");
    }
  }
  async function handleDeleteCat(id: string) {
    try {
      await deleteCategory(id);
      toast("分类已删除", "success");
      setDeleteCatId(null);
      if (selectedCatId === id) setSelectedCatId("");
      mutateCats();
    } catch (err: any) {
      toast(err.response?.data?.detail || "删除失败", "error");
    }
  }

  // ---- Product handlers ----
  const activeCat = categories.find((c) => c.id === selectedCatId);
  const productColumns = (activeCat?.columns as ColumnDef[]) || [];

  function openNewProd() {
    if (!selectedCatId) { toast("请先选择分类", "error"); return; }
    setEditProd(null);
    setProdForm({ name: "", modelNo: "", specs: {}, image: "", pdfUrl: "", isKit: false, components: [] });
    setShowProdModal(true);
  }
  function openEditProd(prod: SelectionProduct) {
    setEditProd(prod);
    setProdForm({
      name: prod.name,
      modelNo: prod.modelNo || "",
      specs: { ...(prod.specs as Record<string, string>) },
      image: prod.image || "",
      pdfUrl: prod.pdfUrl || "",
      isKit: prod.isKit ?? false,
      components: (prod.components as SelectionComponent[]) ?? [],
    });
    setShowProdModal(true);
  }
  async function saveProd() {
    try {
      const payload = {
        name: prodForm.name,
        modelNo: prodForm.modelNo || undefined,
        specs: prodForm.specs,
        image: prodForm.image || undefined,
        pdfUrl: prodForm.pdfUrl || undefined,
        isKit: prodForm.isKit,
        components: prodForm.isKit && prodForm.components.length > 0 ? prodForm.components : undefined,
      };
      if (editProd) {
        await updateProduct(editProd.id, payload);
        toast("产品已更新", "success");
      } else {
        await createProduct({ categoryId: selectedCatId, ...payload });
        toast("产品已创建", "success");
      }
      setShowProdModal(false);
      mutateProds();
    } catch (err: any) {
      toast(err.response?.data?.detail || "操作失败", "error");
    }
  }
  async function handleDeleteProd(id: string) {
    try {
      await deleteProduct(id);
      toast("产品已删除", "success");
      setDeleteProdId(null);
      mutateProds();
    } catch (err: any) {
      toast(err.response?.data?.detail || "删除失败", "error");
    }
  }
  async function handleBatchImport() {
    if (!batchParsed || batchParsed.length === 0) return;
    setBatchImporting(true);
    try {
      const { created, updated } = await batchImportProducts(selectedCatId, batchParsed);
      const msg = updated > 0
        ? `导入完成：新增 ${created} 个，更新 ${updated} 个`
        : `成功导入 ${created} 个产品`;
      toast(msg, "success");
      setShowBatchModal(false);
      setBatchParsed(null);
      setBatchErrors([]);
      mutateProds();
      mutateCats();
    } catch (err: any) {
      toast(err.message || "导入失败", "error");
    } finally {
      setBatchImporting(false);
    }
  }

  function handleExcelFile(file: File) {
    setBatchErrors([]);
    setBatchParsed(null);
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(e.target!.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws);
        if (rows.length === 0) {
          setBatchErrors(["文件中没有数据"]);
          return;
        }

        const cols = (activeCat?.columns as ColumnDef[]) || [];
        const colMap = new Map<string, string>(); // label → key
        cols.forEach((c) => { colMap.set(c.label || c.key, c.key); });

        const errors: string[] = [];
        const parsed: any[] = [];

        rows.forEach((row, i) => {
          const specs: Record<string, string> = {};
          let name = "";
          for (const [header, val] of Object.entries(row)) {
            const key = colMap.get(header);
            if (key) {
              specs[key] = String(val ?? "");
              // Use the first column as name fallback
              if (!name) name = String(val ?? "");
            } else if (header === "图片") {
              // skip, handled below
            } else if (header === "PDF链接") {
              // skip
            } else if (header === "是否套件") {
              // skip
            } else if (header === "组件(JSON)") {
              // skip
            }
          }

          // Build product object
          const product: any = {
            name: row["名称"] || row["型号"] || name || `产品 ${i + 1}`,
            modelNo: row["型号"] || row["modelNo"] || "",
            specs,
            image: row["图片"] || "",
            pdfUrl: row["PDF链接"] || "",
          };

          const isKitVal = row["是否套件"];
          if (isKitVal === "是" || isKitVal === "true" || isKitVal === "1") {
            product.isKit = true;
          }

          const compStr = row["组件(JSON)"];
          if (compStr && typeof compStr === "string" && compStr.trim()) {
            try {
              product.components = JSON.parse(compStr);
            } catch {
              errors.push(`第 ${i + 2} 行：组件 JSON 解析失败`);
            }
          }

          if (!product.modelNo && cols.length > 0) {
            // Use first spec value as modelNo fallback
            const firstKey = cols[0].key;
            product.modelNo = specs[firstKey] || "";
          }

          parsed.push(product);
        });

        if (errors.length > 0) setBatchErrors(errors);
        setBatchParsed(parsed);
      } catch {
        setBatchErrors(["文件解析失败，请确认是有效的 Excel 文件"]);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // ---- Option Image handlers ----
  const optImages = (activeCat?.optionImages ?? {}) as Record<string, Record<string, string>>;

  // Extract unique option values per field from product data
  const fieldOptions = useMemo(() => {
    if (!activeCat) return {};
    const result: Record<string, string[]> = {};
    for (const col of activeCat.columns) {
      const vals = new Set<string>();
      for (const p of products) {
        const v = (p.specs as Record<string, string>)[col.key];
        if (v) vals.add(v);
      }
      if (vals.size > 0) result[col.key] = Array.from(vals).sort();
    }
    return result;
  }, [activeCat, products]);

  async function uploadOptImg(field: string, val: string, file: File) {
    setUploadingVal(`${field}::${val}`);
    try {
      const { url } = await uploadOptionImage(file);
      const updated = { ...optImages, [field]: { ...(optImages[field] || {}), [val]: url } };
      await updateCategory(activeCat!.id, { optionImages: updated });
      mutateCats();
      toast("图片已上传", "success");
    } catch {
      toast("上传失败", "error");
    } finally {
      setUploadingVal(null);
    }
  }

  async function removeOptImg(field: string, val: string) {
    const updated = { ...optImages };
    if (updated[field]) {
      delete updated[field][val];
      if (Object.keys(updated[field]).length === 0) delete updated[field];
    }
    await updateCategory(activeCat!.id, { optionImages: updated });
    mutateCats();
    toast("图片已移除", "success");
  }

  async function handlePaste(e: React.ClipboardEvent) {
    if (!optImgField) return;
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) await uploadOptImg(optImgField, "__pasting__", file);
        return;
      }
    }
    // No image — check for URL text
    const text = e.clipboardData.getData("text/plain")?.trim();
    if (text && /^https?:\/\/.+/i.test(text)) {
      e.preventDefault();
      toast("正在下载图片...", "info");
      try {
        const { url } = await uploadOptionImageFromUrl(text);
        const updated = { ...optImages, [optImgField]: { ...(optImages[optImgField] || {}), ["__pasting__"]: url } };
        await updateCategory(activeCat!.id, { optionImages: updated });
        mutateCats();
        toast("图片已下载并保存", "success");
      } catch {
        toast("下载图片失败，请检查链接", "error");
      }
    }
  }
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg md:text-2xl md:font-headline md:font-bold md:tracking-tight md:uppercase font-bold text-on-surface">选型管理</h1>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {(() => {
          const totalCats = categories.length;
          const totalProducts = categories.reduce((s, c) => s + (c.productCount || 0), 0);
          const catsWithProducts = categories.filter((c) => (c.productCount || 0) > 0).length;
          const emptyCats = totalCats - catsWithProducts;
          const stats = [
            { label: "总分类", value: totalCats, icon: "category", color: "text-primary-container", action: () => { setCatFilter("all"); setTab("categories"); } },
            { label: "总产品", value: totalProducts, icon: "inventory_2", color: "text-primary-container", action: () => { setCatFilter("all"); setTab("products"); } },
            { label: "有产品分类", value: catsWithProducts, icon: "check_circle", color: "text-green-600", action: () => { setCatFilter("all"); setTab("categories"); } },
            { label: "空分类", value: emptyCats, icon: emptyCats > 0 ? "warning" : "check_circle", color: emptyCats > 0 ? "text-amber-500" : "text-green-600", action: () => { setCatFilter("empty"); setTab("categories"); } },
          ];
          return stats.map((s) => (
            <button key={s.label} onClick={s.action} className="flex items-center gap-2 bg-surface-container-low rounded-lg px-3 py-2 border border-outline-variant/10 hover:bg-surface-container-high hover:border-outline-variant/30 transition-colors text-left">
              <Icon name={s.icon} size={18} className={s.color} />
              <div>
                <div className="text-lg font-bold text-on-surface leading-tight">{s.value}</div>
                <div className="text-[10px] text-on-surface-variant">{s.label}</div>
              </div>
            </button>
          ));
        })()}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-outline-variant/20">
        {(["categories", "products"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setCatFilter("all"); }}
            className={`px-4 py-2 text-sm font-bold transition-colors ${
              tab === t
                ? "text-primary-container border-b-2 border-primary-container"
                : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            {t === "categories" ? "分类管理" : "产品管理"}
          </button>
        ))}
      </div>

      {/* ===== Categories Tab ===== */}
      {tab === "categories" && (
        <div className="space-y-3">
          <div className="flex justify-end gap-2">
            <button onClick={() => {
              const map = new Map<string, { id: string; name: string; icon: string; image: string; imageFit: "cover" | "contain"; catCount: number }>();
              for (const c of categories) {
                if (c.groupId && c.groupName) {
                  if (!map.has(c.groupId)) {
                    map.set(c.groupId, { id: c.groupId, name: c.groupName, icon: c.groupIcon || "category", image: c.groupImage || "", imageFit: c.groupImageFit === "contain" ? "contain" : "cover", catCount: 0 });
                  } else if (!map.get(c.groupId)!.image && c.groupImage) {
                    map.get(c.groupId)!.image = c.groupImage;
                    map.get(c.groupId)!.imageFit = c.groupImageFit === "contain" ? "contain" : "cover";
                  }
                  map.get(c.groupId)!.catCount++;
                }
              }
              setGroupItems(Array.from(map.values()));
              setGroupForm({ name: "", icon: "category", image: "", imageFit: "cover" });
              setShowGroupModal(true);
            }} className="px-3 py-1.5 text-xs font-bold bg-surface-container-high text-on-surface rounded-md hover:opacity-90 flex items-center gap-1">
              <Icon name="folder" size={14} /> 分组管理
            </button>
            <button onClick={() => { setCatSortItems(categories.map((c) => ({ id: c.id, name: c.name }))); setShowCatSortModal(true); }} className="px-3 py-1.5 text-xs font-bold bg-surface-container-high text-on-surface rounded-md hover:opacity-90 flex items-center gap-1">
              <Icon name="reorder" size={14} /> 排序
            </button>
            <button onClick={openNewCat} className="px-3 py-1.5 text-xs font-bold bg-primary-container text-on-primary rounded-md hover:opacity-90 transition-opacity flex items-center gap-1">
              <Icon name="add" size={14} /> 新建分类
            </button>
          </div>
          {catFilter === "empty" && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <Icon name="warning" size={14} className="text-amber-500 shrink-0" />
              <span className="text-xs text-on-surface">仅显示空分类（无产品的分类）</span>
              <button onClick={() => setCatFilter("all")} className="text-xs text-primary-container hover:underline ml-auto shrink-0">显示全部</button>
            </div>
          )}
          {(() => {
            const filtered = catFilter === "empty" ? categories.filter((c) => !(c.productCount || 0)) : categories;
            if (filtered.length === 0) return (
              <div className="text-center py-12 text-on-surface-variant">
                <Icon name="category" size={40} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">{catFilter === "empty" ? "没有空分类" : "暂无分类"}</p>
              </div>
            );
            return filtered.map((cat) => (
              <div key={cat.id} className="bg-surface-container-low rounded-md border border-outline-variant/10 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Icon name={cat.icon || "category"} size={16} className="text-primary-container shrink-0" />
                      <span className="font-bold text-sm text-on-surface truncate">{cat.name}</span>
                      <span className="text-[10px] text-on-surface-variant">/{cat.slug}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[10px] text-on-surface-variant/70">
                      <span>{(cat.columns as ColumnDef[]).length} 个参数列</span>
                      <span>{cat.productCount ?? 0} 个产品</span>
                      <span>排序: {cat.sortOrder}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => openEditCat(cat)} className="px-2 py-1 text-xs text-primary-container hover:bg-primary-container/10 rounded" title="编辑">
                      <Icon name="edit" size={14} />
                    </button>
                    {deleteCatId === cat.id ? (
                      <>
                        <button onClick={() => handleDeleteCat(cat.id)} className="px-2 py-1 text-[10px] font-medium bg-error text-on-error-container rounded">确认</button>
                        <button onClick={() => setDeleteCatId(null)} className="px-2 py-1 text-[10px] text-on-surface-variant hover:bg-surface-container-high/50 rounded">取消</button>
                      </>
                    ) : (
                      <button onClick={() => setDeleteCatId(cat.id)} className="px-2 py-1 text-xs text-error hover:bg-error-container/10 rounded" title="删除">
                        <Icon name="delete" size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ));
          })()}
        </div>
      )}

      {/* ===== Products Tab ===== */}
      {tab === "products" && (
        <div className="space-y-3">
          {/* Category selector */}
          <div className="space-y-2 md:flex md:items-center md:gap-3 md:space-y-0">
            <select
              value={selectedCatId}
              onChange={(e) => { setSelectedCatId(e.target.value); setProdSearch(""); }}
              className="w-full md:flex-1 bg-surface-container-lowest text-on-surface text-sm rounded-md px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container"
            >
              <option value="">选择分类...</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {selectedCatId && activeCat && (
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap md:shrink-0">
                <button onClick={openNewProd} className="px-3 py-2 text-xs font-bold bg-primary-container text-on-primary rounded-md hover:opacity-90 flex items-center justify-center gap-1 whitespace-nowrap">
                  <Icon name="add" size={14} /> 新建
                </button>
                <button onClick={() => setShowBatchModal(true)} className="px-3 py-2 text-xs font-bold bg-surface-container-high text-on-surface rounded-md hover:opacity-90 flex items-center justify-center gap-1 whitespace-nowrap">
                  <Icon name="upload" size={14} /> 批量导入
                </button>
                <button
                  onClick={async () => {
                    if (!products.length) { toast("没有可导出的产品", "error"); return; }
                    const XLSX = await import("xlsx");
                    const cols = productColumns;
                    const headers = cols.map((c) => c.label || c.key);
                    const extraHeaders = ["图片", "PDF链接", "是否套件", "组件(JSON)"];
                    const rows = products.map((p) => {
                      const specs = p.specs as Record<string, string>;
                      const baseRow: Record<string, string> = {};
                      cols.forEach((c) => { baseRow[c.label || c.key] = specs[c.key] ?? ""; });
                      baseRow["图片"] = p.image ?? "";
                      baseRow["PDF链接"] = p.pdfUrl ?? "";
                      baseRow["是否套件"] = p.isKit ? "是" : "否";
                      baseRow["组件(JSON)"] = p.components ? JSON.stringify(p.components) : "";
                      return baseRow;
                    });
                    const ws = XLSX.utils.json_to_sheet(rows, { header: [...headers, ...extraHeaders] });
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, "产品");
                    XLSX.writeFile(wb, `${activeCat?.slug || "products"}_products.xlsx`);
                    toast(`已导出 ${products.length} 个产品`, "success");
                  }}
                  className="px-3 py-2 text-xs font-bold bg-surface-container-high text-on-surface rounded-md hover:opacity-90 flex items-center justify-center gap-1 whitespace-nowrap"
                >
                  <Icon name="download" size={14} /> 导出
                </button>
                <button onClick={() => { setOptImgField(""); setOrderItems([]); setShowOptImgModal(true); }} className="px-3 py-2 text-xs font-bold bg-surface-container-high text-on-surface rounded-md hover:opacity-90 flex items-center justify-center gap-1 whitespace-nowrap">
                  <Icon name="settings" size={14} /> 选项设置
                </button>
              </div>
            )}
          </div>

          {selectedCatId && activeCat && (
            <>
              {/* Search bar */}
              {products.length > 0 && (
                <div className="relative">
                  <Icon name="search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
                  <input
                    value={prodSearch}
                    onChange={(e) => setProdSearch(e.target.value)}
                    placeholder="搜索产品名称、型号、参数值..."
                    className="w-full bg-surface-container-lowest text-on-surface text-sm rounded-md pl-9 pr-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container placeholder:text-on-surface-variant/40"
                  />
                  {prodSearch && (
                    <button onClick={() => setProdSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant/50 hover:text-on-surface">
                      <Icon name="close" size={14} />
                    </button>
                  )}
                </div>
              )}
              {/* Products table */}
              {products.length === 0 ? (
                <div className="text-center py-12 text-on-surface-variant">
                  <Icon name="inventory_2" size={40} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">暂无产品</p>
                </div>
              ) : (
                <>
                  {prodSearch && (
                    <p className="text-xs text-on-surface-variant">
                      搜索 "<span className="text-on-surface font-medium">{prodSearch}</span>" 匹配 {filteredProducts.length} / {products.length} 个产品
                    </p>
                  )}
                  {filteredProducts.length === 0 ? (
                    <div className="text-center py-12 text-on-surface-variant">
                      <Icon name="search_off" size={40} className="mx-auto mb-2 opacity-30" />
                      <p className="text-sm">未找到匹配的产品</p>
                    </div>
                  ) : (
                    <>
                      <div className="md:hidden space-y-2">
                        {filteredProducts.map((p) => {
                          const specs = (p.specs as Record<string, string>) || {};
                          const modelColumn = productColumns.find((col) => col.key === "型号" || col.label === "型号");
                          const title = p.modelNo || (modelColumn ? specs[modelColumn.key] : "") || p.name || "未命名产品";
                          const subtitle = p.name && p.name !== title ? p.name : "";
                          const displayColumns = productColumns
                            .filter((col) => col.key !== modelColumn?.key)
                            .slice(0, 6);

                          return (
                            <div key={p.id} className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-3 shadow-sm">
                              <div className="flex items-start gap-2">
                                <div className="min-w-0 flex-1">
                                  <div className="text-sm font-bold leading-snug text-on-surface break-words">{title}</div>
                                  {subtitle && <div className="mt-0.5 text-xs leading-snug text-on-surface-variant break-words">{subtitle}</div>}
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                  <button onClick={() => openEditProd(p)} className="grid h-8 w-8 place-items-center text-primary-container hover:bg-primary-container/10 rounded" title="编辑">
                                    <Icon name="edit" size={14} />
                                  </button>
                                  {deleteProdId === p.id ? (
                                    <>
                                      <button onClick={() => handleDeleteProd(p.id)} className="h-8 px-2 text-[10px] font-bold bg-error text-on-error-container rounded">确认</button>
                                      <button onClick={() => setDeleteProdId(null)} className="h-8 px-2 text-[10px] text-on-surface-variant bg-surface-container-high rounded">取消</button>
                                    </>
                                  ) : (
                                    <button onClick={() => setDeleteProdId(p.id)} className="grid h-8 w-8 place-items-center text-error hover:bg-error-container/10 rounded" title="删除">
                                      <Icon name="delete" size={14} />
                                    </button>
                                  )}
                                </div>
                              </div>
                              <div className="mt-3 grid grid-cols-2 gap-2">
                                {displayColumns.map((col) => (
                                  <div key={col.key} className="min-w-0 rounded-lg bg-surface-container-lowest px-2 py-1.5">
                                    <div className="truncate text-[10px] leading-tight text-on-surface-variant">
                                      {col.label || col.key}{col.unit ? ` (${col.unit})` : ""}
                                    </div>
                                    <div className="mt-0.5 text-xs font-medium leading-snug text-on-surface break-words line-clamp-2">
                                      {specs[col.key] ?? "—"}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="hidden md:block overflow-auto custom-scrollbar rounded-lg border border-outline-variant/10 max-h-[calc(100vh-280px)]">
                        <table className="w-full text-sm">
                          <thead className="sticky top-0 z-10">
                            <tr className="bg-surface-container-low">
                              {productColumns.map((col) => (
                                <th key={col.key} className="px-3 py-2 text-left font-bold text-on-surface-variant whitespace-nowrap text-xs">
                                  {col.label}{col.unit ? ` (${col.unit})` : ""}
                                </th>
                              ))}
                              <th className="px-3 py-2 text-right text-xs">操作</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredProducts.map((p) => (
                              <tr key={p.id} className="border-t border-outline-variant/5 hover:bg-surface-container/50">
                                {productColumns.map((col) => (
                                  <td key={col.key} className="px-3 py-2 text-on-surface whitespace-nowrap">
                                    {(p.specs as Record<string, string>)[col.key] ?? "—"}
                                  </td>
                                ))}
                                <td className="px-3 py-2 text-right">
                                  <div className="flex items-center justify-end gap-1">
                                    <button onClick={() => openEditProd(p)} className="text-primary-container hover:bg-primary-container/10 rounded p-1" title="编辑">
                                      <Icon name="edit" size={13} />
                                    </button>
                                    {deleteProdId === p.id ? (
                                      <>
                                        <button onClick={() => handleDeleteProd(p.id)} className="px-1.5 py-0.5 text-[10px] bg-error text-on-error-container rounded">确认</button>
                                        <button onClick={() => setDeleteProdId(null)} className="px-1.5 py-0.5 text-[10px] text-on-surface-variant">取消</button>
                                      </>
                                    ) : (
                                      <button onClick={() => setDeleteProdId(p.id)} className="text-error hover:bg-error-container/10 rounded p-1" title="删除">
                                        <Icon name="delete" size={13} />
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          )}

          {!selectedCatId && (
            <div className="text-center py-12 text-on-surface-variant">
              <Icon name="touch_app" size={40} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">请先选择一个分类</p>
            </div>
          )}
        </div>
      )}

      {/* ===== Category Modal ===== */}
      {showCatModal && (
        <div className="fixed inset-0 z-[120] bg-black/50 p-0 sm:flex sm:items-center sm:justify-center sm:p-4" onClick={() => setShowCatModal(false)} onPaste={async (e) => {
          for (const item of Array.from(e.clipboardData.items)) {
            if (item.type.startsWith("image/")) {
              e.preventDefault();
              const file = item.getAsFile();
              if (file) {
                try {
                  const { url } = await uploadOptionImage(file);
                  setCatForm(prev => ({ ...prev, image: url }));
                  toast("图片已粘贴上传", "success");
                } catch { toast("上传失败", "error"); }
              }
              return;
            }
          }
          // Check for URL text
          const text = e.clipboardData.getData("text/plain")?.trim();
          if (text && /^https?:\/\/.+/i.test(text)) {
            e.preventDefault();
            toast("正在下载图片...", "info");
            try {
              const { url } = await uploadOptionImageFromUrl(text);
              setCatForm(prev => ({ ...prev, image: url }));
              toast("图片已下载并保存", "success");
            } catch { toast("下载图片失败", "error"); }
          }
        }}>
          <div className="fixed left-3 right-3 top-[max(1rem,env(safe-area-inset-top))] bottom-[max(1rem,env(safe-area-inset-bottom))] flex min-h-0 flex-col bg-surface-container-low rounded-2xl border border-outline-variant/20 p-4 space-y-4 shadow-2xl sm:relative sm:inset-auto sm:w-full sm:max-w-lg sm:max-h-[90dvh] sm:p-5 sm:rounded-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-bold text-on-surface shrink-0">{editCat ? "编辑分类" : "新建分类"}</h2>
            <div className="space-y-3 flex-1 min-h-0 overflow-y-auto pr-0.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-on-surface-variant mb-1 block">名称 *</label>
                  <input value={catForm.name} onChange={(e) => setCatForm({ ...catForm, name: e.target.value })} className="w-full bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container" />
                </div>
                <div>
                  <label className="text-xs text-on-surface-variant mb-1 block">标识 (slug) *</label>
                  <input value={catForm.slug} onChange={(e) => setCatForm({ ...catForm, slug: e.target.value.replace(/\s+/g, "-").toLowerCase() })} className="w-full bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container" />
                </div>
              </div>
              <div>
                <label className="text-xs text-on-surface-variant mb-1 block">描述</label>
                <input value={catForm.description} onChange={(e) => setCatForm({ ...catForm, description: e.target.value })} className="w-full bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container" />
              </div>
              <div>
                <label className="text-xs text-on-surface-variant mb-1 block">所属分组（可选）</label>
                <select
                  value={(() => {
                    const editCatObj = editCat ? categories.find(c => c.id === editCat.id) : null;
                    return editCatObj?.groupId || "";
                  })()}
                  onChange={async (e) => {
                    const gid = e.target.value;
                    if (!gid) {
                      if (editCat) await updateCategory(editCat.id, { groupId: null, groupName: null, groupIcon: null, groupImage: null, groupImageFit: null });
                      toast("已移除分组", "success");
                      mutateCats();
                    } else {
                      const src = categories.find(c => c.groupId === gid);
                      if (editCat) await updateCategory(editCat.id, { groupId: gid, groupName: src?.groupName || "", groupIcon: src?.groupIcon || "", groupImage: src?.groupImage || null, groupImageFit: src?.groupImageFit === "contain" ? "contain" : "cover" });
                      toast("已设置分组", "success");
                      mutateCats();
                    }
                  }}
                  className="w-full bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container"
                >
                  <option value="">不分组</option>
                  {(() => {
                    const groupMap = new Map<string, string>();
                    for (const c of categories) {
                      if (c.groupId && c.groupName && !groupMap.has(c.groupId)) groupMap.set(c.groupId, c.groupName);
                    }
                    return Array.from(groupMap.entries()).map(([id, name]) => (
                      <option key={id} value={id}>{name}</option>
                    ));
                  })()}
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-on-surface-variant mb-1 block">图标名称</label>
                  <input value={catForm.icon} onChange={(e) => setCatForm({ ...catForm, icon: e.target.value })} placeholder="如: tune" className="w-full bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container" />
                </div>
                <div>
                  <label className="text-xs text-on-surface-variant mb-1 block">封面图</label>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <input value={catForm.image} onChange={(e) => setCatForm({ ...catForm, image: e.target.value })} placeholder="URL 或上传" className="w-full sm:flex-1 bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container" />
                    <label className="shrink-0">
                      <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (f) {
                          try {
                            const { url } = await uploadOptionImage(f);
                            setCatForm(prev => ({ ...prev, image: url }));
                          } catch { toast("上传失败", "error"); }
                        }
                        e.target.value = "";
                      }} />
                      <span className="px-2.5 py-2 text-xs text-primary-container hover:underline cursor-pointer border border-outline-variant/20 rounded">上传</span>
                    </label>
                  </div>
                  <p className="text-[10px] text-on-surface-variant mt-0.5">支持截图后 Ctrl+V 粘贴上传</p>
                  {catForm.image && (
                    <div className="mt-2 w-20 h-14 rounded overflow-hidden bg-surface-container-lowest border border-outline-variant/10">
                      <SafeImage src={catForm.image} alt="" className="w-full h-full object-cover" />
                    </div>
                  )}
                </div>
              </div>
              <ColumnEditor columns={catForm.columns} onChange={(columns) => setCatForm({ ...catForm, columns })} />
            </div>
            <div className="grid grid-cols-2 gap-2 shrink-0 pt-2 border-t border-outline-variant/10 sm:flex sm:justify-end">
              <button onClick={() => setShowCatModal(false)} className="px-4 py-2.5 sm:py-2 text-sm text-on-surface-variant bg-surface-container-high/40 hover:bg-surface-container-high rounded-lg sm:rounded">取消</button>
              <button onClick={saveCat} disabled={!catForm.name || !catForm.slug} className="px-4 py-2.5 sm:py-2 text-sm font-bold bg-primary-container text-on-primary rounded-lg sm:rounded hover:opacity-90 disabled:opacity-50">保存</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Product Modal ===== */}
      {showProdModal && activeCat && (
        <div className="fixed inset-0 z-[120] bg-black/50 p-0 sm:flex sm:items-center sm:justify-center sm:p-4" onClick={() => setShowProdModal(false)}>
          <div className="fixed left-3 right-3 top-[max(1rem,env(safe-area-inset-top))] bottom-[max(1rem,env(safe-area-inset-bottom))] flex min-h-0 flex-col bg-surface-container-low rounded-2xl border border-outline-variant/20 p-4 space-y-4 shadow-2xl sm:relative sm:inset-auto sm:w-full sm:max-w-lg sm:max-h-[90dvh] sm:p-5 sm:rounded-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-bold text-on-surface shrink-0">{editProd ? "编辑产品" : "新建产品"}</h2>
            <div className="space-y-3 flex-1 min-h-0 overflow-y-auto pr-0.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-on-surface-variant mb-1 block">名称 *</label>
                  <input value={prodForm.name} onChange={(e) => setProdForm({ ...prodForm, name: e.target.value })} className="w-full bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container" />
                </div>
                <div>
                  <label className="text-xs text-on-surface-variant mb-1 block">型号编号</label>
                  <input value={prodForm.modelNo} onChange={(e) => setProdForm({ ...prodForm, modelNo: e.target.value })} className="w-full bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-on-surface-variant mb-1 block">产品图片 URL</label>
                  <input value={prodForm.image} onChange={(e) => setProdForm({ ...prodForm, image: e.target.value })} placeholder="https://..." className="w-full bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container" />
                </div>
                <div>
                  <label className="text-xs text-on-surface-variant mb-1 block">PDF 规格书 URL</label>
                  <input value={prodForm.pdfUrl} onChange={(e) => setProdForm({ ...prodForm, pdfUrl: e.target.value })} placeholder="https://..." className="w-full bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container" />
                </div>
              </div>
              {(activeCat.columns as ColumnDef[]).map((col) => (
                <div key={col.key}>
                  <label className="text-xs text-on-surface-variant mb-1 block">
                    {col.label}{col.unit ? ` (${col.unit})` : ""}
                  </label>
                  <input
                    value={prodForm.specs[col.key] || ""}
                    onChange={(e) => setProdForm({ ...prodForm, specs: { ...prodForm.specs, [col.key]: e.target.value } })}
                    className="w-full bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container"
                  />
                </div>
              ))}

              {/* Kit / BOM toggle */}
              <div className="border-t border-outline-variant/10 pt-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-on-surface">套件（含子零件）</p>
                    <p className="text-xs text-on-surface-variant">开启后可添加子零件清单</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setProdForm({ ...prodForm, isKit: !prodForm.isKit })}
                    className={`relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0 ${prodForm.isKit ? "bg-primary-container" : "bg-outline-variant/30"}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${prodForm.isKit ? "translate-x-5" : "translate-x-0"}`} />
                  </button>
                </div>

                {prodForm.isKit && (
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-on-surface-variant">子零件清单</span>
                      <button
                        type="button"
                        onClick={() => setProdForm({
                          ...prodForm,
                          components: [...prodForm.components, { name: "", modelNo: "", qty: 1, specs: {} }],
                        })}
                        className="text-xs text-primary-container hover:underline"
                      >
                        + 添加子零件
                      </button>
                    </div>
                    {prodForm.components.map((comp, i) => (
                      <div key={i} className="flex items-start gap-2 bg-surface-container-high/50 rounded-lg p-2">
                        <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <input
                            value={comp.name}
                            onChange={(e) => {
                              const next = [...prodForm.components];
                              next[i] = { ...next[i], name: e.target.value };
                              setProdForm({ ...prodForm, components: next });
                            }}
                            placeholder="零件名"
                            className="bg-surface-container-lowest text-on-surface text-xs rounded px-2 py-1.5 border border-outline-variant/20 outline-none focus:border-primary-container"
                          />
                          <input
                            value={comp.modelNo || ""}
                            onChange={(e) => {
                              const next = [...prodForm.components];
                              next[i] = { ...next[i], modelNo: e.target.value };
                              setProdForm({ ...prodForm, components: next });
                            }}
                            placeholder="型号"
                            className="bg-surface-container-lowest text-on-surface text-xs rounded px-2 py-1.5 border border-outline-variant/20 outline-none focus:border-primary-container"
                          />
                          <input
                            type="number"
                            min={1}
                            value={comp.qty}
                            onChange={(e) => {
                              const next = [...prodForm.components];
                              next[i] = { ...next[i], qty: Math.max(1, parseInt(e.target.value) || 1) };
                              setProdForm({ ...prodForm, components: next });
                            }}
                            placeholder="数量"
                            className="bg-surface-container-lowest text-on-surface text-xs rounded px-2 py-1.5 border border-outline-variant/20 outline-none focus:border-primary-container"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => setProdForm({ ...prodForm, components: prodForm.components.filter((_, idx) => idx !== i) })}
                          className="text-error/70 hover:text-error shrink-0 mt-1"
                        >
                          <Icon name="close" size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 shrink-0 pt-2 border-t border-outline-variant/10 sm:flex sm:justify-end">
              <button onClick={() => setShowProdModal(false)} className="px-4 py-2.5 sm:py-2 text-sm text-on-surface-variant bg-surface-container-high/40 hover:bg-surface-container-high rounded-lg sm:rounded">取消</button>
              <button onClick={saveProd} disabled={!prodForm.name} className="px-4 py-2.5 sm:py-2 text-sm font-bold bg-primary-container text-on-primary rounded-lg sm:rounded hover:opacity-90 disabled:opacity-50">保存</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Unified Option Settings Modal ===== */}
      {showOptImgModal && activeCat && (
        <div className="fixed inset-0 z-[120] bg-black/50 p-0 sm:flex sm:items-center sm:justify-center sm:p-4" onClick={() => setShowOptImgModal(false)} onPaste={handlePaste}>
          <div className="fixed left-3 right-3 top-[max(1rem,env(safe-area-inset-top))] bottom-[max(1rem,env(safe-area-inset-bottom))] max-w-none bg-surface-container-low rounded-2xl border border-outline-variant/20 p-3 space-y-3 flex min-h-0 flex-col overflow-hidden shadow-2xl sm:relative sm:inset-auto sm:w-full sm:max-w-2xl sm:max-h-[90dvh] sm:p-5 sm:space-y-4 sm:rounded-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 shrink-0 pb-2 border-b border-outline-variant/10 sm:pb-0 sm:border-b-0">
              <div className="min-w-0">
                <h2 className="text-base font-bold text-on-surface leading-snug">选项设置</h2>
                <p className="mt-0.5 text-xs text-on-surface-variant truncate">{activeCat.name}</p>
              </div>
              <button onClick={() => setShowOptImgModal(false)} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"><Icon name="close" size={18} /></button>
            </div>
            <p className="hidden sm:block text-xs leading-relaxed text-on-surface-variant shrink-0">拖拽调整顺序，点击图片上传/更换，点击编辑图标修改名称。</p>

            {/* Field selector + view toggle */}
            <div className="grid grid-cols-1 gap-2 shrink-0 pb-2 border-b border-outline-variant/10 sm:flex sm:flex-wrap sm:items-center sm:pb-0 sm:border-b-0">
              <select value={optImgField} onChange={(e) => {
                const f = e.target.value;
                setOptImgField(f);
                if (f) {
                  const vals = fieldOptions[f] || [];
                  const savedOrder = (activeCat.optionOrder as Record<string, string[]>)?.[f] || [];
                  const ordered = savedOrder.filter((v) => vals.includes(v));
                  const rest = vals.filter((v) => !savedOrder.includes(v));
                  setOrderItems([...ordered, ...rest]);
                } else {
                  setOrderItems([]);
                }
              }} className="w-full sm:flex-1 bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container">
                <option value="">选择字段...</option>
                {Object.keys(fieldOptions).map((f) => (
                  <option key={f} value={f}>{f} ({fieldOptions[f].length} 个选项)</option>
                ))}
              </select>
              {optImgField && (
                <div className="grid grid-cols-2 rounded-md border border-outline-variant/20 overflow-hidden shrink-0 sm:flex">
                  <button
                    onClick={() => setOptViewMode("grid")}
                    className={`px-3 py-2 text-xs flex items-center justify-center gap-1 transition-colors ${optViewMode === "grid" ? "bg-primary-container text-on-primary" : "bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-high"}`}
                    title="卡片视图"
                  >
                    <Icon name="grid_view" size={14} /> 卡片
                  </button>
                  <button
                    onClick={() => setOptViewMode("list")}
                    className={`px-3 py-2 text-xs flex items-center justify-center gap-1 transition-colors ${optViewMode === "list" ? "bg-primary-container text-on-primary" : "bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-high"}`}
                    title="列表视图"
                  >
                    <Icon name="view_list" size={14} /> 列表
                  </button>
                </div>
              )}
              {optImgField && orderItems.length > 0 && (
                <button
                  onClick={() => {
                    const colDef = activeCat?.columns?.find((c: any) => c.key === optImgField);
                    setOrderItems(smartSortOptions(orderItems, colDef?.sortType));
                  }}
                  className="w-full sm:w-auto px-3 py-2 text-xs font-medium bg-surface-container-lowest text-on-surface-variant border border-outline-variant/20 rounded-md hover:bg-surface-container-high hover:text-on-surface transition-colors shrink-0"
                  title="按智能规则排序（螺纹/数字优先）"
                >
                  <Icon name="sort" size={13} className="mr-0.5" /> 一键排序
                </button>
              )}
            </div>

            {/* Content area */}
            <div className="flex-1 overflow-y-auto min-h-0 pr-0.5 pb-2">
              {!optImgField || orderItems.length === 0 ? (
                <div className="min-h-full grid place-items-center rounded-xl border border-dashed border-outline-variant/20 bg-surface-container-lowest/60 px-4 py-8 text-center">
                  <div className="space-y-2">
                    <Icon name="tune" size={28} className="mx-auto text-on-surface-variant/40" />
                    <p className="text-sm font-medium text-on-surface">请选择要设置的字段</p>
                    <p className="text-xs leading-relaxed text-on-surface-variant">选择字段后可调整选项顺序、修改名称或上传图片。</p>
                  </div>
                </div>
              ) : optViewMode === "grid" ? (
                /* ===== Card Grid View (for images) ===== */
                <div className="grid grid-cols-1 min-[430px]:grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-3">
                  {orderItems.map((val, i) => {
                    const imgUrl = optImages[optImgField]?.[val];
                    const isUploading = uploadingVal === `${optImgField}::${val}`;
                    return (
                      <div
                        key={val}
                        draggable
                        onDragStart={() => setOrderDragIdx(i)}
                        onDragOver={(e) => {
                          e.preventDefault();
                          if (orderDragIdx === null || orderDragIdx === i) return;
                          const next = [...orderItems];
                          const [item] = next.splice(orderDragIdx, 1);
                          next.splice(i, 0, item);
                          setOrderItems(next);
                          setOrderDragIdx(i);
                        }}
                        onDragEnd={() => setOrderDragIdx(null)}
                        className={`rounded-lg border bg-surface-container p-2.5 sm:p-3 space-y-2 transition-opacity cursor-grab active:cursor-grabbing ${
                          orderDragIdx === i ? "opacity-40 border-primary-container/30" : "border-outline-variant/20"
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="text-on-surface-variant/40 select-none text-xs shrink-0">⠿</span>
                          <span className="text-xs font-medium text-on-surface break-words line-clamp-2 flex-1 min-w-0">{val}</span>
                          <button
                            onClick={() => { setRenameField(optImgField); setRenameOldVal(val); setRenameNewVal(val); }}
                            className="w-7 h-7 rounded flex items-center justify-center bg-primary-container/10 hover:bg-primary-container/20 text-primary-container shrink-0 transition-colors"
                            title="改名"
                          >
                            <Icon name="edit" size={12} />
                          </button>
                        </div>
                        <button
                          onClick={() => setEditOptVal(val)}
                          className="w-full aspect-[2.2/1] min-[430px]:aspect-square rounded bg-surface-container-lowest flex items-center justify-center overflow-hidden border border-outline-variant/10 hover:border-primary-container/30 transition-colors"
                        >
                          {isUploading ? (
                            <Icon name="hourglass_empty" size={24} className="text-on-surface-variant animate-spin" />
                          ) : imgUrl ? (
                            <SafeImage src={imgUrl} alt={val} className="w-full h-full object-contain" fallbackIcon="add_photo_alternate" />
                          ) : (
                            <Icon name="add_photo_alternate" size={24} className="text-on-surface-variant/30" />
                          )}
                        </button>
                        <span className="block text-center text-[10px] text-primary-container">
                          {imgUrl ? "点击更换" : "点击上传"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* ===== List View (for sorting & rename) ===== */
                <div className="space-y-1">
                  {orderItems.map((val, i) => (
                    <div
                      key={val}
                      draggable
                      onDragStart={() => setOrderDragIdx(i)}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (orderDragIdx === null || orderDragIdx === i) return;
                        const next = [...orderItems];
                        const [item] = next.splice(orderDragIdx, 1);
                        next.splice(i, 0, item);
                        setOrderItems(next);
                        setOrderDragIdx(i);
                      }}
                      onDragEnd={() => setOrderDragIdx(null)}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border transition-all ${
                        orderDragIdx === i
                          ? "opacity-40 border-primary-container/30 bg-primary-container/5"
                          : "border-outline-variant/20 bg-surface-container-lowest hover:border-outline-variant/40"
                      }`}
                    >
                      <span className="cursor-grab active:cursor-grabbing text-on-surface-variant/40 select-none text-sm shrink-0">⠿</span>
                      <span className="text-sm font-medium text-on-surface flex-1 min-w-0 break-words">{val}</span>
                      {optImages[optImgField]?.[val] && (
                        <SafeImage src={optImages[optImgField][val]} alt="" className="w-7 h-7 object-contain rounded shrink-0" fallbackIcon="image" />
                      )}
                      <button
                        onClick={() => { setRenameField(optImgField); setRenameOldVal(val); setRenameNewVal(val); }}
                        className="w-6 h-6 rounded flex items-center justify-center bg-primary-container/10 hover:bg-primary-container/20 text-primary-container shrink-0 transition-colors"
                        title="改名"
                      >
                        <Icon name="edit" size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Save order button */}
            <div className="grid grid-cols-2 gap-2 shrink-0 pt-2 border-t border-outline-variant/10 bg-surface-container-low sm:flex sm:justify-end">
              <button onClick={() => setShowOptImgModal(false)} className="px-3 py-2.5 sm:py-2 text-xs text-on-surface-variant bg-surface-container-high/40 hover:bg-surface-container-high rounded-lg sm:rounded">关闭</button>
              <button
                onClick={async () => {
                  if (!optImgField || orderItems.length === 0) {
                    toast("请先选择要设置的字段", "error");
                    return;
                  }
                  try {
                    const currentOrder = (activeCat.optionOrder as Record<string, string[]>) || {};
                    await updateCategory(activeCat.id, {
                      optionOrder: { ...currentOrder, [optImgField]: orderItems },
                    });
                    toast("设置已保存", "success");
                    mutateCats();
                  } catch (err) {
                    console.error("保存设置失败:", err);
                    toast("保存失败", "error");
                  }
                }}
                disabled={!optImgField || orderItems.length === 0}
                className="px-3 py-2.5 sm:py-2 text-xs font-bold bg-primary-container text-on-primary rounded-lg sm:rounded hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                保存设置
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Single Option Upload Dialog ===== */}
      {editOptVal && optImgField && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50 p-4 sm:p-4" onClick={() => setEditOptVal(null)} onPaste={async (e) => {
          // Check for image first
          for (const item of Array.from(e.clipboardData.items)) {
            if (item.type.startsWith("image/")) {
              e.preventDefault();
              const file = item.getAsFile();
              if (file) await uploadOptImg(optImgField, editOptVal, file);
              return;
            }
          }
          // Check for URL text
          const text = e.clipboardData.getData("text/plain")?.trim();
          if (text && /^https?:\/\/.+/i.test(text)) {
            e.preventDefault();
            toast("正在下载图片...", "info");
            try {
              const { url } = await uploadOptionImageFromUrl(text);
              const updated = { ...optImages, [optImgField]: { ...(optImages[optImgField] || {}), [editOptVal]: url } };
              await updateCategory(activeCat!.id, { optionImages: updated });
              mutateCats();
              toast("图片已下载并保存", "success");
            } catch {
              toast("下载图片失败，请检查链接是否有效", "error");
            }
          }
        }}>
          <div className="w-full max-w-sm max-h-[min(620px,calc(100dvh_-_2rem_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom)))] bg-surface-container-low rounded-2xl border border-outline-variant/20 p-4 sm:p-5 shadow-2xl flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <h3 className="text-sm font-bold leading-snug text-on-surface">上传选项图片</h3>
                <p className="mt-1 text-xs leading-snug text-on-surface-variant break-words">{editOptVal}</p>
              </div>
              <button onClick={() => setEditOptVal(null)} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"><Icon name="close" size={16} /></button>
            </div>
            {(() => {
              const imgUrl = optImages[optImgField]?.[editOptVal];
              const isUploading = uploadingVal === `${optImgField}::${editOptVal}`;
              return (
                <>
                  <div className="min-h-0 overflow-y-auto">
                    <div className="flex flex-col gap-4">
                      <div className="w-full aspect-[4/3] max-h-[38dvh] rounded-xl bg-surface-container-lowest flex items-center justify-center overflow-hidden border border-outline-variant/10">
                        {isUploading ? (
                          <Icon name="hourglass_empty" size={30} className="text-on-surface-variant animate-spin" />
                        ) : imgUrl ? (
                          <SafeImage src={imgUrl} alt={editOptVal} className="w-full h-full object-contain p-2" fallbackIcon="add_photo_alternate" />
                        ) : (
                          <div className="flex flex-col items-center gap-2 text-on-surface-variant/40">
                            <Icon name="add_photo_alternate" size={30} />
                            <span className="text-xs">暂无图片</span>
                          </div>
                        )}
                      </div>
                      <p className="text-[11px] leading-relaxed text-on-surface-variant text-center">支持选择本地图片，也可以复制截图或远程图片地址后粘贴。</p>
                    </div>
                  </div>
                  <div className="shrink-0 space-y-2 pt-1">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <label className="flex-1">
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) uploadOptImg(optImgField, editOptVal, f);
                            e.target.value = "";
                          }}
                        />
                        <span className="block text-center px-3 py-3 text-xs font-medium bg-primary-container text-on-primary rounded-lg hover:opacity-90 cursor-pointer">
                          选择图片
                        </span>
                      </label>
                      <button
                        onClick={async () => {
                          try {
                            const clipboardItems = await navigator.clipboard.read();
                            for (const item of clipboardItems) {
                              for (const type of item.types) {
                                if (type.startsWith("image/")) {
                                  const blob = await item.getType(type);
                                  const file = new File([blob], `${optImgField}_${editOptVal}.png`, { type });
                                  await uploadOptImg(optImgField, editOptVal, file);
                                  return;
                                }
                                // Check for URL in text clipboard
                                if (type === "text/plain") {
                                  const blob = await item.getType(type);
                                  const text = await blob.text();
                                  const url = text.trim();
                                  if (/^https?:\/\/.+/i.test(url)) {
                                    toast("正在下载图片...", "info");
                                    const { url: localUrl } = await uploadOptionImageFromUrl(url);
                                    const updated = { ...optImages, [optImgField]: { ...(optImages[optImgField] || {}), [editOptVal]: localUrl } };
                                    await updateCategory(activeCat!.id, { optionImages: updated });
                                    mutateCats();
                                    toast("图片已下载并保存", "success");
                                    return;
                                  }
                                }
                              }
                            }
                            toast("剪贴板中没有图片，请先截图或复制图片链接", "error");
                          } catch {
                            toast("无法读取剪贴板，请使用 Ctrl+V 粘贴或选择文件上传", "error");
                          }
                        }}
                        className="flex-1 px-3 py-3 text-xs font-medium bg-surface-container-high text-on-surface rounded-lg hover:opacity-90"
                      >
                        从剪贴板粘贴
                      </button>
                    </div>
                    {imgUrl && (
                      <button onClick={() => { removeOptImg(optImgField, editOptVal); }} className="w-full py-2 text-xs text-error/70 hover:text-error text-center">
                        移除图片
                      </button>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* ===== Single Rename Dialog ===== */}
      {renameOldVal && renameField && activeCat && (
        <div className="fixed inset-0 z-[130] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" onClick={() => setRenameOldVal("")}>
          <div className="w-full max-w-xs max-h-[100dvh] overflow-y-auto bg-surface-container-low rounded-t-2xl sm:rounded-xl border border-outline-variant/20 p-4 pb-[max(env(safe-area-inset-bottom),1rem)] sm:p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-on-surface">修改选项值</h3>
              <button onClick={() => setRenameOldVal("")} className="grid h-8 w-8 place-items-center rounded-full text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"><Icon name="close" size={16} /></button>
            </div>
            <div>
              <label className="text-xs text-on-surface-variant mb-1 block">当前值</label>
              <p className="text-sm text-on-surface font-medium bg-surface-container-lowest px-3 py-2 rounded border border-outline-variant/10 break-words">{renameOldVal}</p>
            </div>
            <div>
              <label className="text-xs text-on-surface-variant mb-1 block">改为</label>
              <input value={renameNewVal} onChange={(e) => setRenameNewVal(e.target.value)} autoFocus className="w-full bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container" />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
              <button onClick={() => setRenameOldVal("")} className="px-3 py-2 text-xs text-on-surface-variant bg-surface-container-high/40 hover:bg-surface-container-high rounded">取消</button>
              <button
                onClick={async () => {
                  if (!renameNewVal.trim() || renameNewVal === renameOldVal) return;
                  setRenaming(true);
                  try {
                    const newVal = renameNewVal.trim();
                    const { updated } = await renameOptionValue(activeCat.id, renameField, renameOldVal, newVal);
                    toast(`"${renameOldVal}" → "${newVal}"，已替换 ${updated} 个产品`, "success");
                    // Update local orderItems to reflect the rename immediately
                    setOrderItems((prev) => prev.map((v) => (v === renameOldVal ? newVal : v)));
                    mutateCats();
                    mutateProds();
                    setRenameOldVal("");
                    setRenameNewVal("");
                  } catch {
                    toast("替换失败", "error");
                  } finally {
                    setRenaming(false);
                  }
                }}
                disabled={renaming || !renameNewVal.trim() || renameNewVal === renameOldVal}
                className="px-3 py-2 text-xs font-bold bg-primary-container text-on-primary rounded hover:opacity-90 disabled:opacity-50"
              >
                {renaming ? "替换中..." : "确认替换"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Batch Import Modal ===== */}
      {showBatchModal && (
        <div className="fixed inset-0 z-[120] bg-black/50 p-0 sm:flex sm:items-center sm:justify-center sm:p-4" onClick={() => { setShowBatchModal(false); setBatchParsed(null); setBatchErrors([]); }}>
          <div className="fixed left-3 right-3 top-[max(1rem,env(safe-area-inset-top))] bottom-[max(1rem,env(safe-area-inset-bottom))] flex min-h-0 flex-col bg-surface-container-low rounded-2xl border border-outline-variant/20 p-4 space-y-4 shadow-2xl sm:relative sm:inset-auto sm:w-full sm:max-w-lg sm:max-h-[90dvh] sm:p-5 sm:rounded-xl" onClick={(e) => e.stopPropagation()}>
            <div className="shrink-0 space-y-2">
              <h2 className="text-base font-bold text-on-surface">批量导入产品</h2>
              <p className="text-xs text-on-surface-variant">支持 .xlsx / .xls / .csv 格式。建议先导出模板，填写数据后导入。相同型号的产品会自动更新。</p>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto pr-0.5 space-y-4">

            {/* File upload area */}
            {!batchParsed && (
              <div className="space-y-3">
                <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-outline-variant/30 rounded-lg cursor-pointer hover:border-primary-container/50 hover:bg-primary-container/5 transition-colors">
                  <Icon name="upload_file" size={28} className="text-on-surface-variant/40 mb-2" />
                  <span className="text-sm text-on-surface-variant">点击选择 Excel 文件</span>
                  <span className="text-[10px] text-on-surface-variant/50 mt-1">.xlsx / .xls / .csv</span>
                  <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleExcelFile(f);
                    e.target.value = "";
                  }} />
                </label>
                {batchErrors.length > 0 && (
                  <div className="space-y-1">
                    {batchErrors.map((err, i) => (
                      <p key={i} className="text-xs text-error">{err}</p>
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
                          <td colSpan={3} className="px-2 py-1 text-on-surface-variant text-center">... 还有 {batchParsed.length - 20} 条</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {batchErrors.length > 0 && (
                  <div className="space-y-1">
                    {batchErrors.map((err, i) => (
                      <p key={i} className="text-xs text-amber-500">{err}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
            </div>

            <div className="grid grid-cols-2 gap-2 shrink-0 pt-2 border-t border-outline-variant/10 sm:flex sm:justify-end">
              <button onClick={() => { setShowBatchModal(false); setBatchParsed(null); setBatchErrors([]); }} className="px-4 py-2.5 sm:py-2 text-sm text-on-surface-variant bg-surface-container-high/40 hover:bg-surface-container-high rounded-lg sm:rounded">
                {batchParsed ? "取消" : "关闭"}
              </button>
              {batchParsed && (
                <button onClick={handleBatchImport} disabled={batchImporting} className="px-4 py-2.5 sm:py-2 text-sm font-bold bg-primary-container text-on-primary rounded-lg sm:rounded hover:opacity-90 disabled:opacity-50">
                  {batchImporting ? "导入中..." : `确认导入 ${batchParsed.length} 条`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== Group Management Modal ===== */}
      {showGroupModal && (
        <div className="fixed inset-0 z-[120] bg-black/50 p-0 sm:flex sm:items-center sm:justify-center sm:p-4" onClick={() => { setShowGroupModal(false); setManageGroupCatsId(null); }}>
          <div className="fixed left-3 right-3 top-[max(1rem,env(safe-area-inset-top))] bottom-[max(1rem,env(safe-area-inset-bottom))] flex min-h-0 flex-col bg-surface-container-low rounded-2xl border border-outline-variant/20 p-4 space-y-4 shadow-2xl sm:relative sm:inset-auto sm:w-full sm:max-w-md sm:max-h-[90dvh] sm:p-5 sm:rounded-xl" onClick={(e) => e.stopPropagation()}>

            {/* --- Sub-view: manage categories in a group --- */}
            {manageGroupCatsId ? (() => {
              const g = groupItems.find((gi) => gi.id === manageGroupCatsId);
              const catsInGroup = categories.filter((c) => c.groupId === manageGroupCatsId);
              const otherCats = categories.filter((c) => c.groupId !== manageGroupCatsId);
              const updateManagedGroup = (patch: Partial<{ name: string; icon: string; image: string; imageFit: "cover" | "contain" }>) => {
                setGroupItems(items => items.map(item => item.id === manageGroupCatsId ? { ...item, ...patch } : item));
              };
              const saveManagedGroupSettings = async () => {
                if (!g?.name.trim()) {
                  toast("请输入分组名称", "error");
                  return;
                }
                try {
                  for (const c of catsInGroup) {
                    await updateCategory(c.id, {
                      groupName: g.name.trim(),
                      groupIcon: g.icon.trim() || "category",
                      groupImage: g.image || null,
                      groupImageFit: g.imageFit,
                    });
                  }
                  toast("分组设置已保存", "success");
                  mutateCats();
                } catch (err) {
                  toast(getApiErrorMessage(err, "分组设置保存失败"), "error");
                }
              };
              const saveManagedGroupImage = async (image = g?.image || "", imageFit: "cover" | "contain" = g?.imageFit || "cover") => {
                try {
                  for (const c of catsInGroup) {
                    await updateCategory(c.id, { groupImage: image || null, groupImageFit: imageFit });
                  }
                  mutateCats();
                  return true;
                } catch (err) {
                  toast(getApiErrorMessage(err, "封面设置保存失败"), "error");
                  return false;
                }
              };
              const uploadManagedGroupImageFromUrl = async (imageUrl?: string) => {
                const targetUrl = imageUrl?.trim() || "";
                if (!targetUrl) return false;
                if (!/^https?:\/\/.+/i.test(targetUrl)) {
                  return false;
                }
                try {
                  toast("正在下载图片...", "info");
                  const { url } = await uploadOptionImageFromUrl(targetUrl);
                  if (await saveManagedGroupImage(url, g?.imageFit || "cover")) {
                    updateManagedGroup({ image: url });
                    toast("图片已下载并保存", "success");
                  }
                  return true;
                } catch {
                  toast("下载图片失败", "error");
                  return true;
                }
              };
              const uploadManagedGroupFile = async (file: File) => {
                try {
                  const { url } = await uploadOptionImage(file);
                  if (await saveManagedGroupImage(url, g?.imageFit || "cover")) {
                    updateManagedGroup({ image: url });
                    toast("分组封面已上传", "success");
                  }
                } catch (err) {
                  toast(getApiErrorMessage(err, "上传失败"), "error");
                }
              };
              const importManagedGroupCover = async () => {
                try {
                  if (navigator.clipboard?.read) {
                    const items = await navigator.clipboard.read();
                    for (const item of items) {
                      const imageType = item.types.find((type) => type.startsWith("image/"));
                      if (imageType) {
                        const blob = await item.getType(imageType);
                        await uploadManagedGroupFile(new File([blob], `group-cover.${imageType.split("/")[1] || "png"}`, { type: imageType }));
                        return;
                      }
                    }
                  }
                  const text = await navigator.clipboard?.readText?.();
                  if (text && await uploadManagedGroupImageFromUrl(text)) return;
                } catch {
                  // Clipboard permission may be unavailable; file picker is the graceful fallback.
                }
                groupCoverInputRef.current?.click();
              };
              const handleManagedGroupCoverPaste = async (e: React.ClipboardEvent) => {
                for (const item of Array.from(e.clipboardData.items)) {
                  if (item.type.startsWith("image/")) {
                    e.preventDefault();
                    const file = item.getAsFile();
                    if (!file) return;
                    await uploadManagedGroupFile(file);
                    return;
                  }
                }
                const text = e.clipboardData.getData("text/plain")?.trim();
                if (text && /^https?:\/\/.+/i.test(text)) {
                  e.preventDefault();
                  await uploadManagedGroupImageFromUrl(text);
                }
              };
              return (
                <>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => setManageGroupCatsId(null)} className="text-on-surface-variant hover:text-on-surface"><Icon name="arrow_back" size={18} /></button>
                    <h2 className="text-base font-bold text-on-surface">{g?.name} — 分类管理</h2>
                  </div>

                  <div className="flex-1 overflow-y-auto min-h-0 space-y-3">
                    <div className="rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-3 space-y-3">
                      <div>
                        <p className="text-xs font-bold text-on-surface">分组设置</p>
                        <p className="text-[10px] text-on-surface-variant mt-0.5">修改当前分组的名称和图标</p>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-[110px_1fr] gap-2">
                        <input
                          value={g?.icon || ""}
                          onChange={(e) => updateManagedGroup({ icon: e.target.value })}
                          placeholder="图标"
                          className="w-full bg-surface-container-low text-on-surface text-xs rounded px-2 py-1.5 border border-outline-variant/20 outline-none focus:border-primary-container"
                        />
                        <input
                          value={g?.name || ""}
                          onChange={(e) => updateManagedGroup({ name: e.target.value })}
                          placeholder="分组名称"
                          className="w-full bg-surface-container-low text-on-surface text-xs rounded px-2 py-1.5 border border-outline-variant/20 outline-none focus:border-primary-container"
                        />
                      </div>
                      <div className="flex justify-end">
                        <button onClick={saveManagedGroupSettings} disabled={!g?.name.trim()} className="px-3 py-1.5 text-xs font-bold bg-primary-container text-on-primary rounded hover:opacity-90 disabled:opacity-50">保存设置</button>
                      </div>
                    </div>
                    <div className="rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-3 space-y-3" onPaste={handleManagedGroupCoverPaste}>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-bold text-on-surface">分组封面</p>
                          <p className="text-[10px] text-on-surface-variant mt-0.5">可粘贴截图，或粘贴远程图片地址</p>
                        </div>
                        <div className="flex rounded-lg bg-surface-container-high p-0.5 text-[11px]">
                          {[
                            { value: "cover", label: "铺满裁切" },
                            { value: "contain", label: "完整显示" },
                          ].map((mode) => (
                            <button
	                              key={mode.value}
	                              onClick={async () => {
	                                const imageFit = mode.value as "cover" | "contain";
	                                const prevImageFit = g?.imageFit || "cover";
	                                updateManagedGroup({ imageFit });
	                                const saved = await saveManagedGroupImage(g?.image || "", imageFit);
	                                if (!saved) updateManagedGroup({ imageFit: prevImageFit });
	                              }}
                              className={`px-2.5 py-1 rounded-md transition-colors ${g?.imageFit === mode.value ? "bg-primary-container text-on-primary" : "text-on-surface-variant hover:text-on-surface"}`}
                            >
                              {mode.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="aspect-[2.35/1] rounded-lg overflow-hidden border border-outline-variant/10 bg-surface-container-high">
                        {g?.image ? (
                          <SafeImage src={g.image} alt="" className={g.imageFit === "contain" ? "w-full h-full object-contain p-2" : "w-full h-full object-cover"} fallbackIcon="image" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-on-surface-variant">
                            <Icon name={g?.icon || "category"} size={26} />
                          </div>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[10px] text-on-surface-variant">点击上传会自动识别剪贴板截图或图片地址</p>
                        <input
                          ref={groupCoverInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={async (e) => {
                            const f = e.target.files?.[0];
                            if (f) await uploadManagedGroupFile(f);
                            e.target.value = "";
                          }}
                        />
                        <button onClick={importManagedGroupCover} className="px-3 py-1.5 text-xs font-bold bg-primary-container text-on-primary rounded hover:opacity-90 shrink-0">上传封面</button>
                      </div>
                    </div>
                    <p className="text-[10px] text-on-surface-variant font-bold uppercase tracking-wide">当前分组内（{catsInGroup.length}）</p>
                    {catsInGroup.length === 0 && <p className="text-xs text-on-surface-variant py-2 text-center">暂无分类</p>}
                    {catsInGroup.map((c) => (
                      <div key={c.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-outline-variant/20 bg-surface-container-lowest">
                        <Icon name={c.icon || "category"} size={14} className="text-primary-container shrink-0" />
                        <span className="text-sm text-on-surface flex-1 truncate">{c.name}</span>
                        <button
                          onClick={async () => {
                            await updateCategory(c.id, { groupId: null, groupName: null, groupIcon: null, groupImage: null, groupImageFit: null });
                            toast(`"${c.name}" 已移出分组`, "success");
                            mutateCats();
                          }}
                          className="text-error/60 hover:text-error shrink-0"
                          title="移出分组"
                        >
                          <Icon name="close" size={14} />
                        </button>
                      </div>
                    ))}

                    {otherCats.length > 0 && (
                      <>
                        <p className="text-[10px] text-on-surface-variant font-bold uppercase tracking-wide pt-2">其他分类（点击添加到本组）</p>
                        {otherCats.map((c) => {
                          const srcGroup = c.groupId ? groupItems.find((gi) => gi.id === c.groupId) : null;
                          return (
                            <button
                              key={c.id}
                              onClick={async () => {
                                await updateCategory(c.id, { groupId: manageGroupCatsId, groupName: g?.name || "", groupIcon: g?.icon || "category", groupImage: g?.image || null, groupImageFit: g?.imageFit || "cover" });
                                toast(`"${c.name}" 已移入本组`, "success");
                                mutateCats();
                              }}
                              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-outline-variant/30 bg-surface-container-lowest hover:border-primary-container/40 hover:bg-primary-container/5 w-full text-left transition-colors"
                            >
                              <Icon name="add" size={14} className="text-primary-container shrink-0" />
                              <span className="text-sm text-on-surface-variant flex-1 truncate">{c.name}</span>
                              {srcGroup ? (
                                <span className="text-[10px] text-on-surface-variant/60 shrink-0">来自: {srcGroup.name}</span>
                              ) : (
                                <span className="text-[10px] text-on-surface-variant/60 shrink-0">未分组</span>
                              )}
                            </button>
                          );
                        })}
                      </>
                    )}
                  </div>

                  <div className="flex justify-end shrink-0 pt-2 border-t border-outline-variant/10">
                    <button onClick={() => setManageGroupCatsId(null)} className="px-3 py-1.5 text-xs text-on-surface-variant hover:bg-surface-container-high/50 rounded">返回</button>
                  </div>
                </>
              );
            })() : (
              <>
                {/* --- Main view: group list --- */}
                <div className="flex items-center justify-between shrink-0">
                  <h2 className="text-base font-bold text-on-surface">分组管理</h2>
                  <button onClick={() => setShowGroupModal(false)} className="text-on-surface-variant hover:text-on-surface"><Icon name="close" size={18} /></button>
                </div>

                {/* Add group form */}
                <div className="shrink-0 space-y-2 border-b border-outline-variant/10 pb-3">
                  <div className="flex items-center gap-2">
                    <input
                      value={groupForm.icon}
                      onChange={(e) => setGroupForm({ ...groupForm, icon: e.target.value })}
                      placeholder="图标"
                      className="w-20 bg-surface-container-lowest text-on-surface text-xs rounded px-2 py-1.5 border border-outline-variant/20 outline-none focus:border-primary-container"
                    />
                    <input
                      value={groupForm.name}
                      onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
                      placeholder="分组名称"
                      className="flex-1 bg-surface-container-lowest text-on-surface text-xs rounded px-2 py-1.5 border border-outline-variant/20 outline-none focus:border-primary-container"
                    />
                    <button
                      onClick={async () => {
                        if (!groupForm.name.trim()) return;
                        const newId = `group_${Date.now()}`;
                        setGroupItems([...groupItems, { id: newId, name: groupForm.name.trim(), icon: groupForm.icon.trim() || "category", image: "", imageFit: "cover", catCount: 0 }]);
                        toast("分组已创建");
                        setGroupForm({ name: "", icon: "category", image: "", imageFit: "cover" });
                        mutateCats();
                      }}
                      disabled={!groupForm.name.trim()}
                      className="px-3 py-1.5 text-xs font-bold bg-primary-container text-on-primary rounded hover:opacity-90 disabled:opacity-50 shrink-0"
                    >
                      创建
                    </button>
                  </div>
                  <p className="text-[10px] text-on-surface-variant">名称、图标、封面和分类归属都在进入分组后的“管理分类”里调整。</p>
                </div>

                {/* Group list */}
                <div className="flex-1 overflow-y-auto min-h-0 space-y-1">
                  {groupItems.length === 0 && (
                    <p className="text-center py-8 text-on-surface-variant text-sm">暂无分组</p>
                  )}
                  {groupItems.map((g, i) => (
                    <div
                      key={g.id}
                      draggable
                      onDragStart={() => setGroupDragIdx(i)}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (groupDragIdx === null || groupDragIdx === i) return;
                        const next = [...groupItems];
                        const [moved] = next.splice(groupDragIdx, 1);
                        next.splice(i, 0, moved);
                        setGroupItems(next);
                        setGroupDragIdx(i);
                      }}
                      onDragEnd={() => setGroupDragIdx(null)}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border transition-all ${
                        groupDragIdx === i
                          ? "opacity-40 border-primary-container/30 bg-primary-container/5"
                          : "border-outline-variant/20 bg-surface-container-lowest hover:border-outline-variant/40"
                      }`}
                    >
                      <span className="cursor-grab active:cursor-grabbing text-on-surface-variant/40 select-none text-sm">⠿</span>
                      {g.image ? (
                        <SafeImage src={g.image} alt="" className={`h-8 w-12 rounded border border-outline-variant/10 shrink-0 ${g.imageFit === "contain" ? "object-contain p-0.5 bg-surface-container-high" : "object-cover"}`} fallbackIcon="image" />
                      ) : (
                        <Icon name={g.icon} size={16} className="text-primary-container shrink-0" />
                      )}
                      <span className="text-sm font-medium text-on-surface flex-1">{g.name}</span>
                      <span className="text-[10px] text-on-surface-variant">{g.catCount} 个分类</span>
                      <button
                        onClick={() => setManageGroupCatsId(g.id)}
                        className="text-primary-container hover:bg-primary-container/10 rounded p-1"
                        title="管理分类"
                      >
                        <Icon name="settings" size={13} />
                      </button>
                      <button
                        onClick={async () => {
                          const catsInGroup = categories.filter((c) => c.groupId === g.id);
                          for (const c of catsInGroup) {
                            await updateCategory(c.id, { groupId: null, groupName: null, groupIcon: null, groupImage: null, groupImageFit: null });
                          }
                          setGroupItems(groupItems.filter((gi) => gi.id !== g.id));
                          toast("分组已删除", "success");
                          mutateCats();
                        }}
                        className="text-error/70 hover:text-error rounded p-1"
                        title="删除分组"
                      >
                        <Icon name="delete" size={13} />
                      </button>
                    </div>
                  ))}
                </div>

                {/* Save group order */}
                <div className="flex justify-end gap-2 shrink-0 pt-2 border-t border-outline-variant/10">
                  <button onClick={() => setShowGroupModal(false)} className="px-3 py-1.5 text-xs text-on-surface-variant hover:bg-surface-container-high/50 rounded">关闭</button>
                  <button
                    onClick={async () => {
                      try {
                        for (const g of groupItems) {
                          const catsInGroup = categories.filter((c) => c.groupId === g.id);
                          for (const c of catsInGroup) {
                            await updateCategory(c.id, { groupName: g.name, groupIcon: g.icon, groupImage: g.image || null, groupImageFit: g.imageFit });
                          }
                        }
                        toast("分组已保存", "success");
                        setShowGroupModal(false);
                        mutateCats();
                      } catch {
                        toast("保存失败", "error");
                      }
                    }}
                    className="px-3 py-1.5 text-xs font-bold bg-primary-container text-on-primary rounded hover:opacity-90"
                  >
                    保存设置
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ===== Category Sort Modal ===== */}
      {showCatSortModal && (
        <div className="fixed inset-0 z-[120] bg-black/50 p-0 sm:flex sm:items-center sm:justify-center sm:p-4" onClick={() => setShowCatSortModal(false)}>
          <div className="fixed left-3 right-3 top-[max(1rem,env(safe-area-inset-top))] bottom-[max(1rem,env(safe-area-inset-bottom))] flex min-h-0 flex-col bg-surface-container-low rounded-2xl border border-outline-variant/20 p-4 space-y-4 shadow-2xl sm:relative sm:inset-auto sm:w-full sm:max-w-md sm:max-h-[90dvh] sm:p-5 sm:rounded-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between shrink-0">
              <h2 className="text-base font-bold text-on-surface">分类排序</h2>
              <button onClick={() => setShowCatSortModal(false)} className="text-on-surface-variant hover:text-on-surface"><Icon name="close" size={18} /></button>
            </div>
            <p className="text-xs text-on-surface-variant shrink-0">拖拽调整分类显示顺序</p>
            <div className="flex-1 overflow-y-auto min-h-0 space-y-1">
              {catSortItems.map((item, i) => (
                <div
                  key={item.id}
                  draggable
                  onDragStart={() => setCatSortDragIdx(i)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (catSortDragIdx === null || catSortDragIdx === i) return;
                    const next = [...catSortItems];
                    const [moved] = next.splice(catSortDragIdx, 1);
                    next.splice(i, 0, moved);
                    setCatSortItems(next);
                    setCatSortDragIdx(i);
                  }}
                  onDragEnd={() => setCatSortDragIdx(null)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border transition-all ${
                    catSortDragIdx === i
                      ? "opacity-40 border-primary-container/30 bg-primary-container/5"
                      : "border-outline-variant/20 bg-surface-container-lowest hover:border-outline-variant/40"
                  }`}
                >
                  <span className="cursor-grab active:cursor-grabbing text-on-surface-variant/40 select-none text-sm">⠿</span>
                  <span className="text-sm font-medium text-on-surface flex-1">{item.name}</span>
                  <span className="text-[10px] text-on-surface-variant">{i + 1}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 shrink-0 pt-2 border-t border-outline-variant/10">
              <button onClick={() => setShowCatSortModal(false)} className="px-3 py-1.5 text-xs text-on-surface-variant hover:bg-surface-container-high/50 rounded">取消</button>
              <button
                onClick={async () => {
                  try {
                    await sortCategories(catSortItems.map((item, i) => ({ id: item.id, sortOrder: i })));
                    toast("排序已保存", "success");
                    setShowCatSortModal(false);
                    mutateCats();
                  } catch (err: any) {
                    toast(err.response?.data?.detail || "排序保存失败", "error");
                  }
                }}
                className="px-3 py-1.5 text-xs font-bold bg-primary-container text-on-primary rounded hover:opacity-90"
              >
                保存排序
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SelectionAdminPage() {
  useDocumentTitle("选型管理");
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const [navOpen, setNavOpen] = useState(false);

  if (isDesktop) {
    return (
      <div className="flex flex-col h-screen overflow-hidden">
        <TopNav />
        <div className="flex flex-1 overflow-hidden">
          <AppSidebar />
          <main className="flex-1 overflow-y-auto p-8 scrollbar-hidden bg-surface-dim">
            <Content />
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-dvh bg-surface">
      <TopNav compact onMenuToggle={() => setNavOpen((prev) => !prev)} />
      <MobileNavDrawer open={navOpen} onClose={() => setNavOpen(false)} />
      <main className="flex-1 overflow-y-auto scrollbar-hidden bg-surface-dim">
        <div className="px-4 py-4 pb-20">
          <Content />
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
