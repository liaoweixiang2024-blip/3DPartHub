import { useState, useEffect, useMemo, useCallback } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import useSWR from "swr";
import { useMediaQuery } from "../layouts/hooks/useMediaQuery";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import TopNav from "../components/shared/TopNav";
import BottomNav from "../components/shared/BottomNav";
import FormatTag from "../components/shared/FormatTag";

import Icon from "../components/shared/Icon";
import { useModels } from "../hooks/useModels";
import type { ServerModelListItem } from "../api/models";
import { categoriesApi, type CategoryItem } from "../api/categories";
import { useAuthStore, getAccessToken } from "../stores";
import { getCachedPublicSettings, getAnnouncement, getContactEmail, getSiteTitle, getFooterLinks, getFooterCopyright } from "../lib/publicSettings";
import { useToast } from "../components/shared/Toast";

interface Category {
  id: string;
  name: string;
  icon: string;
  count: number;
  children?: { id: string; name: string; count: number }[];
}

function buildCategories(tree: CategoryItem[]): Category[] {
  return tree.map((node) => ({
    id: node.id,
    name: node.name,
    icon: node.icon,
    count: (node as any).count || 0,
    children: node.children?.map((child) => ({
      id: child.id,
      name: child.name,
      count: (child as any).count || 0,
    })),
  }));
}

interface Product {
  id: string;
  name: string;
  description: string;
  formats: string[];
  fileSize: string;
  category: string;
  thumbnailUrl?: string;
  createdAt?: string;
  fileSizeBytes?: number;
  variantCount?: number;
}

const dotGridBg = {
  backgroundImage: "radial-gradient(circle, #584237 1px, transparent 1px)",
  backgroundSize: "16px 16px",
};

function AnnouncementBanner() {
  const [ann, setAnn] = useState({ enabled: false, text: "", type: "info", color: "" });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    getCachedPublicSettings().then(() => {
      setAnn(getAnnouncement());
    });
  }, []);

  if (!ann.enabled || !ann.text || dismissed) return null;

  const presetColors: Record<string, string> = {
    info: "bg-blue-500/10 border-blue-500/20 text-blue-400",
    warning: "bg-amber-500/10 border-amber-500/20 text-amber-400",
    error: "bg-red-500/10 border-red-500/20 text-red-400",
  };

  // Custom color overrides preset
  const style = ann.color
    ? { backgroundColor: `${ann.color}18`, borderColor: `${ann.color}40`, color: ann.color }
    : undefined;
  const className = ann.color
    ? "flex items-center gap-2 px-4 py-2 rounded-md border text-sm mb-4"
    : `flex items-center gap-2 px-4 py-2 rounded-md border text-sm mb-4 ${presetColors[ann.type] || presetColors.info}`;

  return (
    <div className={className} style={style}>
      <Icon name="campaign" size={18} className="shrink-0" />
      <span className="flex-1 [&_a]:underline [&_a]:font-medium hover:[&_a]:opacity-80" dangerouslySetInnerHTML={{ __html: ann.text }} />
      <button onClick={() => setDismissed(true)} className="shrink-0 opacity-60 hover:opacity-100">
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}

function CategorySidebar({
  expandedCategories,
  activeCategory,
  categories: categoriesData,
  totalCount,
  onToggle,
  onSelect,
}: {
  expandedCategories: Set<string>;
  activeCategory: string;
  categories: Category[];
  totalCount: number;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className="hidden md:flex w-56 bg-surface-container-low flex-col border-r border-primary-container/10 shrink-0 py-4 gap-2">
      <div className="px-5 py-3 border-b border-surface">
        <h2 className="text-sm font-bold text-on-surface tracking-wider uppercase font-headline">产品目录</h2>
      </div>
      <div className="flex-1 px-3 py-2 flex flex-col gap-0.5 overflow-y-auto scrollbar-hidden">
        <button
          onClick={() => onSelect("all")}
          className={`w-full flex items-center justify-between px-4 py-2 text-sm transition-colors rounded-sm ${
            activeCategory === "all" ? "border-l-2 border-primary-container text-primary-container bg-gradient-to-r from-primary-container/15 to-transparent" : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container/50"
          }`}
        >
          <span className="flex items-center gap-2">
            <Icon name="category_all" size={18} />
            全部
          </span>
          <span className="text-[10px] bg-primary/20 px-1.5 py-0.5 rounded-sm text-primary font-medium">{totalCount || categoriesData.reduce((s, c) => s + c.count, 0)}</span>
        </button>
        {categoriesData.map((cat) => {
          const isExpanded = expandedCategories.has(cat.id);
          const hasChildren = cat.children && cat.children.length > 0;
          const isActive = cat.id === activeCategory || (cat.children?.some((c) => c.id === activeCategory) ?? false);
          return (
            <div key={cat.id}>
              <button
                onClick={() => {
                  if (hasChildren) {
                    onToggle(cat.id);
                  } else {
                    onSelect(cat.id);
                  }
                }}
                className={`w-full flex items-center justify-between px-4 py-2 text-sm transition-colors rounded-sm ${
                  isActive ? "border-l-2 border-primary-container text-primary-container bg-gradient-to-r from-primary-container/15 to-transparent" : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container/50"
                }`}
              >
                <span className="flex items-center gap-2">
                  <Icon name={cat.icon} size={18} />
                  {cat.name}
                </span>
                <span className="flex items-center gap-1.5">
                  {hasChildren && (
                    <motion.span animate={{ rotate: isExpanded ? 180 : 0 }} transition={{ duration: 0.2 }} className="text-on-surface-variant/60">
                      <Icon name="expand_more" size={14} />
                    </motion.span>
                  )}
                  <span className="text-[10px] bg-primary/20 px-1.5 py-0.5 rounded-sm text-primary font-medium">{cat.count}</span>
                </span>
              </button>
              <AnimatePresence>
                {hasChildren && isExpanded && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }} className="overflow-hidden">
                    {cat.children.map((child) => (
                      <button
                        key={child.id}
                        onClick={() => onSelect(child.id)}
                        className={`w-full text-left ml-8 pr-4 py-1.5 text-[12px] transition-colors flex items-center gap-2 ${
                          activeCategory === child.id ? "text-primary-container" : "text-slate-500 hover:text-on-surface"
                        }`}
                      >
                        <span className={`w-1 h-1 rounded-full shrink-0 ${activeCategory === child.id ? "bg-primary-container" : "bg-slate-600"}`} />
                        {child.name}
                        <span className="text-[10px] text-on-surface-variant/60 ml-auto">{child.count}</span>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function ProductCard({ product, onDownload }: { product: Product; onDownload: (id: string) => void }) {
  return (
    <Link to={`/model/${product.id}`} className="block group bg-surface-container-high rounded-sm overflow-hidden hover:shadow-[0_12px_24px_rgba(0,0,0,0.4)] transition-all duration-300 flex flex-col relative">
      <div className="aspect-square bg-surface-container-lowest relative overflow-hidden flex items-center justify-center">
        {product.thumbnailUrl ? (
          <img src={product.thumbnailUrl} alt={product.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" />
        ) : (
          <div className="flex flex-col items-center gap-2 opacity-20" style={dotGridBg}>
            <Icon name="view_in_ar" size={48} className="text-on-surface-variant/15" />
          </div>
        )}
        <div className="absolute top-2 left-2 flex gap-1">
          {product.formats.map((f) => <FormatTag key={f} format={f} />)}
        </div>
        <span className="absolute top-2 right-2 bg-surface-container-highest/80 backdrop-blur-md px-1.5 py-0.5 text-[9px] text-on-surface-variant font-mono rounded-sm border border-outline-variant/30">
          {product.fileSize}
        </span>
        <div className="absolute bottom-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {product.variantCount && product.variantCount > 1 && (
            <span className="bg-primary/90 text-on-primary text-[9px] font-bold px-1.5 py-0.5 rounded-sm">×{product.variantCount}</span>
          )}
          <Icon name="360" size={18} className="text-primary" />
        </div>
      </div>
      <div className="flex-1 flex flex-col p-2.5">
        <h3 className="text-xs font-headline text-on-surface leading-tight line-clamp-2">{product.name}</h3>
        <div className="flex items-center gap-2 mt-auto pt-2">
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDownload(product.id); }}
            className="flex-1 bg-primary-container text-on-primary rounded-sm py-1.5 px-3 text-xs font-medium hover:opacity-90 flex items-center justify-center gap-1"
          >
            <Icon name="download" size={14} fill />
            下载
          </button>
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
            className="flex-1 border border-outline-variant/40 text-on-surface-variant hover:text-on-surface rounded-sm py-1.5 px-3 text-xs text-center flex items-center justify-center gap-1"
          >
            <Icon name="visibility" size={14} />
            预览
          </button>
        </div>
      </div>
    </Link>
  );
}

function MobileDrawer({
  open,
  onClose,
  expandedCategories,
  activeCategory,
  categories: categoriesData,
  totalCount,
  onToggle,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  expandedCategories: Set<string>;
  activeCategory: string;
  categories: Category[];
  totalCount: number;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
          <motion.aside
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed left-0 top-0 bottom-0 w-72 bg-surface-container-low flex flex-col overflow-y-auto scrollbar-hidden z-50"
          >
            <div className="flex items-center justify-between p-4 border-b border-outline-variant/20">
              <h2 className="text-sm font-bold text-on-surface tracking-wider uppercase font-headline">产品目录</h2>
              <button onClick={onClose} className="p-1 text-on-surface-variant">
                <Icon name="close" size={24} />
              </button>
            </div>
            <div className="flex-1 py-2">
              <button
                onClick={() => { onSelect("all"); onClose(); }}
                className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors ${
                  activeCategory === "all" ? "border-l-2 border-primary-container text-primary-container bg-gradient-to-r from-primary-container/15 to-transparent" : "text-on-surface-variant hover:text-on-surface"
                }`}
              >
                <span className="flex items-center gap-2">
                  <Icon name="category_all" size={18} />
                  全部
                </span>
                <span className="text-[10px] bg-primary/20 px-1.5 py-0.5 rounded-sm text-primary font-medium">{totalCount || categoriesData.reduce((s, c) => s + c.count, 0)}</span>
              </button>
              {categoriesData.map((cat) => {
                const isExpanded = expandedCategories.has(cat.id);
                const hasChildren = cat.children && cat.children.length > 0;
                const isActive = cat.id === activeCategory || (cat.children?.some((c) => c.id === activeCategory) ?? false);
                return (
                  <div key={cat.id}>
                    <button
                      onClick={() => {
                        if (hasChildren) {
                          onToggle(cat.id);
                        } else {
                          onSelect(cat.id);
                          onClose();
                        }
                      }}
                      className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors ${
                        isActive ? "border-l-2 border-primary-container text-primary-container bg-gradient-to-r from-primary-container/15 to-transparent" : "text-on-surface-variant hover:text-on-surface"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <Icon name={cat.icon} size={18} />
                        {cat.name}
                      </span>
                      <span className="flex items-center gap-1.5">
                        {hasChildren && (
                          <motion.span animate={{ rotate: isExpanded ? 180 : 0 }} transition={{ duration: 0.2 }} className="text-on-surface-variant/60">
                            <Icon name="expand_more" size={16} />
                          </motion.span>
                        )}
                        <span className="text-[10px] bg-primary/20 px-1.5 py-0.5 rounded-sm text-primary font-medium">{cat.count}</span>
                      </span>
                    </button>
                    <AnimatePresence>
                      {hasChildren && isExpanded && (
                        <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
                          {cat.children.map((child) => (
                            <button
                              key={child.id}
                              onClick={() => { onSelect(child.id); onClose(); }}
                              className={`w-full text-left ml-8 pr-4 py-2 text-[12px] flex items-center gap-2 ${
                                activeCategory === child.id ? "text-primary-container" : "text-slate-500"
                              }`}
                            >
                              <span className={`w-1 h-1 rounded-full shrink-0 ${activeCategory === child.id ? "bg-primary-container" : "bg-slate-600"}`} />
                              {child.name}
                              <span className="text-[10px] text-on-surface-variant/60 ml-auto">{child.count}</span>
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function ProductCardMobile({ product, onDownload }: { product: Product; onDownload: (id: string) => void }) {
  return (
    <div className="bg-surface-container-high rounded-sm overflow-hidden flex flex-col">
      <Link to={`/model/${product.id}`} className="block">
        <div className="h-[140px] bg-surface-container-lowest relative overflow-hidden flex items-center justify-center">
          {product.thumbnailUrl ? (
            <img src={product.thumbnailUrl} alt={product.name} className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <Icon name="view_in_ar" size={40} className="text-on-surface-variant/15" />
          )}
          <div className="absolute top-2 left-2 flex flex-col gap-0.5">
            {product.formats.map((f) => <FormatTag key={f} format={f} />)}
          </div>
          <span className="absolute top-2 right-2 text-[9px] text-on-surface-variant/60 bg-black/30 backdrop-blur-sm px-1.5 py-0.5 rounded-sm">{product.fileSize}</span>
        </div>
      </Link>
      <div className="p-2.5 flex flex-col flex-1">
        <h3 className="text-xs font-headline text-on-surface mb-1.5 leading-tight line-clamp-2">{product.name}</h3>
        <button
          onClick={() => onDownload(product.id)}
          className="mt-auto w-full text-xs py-1.5 bg-primary-container text-on-primary rounded-sm font-medium flex items-center justify-center gap-1.5"
        >
          <Icon name="download" size={14} fill />
          下载
        </button>
      </div>
    </div>
  );
}

function serverItemToProduct(item: ServerModelListItem): Product {
  const format = item.format?.toUpperCase() || "UNKNOWN";
  return {
    id: item.model_id,
    name: item.name || "未命名模型",
    description: `${format} 格式 3D 模型`,
    formats: [format],
    fileSize: formatFileSize(item.file_size || item.original_size || 0),
    category: item.category || "其他辅料",
    thumbnailUrl: item.thumbnail_url || undefined,
    createdAt: item.created_at || undefined,
    fileSizeBytes: item.file_size || item.original_size || 0,
    variantCount: item.group?.variant_count,
  };
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const PAGE_SIZE = 60;

function Pagination({ page, totalPages, onPageChange, compact = false }: { page: number; totalPages: number; onPageChange: (p: number) => void; compact?: boolean }) {
  if (totalPages <= 1) return null;

  // Build page numbers: always show first, last, current ± 1, and ellipsis
  const pages: (number | "...")[] = [];
  const showPages = compact ? 3 : 5;

  if (totalPages <= showPages + 2) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    const start = Math.max(2, page - 1);
    const end = Math.min(totalPages - 1, page + 1);
    if (start > 2) pages.push("...");
    for (let i = start; i <= end; i++) pages.push(i);
    if (end < totalPages - 1) pages.push("...");
    pages.push(totalPages);
  }

  const btnBase = compact
    ? "w-7 h-7 text-xs rounded-sm"
    : "min-w-[32px] h-8 text-sm rounded-sm";

  return (
    <div className="flex items-center justify-center gap-1 mt-6 pb-4">
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        className={`${btnBase} px-2 border border-outline-variant/30 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high disabled:opacity-30 disabled:cursor-not-allowed transition-colors`}
      >
        ‹
      </button>
      {pages.map((p, i) =>
        p === "..." ? (
          <span key={`e${i}`} className={`${btnBase} flex items-center justify-center text-on-surface-variant/50`}>…</span>
        ) : (
          <button
            key={p}
            onClick={() => onPageChange(p)}
            className={`${btnBase} flex items-center justify-center transition-colors ${
              p === page
                ? "bg-primary-container text-on-primary font-medium"
                : "border border-outline-variant/30 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"
            }`}
          >
            {p}
          </button>
        )
      )}
      <button
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        className={`${btnBase} px-2 border border-outline-variant/30 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high disabled:opacity-30 disabled:cursor-not-allowed transition-colors`}
      >
        ›
      </button>
    </div>
  );
}

export default function HomePage() {
  useDocumentTitle();
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const searchQuery = searchParams.get("q") || "";
  const { isAuthenticated } = useAuthStore();
  const [browseBlocked, setBrowseBlocked] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      getCachedPublicSettings().then(s => {
        if (s.require_login_browse) setBrowseBlocked(true);
      }).catch(() => {});
    }
  }, [isAuthenticated]);

  // Fetch category tree (with counts from server)
  const { data: categoryData } = useSWR("/categories", () => categoriesApi.tree());
  const categories = useMemo(() => buildCategories(categoryData?.items || []), [categoryData]);
  const [totalModelCount, setTotalModelCount] = useState(0);

  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [activeCategory, setActiveCategory] = useState(() => searchParams.get("category") || "all");
  const [page, setPage] = useState(1);

  // Sync URL category param to state when it changes externally (e.g. breadcrumb navigation)
  useEffect(() => {
    const cat = searchParams.get("category");
    if (cat && cat !== activeCategory) {
      setActiveCategory(cat);
      setPage(1);
    }
  }, [searchParams]);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [sortBy, setSortBy] = useState("created_at");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loginPromptOpen, setLoginPromptOpen] = useState(false);
  const { toast } = useToast();

  const handleDownload = useCallback(async (modelId: string) => {
    const token = getAccessToken();
    if (!token) {
      setLoginPromptOpen(true);
      return;
    }
    const url = `/api/models/${modelId}/download?format=original`;
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 401) {
        setLoginPromptOpen(true);
        return;
      }
      if (!res.ok) {
        toast("下载失败，请稍后重试", "error");
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get("content-disposition");
      let filename = `${modelId}.step`;
      if (cd) {
        const utf8Match = cd.match(/filename\*=UTF-8''(.+)/i);
        if (utf8Match) {
          filename = decodeURIComponent(utf8Match[1]);
        } else {
          const asciiMatch = cd.match(/filename="([^"]+)"/);
          if (asciiMatch) filename = asciiMatch[1];
        }
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      toast("下载失败，请检查网络", "error");
    }
  }, [toast]);

  // Server-side filtering with category ID
  const { data: serverData, isLoading } = useModels({
    page,
    pageSize: PAGE_SIZE,
    search: searchQuery,
    categoryId: activeCategory !== "all" ? activeCategory : undefined,
    // sort handled client-side for simplicity
  });

  useEffect(() => {
    if (serverData?.total != null) setTotalModelCount(serverData.total);
    else if (categoryData?.total != null) setTotalModelCount(categoryData.total);
  }, [serverData?.total, categoryData?.total]);

  const products = useMemo(() => {
    if (!serverData?.items) return [];
    return serverData.items.map(serverItemToProduct);
  }, [serverData]);

  const totalPages = serverData?.totalPages || 1;
  const totalItems = serverData?.total || 0;

  const toggleCategory = (id: string) => {
    setExpandedCategories((prev) => {
      if (prev.has(id)) {
        const next = new Set(prev);
        next.delete(id);
        return next;
      }
      return new Set([id]);
    });
  };

  const handleSelectCategory = (id: string) => {
    setActiveCategory(id);
    setPage(1);
    // Clear search when selecting a category
    if (searchQuery) {
      setSearchParams({}, { replace: true });
    }
  };

  // Resolve breadcrumb
  const breadcrumb = useMemo(() => {
    if (activeCategory === "all") return { parent: null, child: null, label: "全部" };
    const parent = categories.find((c) => c.id === activeCategory);
    if (parent) return { parent: parent.name, child: null, label: parent.name };
    for (const cat of categories) {
      const child = cat.children?.find((c) => c.id === activeCategory);
      if (child) return { parent: cat.name, child: child.name, label: `${cat.name} / ${child.name}` };
    }
    return { parent: null, child: null, label: activeCategory };
  }, [activeCategory, categories]);

  if (browseBlocked) {
    return (
      <div className="flex flex-col items-center justify-center h-dvh bg-surface gap-6">
        <Icon name="lock" size={64} className="text-on-surface-variant/30" />
        <h2 className="text-xl font-bold text-on-surface">需要登录</h2>
        <p className="text-sm text-on-surface-variant">浏览模型库需要先登录账号</p>
        <Link to="/login" className="px-6 py-2.5 bg-primary-container text-on-primary rounded-lg text-sm font-medium hover:opacity-90">
          前往登录
        </Link>
      </div>
    );
  }

  if (isDesktop) {
    return (
      <div className="flex flex-col h-dvh overflow-hidden bg-surface">
        <TopNav />
        <div className="flex flex-1 overflow-hidden">
          <CategorySidebar
            expandedCategories={expandedCategories}
            activeCategory={activeCategory}
            categories={categories}
            totalCount={totalModelCount}
            onToggle={toggleCategory}
            onSelect={handleSelectCategory}
          />
          <main className="flex-1 overflow-y-auto scrollbar-hidden bg-surface-dim p-6 relative">
            <AnnouncementBanner />
            <div className="flex justify-between items-end mb-6 border-b border-surface-container-low pb-3 flex-wrap gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm mb-1.5">
                  <Link to="/" className="text-on-surface-variant hover:text-on-surface cursor-pointer transition-colors">首页</Link>
                  <Icon name="chevron_right" size={12} className="text-on-surface-variant/40" />
                  {breadcrumb.parent && !breadcrumb.child ? (
                    <span className="text-primary font-medium">{breadcrumb.label}</span>
                  ) : breadcrumb.parent && breadcrumb.child ? (
                    <>
                      <span className="text-on-surface-variant hover:text-on-surface cursor-pointer transition-colors" onClick={() => { const parent = categories.find(c => c.name === breadcrumb.parent); if (parent) handleSelectCategory(parent.id); }}>{breadcrumb.parent}</span>
                      <Icon name="chevron_right" size={12} className="text-on-surface-variant/40" />
                      <span className="text-primary font-medium">{breadcrumb.child}</span>
                    </>
                  ) : (
                    <span className="text-primary font-medium">{breadcrumb.label}</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-headline font-bold text-on-surface tracking-tight">零件模型库</h1>
                  <span className="bg-surface-container-high px-2 py-0.5 text-xs text-on-surface-variant rounded-sm border border-outline-variant/20">{totalItems} 个模型</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="bg-surface-container-lowest text-sm text-on-surface rounded-sm pl-3 pr-8 py-1 border border-outline-variant/30 outline-none appearance-none cursor-pointer">
                    <option value="created_at">最新上传</option>
                    <option value="name">名称排序</option>
                  </select>
                  <Icon name="expand_more" size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none" />
                </div>
                <div className="flex bg-surface-container rounded-sm border border-outline-variant/30 overflow-hidden">
                  <button onClick={() => setViewMode("grid")} className={`p-1.5 transition-colors ${viewMode === "grid" ? "bg-surface-container-high text-on-surface" : "text-on-surface-variant"}`}>
                    <Icon name="grid_view" size={20} />
                  </button>
                  <button onClick={() => setViewMode("list")} className={`p-1.5 transition-colors ${viewMode === "list" ? "bg-surface-container-high text-on-surface" : "text-on-surface-variant"}`}>
                    <Icon name="view_list" size={20} />
                  </button>
                </div>
              </div>
            </div>

            {isLoading && products.length === 0 ? (
              <div className="flex items-center justify-center py-20">
                <div className="w-8 h-8 border-2 border-primary-container border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <>
                <div className={`grid gap-3 ${viewMode === "grid" ? "grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6" : "grid-cols-1"}`}>
                  {products.map((product) => (
                    <ProductCard key={product.id} product={product} onDownload={handleDownload} />
                  ))}
                </div>

                {products.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-20 gap-4">
                    <Icon name="search_off" size={48} className="text-on-surface-variant/30" />
                    <p className="text-on-surface-variant">没有找到匹配的模型</p>
                  </div>
                )}

                {/* Pagination */}
                <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
              </>
            )}

          </main>
        </div>
        {/* Full-width Footer */}
        <footer className="shrink-0 border-t border-outline-variant/10 bg-surface-container-low">
          <div className="px-8 py-4">
            <div className="flex items-center justify-between gap-8">
              {/* Left: Brand */}
              <span className="font-headline font-semibold text-sm text-on-surface-variant/60 tracking-tight">{getSiteTitle()}</span>
              {/* Right: Links + Email */}
              <div className="flex items-center gap-5">
                {getFooterLinks().map((link, i) => (
                  <a key={i} href={link.url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-on-surface-variant/40 hover:text-on-surface-variant/70 transition-colors">
                    {link.label}
                  </a>
                ))}
                {getContactEmail() && (
                  <a href={`mailto:${getContactEmail()}`} className="flex items-center gap-1.5 text-[11px] text-on-surface-variant/40 hover:text-primary transition-colors">
                    <Icon name="mail" size={13} />
                    <span>{getContactEmail()}</span>
                  </a>
                )}
              </div>
            </div>
            {/* Copyright line */}
            <p className="text-[10px] text-on-surface-variant/25 mt-2.5">
              {getFooterCopyright() || `© ${new Date().getFullYear()} ${getSiteTitle()}. All rights reserved.`}
            </p>
          </div>
        </footer>
        {loginPromptOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={() => setLoginPromptOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-surface-container-high rounded-lg shadow-2xl p-6 w-80 border border-outline-variant/20"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-primary-container/20 flex items-center justify-center">
                  <Icon name="lock" size={20} className="text-primary-container" />
                </div>
                <h3 className="text-lg font-headline font-bold text-on-surface">需要登录</h3>
              </div>
              <p className="text-sm text-on-surface-variant mb-5">下载模型需要先登录账号，是否前往登录？</p>
              <div className="flex gap-3">
                <button onClick={() => setLoginPromptOpen(false)} className="flex-1 py-2.5 text-sm text-on-surface-variant border border-outline-variant/30 rounded-lg hover:bg-surface-container-highest transition-colors">取消</button>
                <button onClick={() => { setLoginPromptOpen(false); navigate("/login"); }} className="flex-1 py-2.5 text-sm font-medium text-on-primary bg-primary-container rounded-lg hover:opacity-90 transition-opacity">前往登录</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </div>
    );
  }

  // Mobile layout
  return (
    <div className="flex flex-col h-dvh bg-surface">
      <TopNav compact onMenuToggle={() => setDrawerOpen((prev) => !prev)} />
      <MobileDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        expandedCategories={expandedCategories}
        activeCategory={activeCategory}
        categories={categories}
        totalCount={totalModelCount}
        onToggle={toggleCategory}
        onSelect={handleSelectCategory}
      />
      <main className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-hidden bg-surface-dim">
        <div className="p-3 space-y-3 pb-20 min-h-full flex flex-col">
          <AnnouncementBanner />
          {/* Header with category filter button */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-base font-headline font-bold text-on-surface">
                {breadcrumb.label === "全部" ? "零件目录" : breadcrumb.label}
              </h1>
              <span className="text-[10px] text-on-surface-variant">{totalItems} 个模型</span>
            </div>
            <button onClick={() => setDrawerOpen(true)} className="p-2 text-on-surface-variant hover:text-on-surface bg-surface-container-high rounded-sm flex items-center gap-1.5">
              <Icon name="tune" size={18} />
              <span className="text-xs">筛选</span>
            </button>
          </div>

          {/* Horizontal scrollable category chips */}
          <div className="flex gap-2 overflow-x-auto scrollbar-hidden pb-1 -mx-3 px-3">
            <button
              onClick={() => handleSelectCategory("all")}
              className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                activeCategory === "all" ? "bg-primary-container text-on-primary" : "bg-surface-container-high text-on-surface-variant"
              }`}
            >
              全部
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => handleSelectCategory(cat.id)}
                className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  activeCategory === cat.id ? "bg-primary-container text-on-primary" : "bg-surface-container-high text-on-surface-variant"
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>

          {/* Model grid */}
          {isLoading && products.length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-2 border-primary-container border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {products.map((product) => (
                <ProductCardMobile key={product.id} product={product} onDownload={handleDownload} />
              ))}
            </div>
          )}

          {products.length === 0 && !isLoading && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Icon name="search_off" size={40} className="text-on-surface-variant/30" />
              <p className="text-sm text-on-surface-variant">没有找到匹配的模型</p>
            </div>
          )}

          {/* Mobile pagination */}
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} compact />

          {/* Footer */}
          <footer className="mt-auto pt-4 border-t border-outline-variant/10 text-center pb-2">
            <div className="flex flex-col items-center gap-2">
              {getContactEmail() && (
                <a href={`mailto:${getContactEmail()}`} className="flex items-center gap-1 text-[11px] text-on-surface-variant/40 hover:text-primary transition-colors">
                  <Icon name="mail" size={12} />
                  <span>{getContactEmail()}</span>
                </a>
              )}
              <p className="text-[10px] text-on-surface-variant/40">© {new Date().getFullYear()} {getSiteTitle()}</p>
            </div>
          </footer>
        </div>
      </main>
      <BottomNav />
      {loginPromptOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setLoginPromptOpen(false)}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="bg-surface-container-high rounded-lg shadow-2xl p-6 w-80 border border-outline-variant/20"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-primary-container/20 flex items-center justify-center">
                <Icon name="lock" size={20} className="text-primary-container" />
              </div>
              <h3 className="text-lg font-headline font-bold text-on-surface">需要登录</h3>
            </div>
            <p className="text-sm text-on-surface-variant mb-5">下载模型需要先登录账号，是否前往登录？</p>
            <div className="flex gap-3">
              <button onClick={() => setLoginPromptOpen(false)} className="flex-1 py-2.5 text-sm text-on-surface-variant border border-outline-variant/30 rounded-lg hover:bg-surface-container-highest transition-colors">取消</button>
              <button onClick={() => { setLoginPromptOpen(false); navigate("/login"); }} className="flex-1 py-2.5 text-sm font-medium text-on-primary bg-primary-container rounded-lg hover:opacity-90 transition-opacity">前往登录</button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </div>
  );
}
