import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type PointerEvent, type WheelEvent } from "react";
import useSWR from "swr";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import SafeImage from "../components/shared/SafeImage";
import { AdminPageShell } from "../components/shared/AdminPageShell";
import { AdminManagementPage } from "../components/shared/AdminManagementPage";
import Icon from "../components/shared/Icon";
import ResponsiveSectionTabs from "../components/shared/ResponsiveSectionTabs";
import { copyText } from "../lib/clipboard";
import { getBusinessConfig } from "../lib/businessConfig";
import { useAuthStore } from "../stores/useAuthStore";
import { useToast } from "../components/shared/Toast";
import {
  createProductWallCategory,
  deleteProductWallCategory,
  deleteProductWallItem,
  deleteProductWallItems,
  listAdminProductWallCategories,
  listAdminProductWallItems,
  listProductWallCategories,
  listProductWallItems,
  reviewProductWallItem,
  updateProductWallCategory,
  updateProductWallItem,
  uploadProductWallImages,
  type ProductWallItem,
  type ProductWallKind,
  type ProductWallStatus,
} from "../api/productWall";

type WallItem = ProductWallItem;

type WallFilter = string;
type ReviewFilter = "all" | ProductWallStatus;
type ManagementKindFilter = "全部" | ProductWallKind;
type ProductWallCanvasMode = "white" | "checker";
type WebkitFileSystemEntry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
};
type WebkitFileSystemFileEntry = WebkitFileSystemEntry & {
  file: (success: (file: File) => void, error?: (error: DOMException) => void) => void;
};
type WebkitFileSystemDirectoryEntry = WebkitFileSystemEntry & {
  createReader: () => {
    readEntries: (success: (entries: WebkitFileSystemEntry[]) => void, error?: (error: DOMException) => void) => void;
  };
};
type DataTransferItemWithEntry = DataTransferItem & {
  webkitGetAsEntry?: () => WebkitFileSystemEntry | null;
};

const PRODUCT_WALL_UPLOAD_BATCH_SIZE = 20;
const PRODUCT_WALL_RENDER_BATCH_SIZE = 24;
const PRODUCT_WALL_CANVAS_MODE_KEY = "product-wall-canvas-mode";
const PRODUCT_WALL_DEFAULT_KIND_KEY = "product-wall-default-kind";
const PRODUCT_WALL_FAVORITES_KEY_PREFIX = "product-wall-favorites";
const PRODUCT_WALL_FAVORITES_FILTER = "我的收藏";

function isZipFile(file: File) {
  return file.type === "application/zip" || file.type === "application/x-zip-compressed" || file.name.toLowerCase().endsWith(".zip");
}

function isRarFile(file: File) {
  return file.type === "application/vnd.rar" || file.type === "application/x-rar-compressed" || file.name.toLowerCase().endsWith(".rar");
}

function isImageFile(file: File) {
  return file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(file.name);
}

function isSupportedUploadFile(file: File) {
  return isImageFile(file) || isZipFile(file) || isRarFile(file);
}

function readDirectoryEntries(entry: WebkitFileSystemDirectoryEntry): Promise<WebkitFileSystemEntry[]> {
  const reader = entry.createReader();
  const entries: WebkitFileSystemEntry[] = [];
  return new Promise((resolve, reject) => {
    const readBatch = () => {
      reader.readEntries((batch) => {
        if (!batch.length) {
          resolve(entries);
          return;
        }
        entries.push(...batch);
        readBatch();
      }, reject);
    };
    readBatch();
  });
}

function readFileEntry(entry: WebkitFileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function collectFilesFromEntry(entry: WebkitFileSystemEntry): Promise<File[]> {
  if (entry.isFile) return [await readFileEntry(entry as WebkitFileSystemFileEntry)];
  if (!entry.isDirectory) return [];
  const children = await readDirectoryEntries(entry as WebkitFileSystemDirectoryEntry);
  const nested = await Promise.all(children.map(collectFilesFromEntry));
  return nested.flat();
}

async function collectFilesFromDataTransfer(dataTransfer: DataTransfer) {
  const items = Array.from(dataTransfer.items || []) as DataTransferItemWithEntry[];
  if (!items.length) return Array.from(dataTransfer.files);
  const nested = await Promise.all(items.map(async (item) => {
    const entry = item.webkitGetAsEntry?.();
    if (entry) return collectFilesFromEntry(entry);
    const file = item.getAsFile();
    return file ? [file] : [];
  }));
  return nested.flat();
}
const REVIEW_FILTERS: Array<{ key: ReviewFilter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "pending", label: "待审核" },
  { key: "approved", label: "已通过" },
  { key: "rejected", label: "已拒绝" },
];
const STATUS_LABELS: Record<ProductWallStatus, string> = {
  pending: "待审核",
  approved: "已通过",
  rejected: "已拒绝",
};

function wallImageUrl(item: WallItem) {
  if (typeof window === "undefined") return item.image;
  return new URL(item.image, window.location.origin).toString();
}

function productWallDownloadName(item: WallItem) {
  const ext = item.image.split(".").pop()?.split("?")[0] || "webp";
  return `${item.title}.${ext}`;
}

function productWallPreviewImage(item: WallItem) {
  return item.previewImage || item.image;
}

function productWallRatioValue(ratio: string) {
  const [width, height] = ratio.split("/").map((part) => Number(part.trim()));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 4 / 5;
  return width / height;
}

function getProductWallColumnCount() {
  if (typeof window === "undefined") return 2;
  const width = window.innerWidth;
  if (width >= 1680) return 5;
  if (width >= 1280) return 4;
  if (width >= 860) return 3;
  return 2;
}

function errorMessage(error: unknown, fallback = "操作失败，请稍后重试") {
  const detail = (error as { response?: { data?: { detail?: string; message?: string } } })?.response?.data;
  return detail?.detail || detail?.message || (error instanceof Error ? error.message : fallback);
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function PreviewActionButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: string;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`product-wall-preview-action inline-flex h-9 w-9 items-center justify-center rounded-full border transition-colors ${
        active
          ? "border-primary-container/25 bg-primary-container/10 text-primary-container"
          : "border-outline-variant/16 bg-transparent text-on-surface-variant hover:border-outline-variant/28 hover:bg-surface-container-high hover:text-on-surface"
      }`}
      title={label}
      aria-label={label}
    >
      <Icon name={icon} size={16} />
    </button>
  );
}

export default function ProductWallPage() {
  useDocumentTitle("产品影像");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const previewDragRef = useRef({ active: false, moved: false, startX: 0, startY: 0, panX: 0, panY: 0 });
  const { user, isAuthenticated, hasHydrated } = useAuthStore();
  const { toast } = useToast();
  const { uploadPolicy } = getBusinessConfig();
  const productWallMaxImageBytes = Math.max(1, uploadPolicy.productWallImageMaxSizeMb) * 1024 * 1024;
  const isLoggedIn = hasHydrated && isAuthenticated;
  const isAdmin = isLoggedIn && user?.role === "ADMIN";
  const canUpload = isLoggedIn;
  const { data, error: itemsError, mutate, isLoading } = useSWR(
    isAdmin ? "admin-product-wall-items" : "product-wall-items",
    isAdmin ? listAdminProductWallItems : listProductWallItems,
  );
  const { data: categories, error: categoriesError, mutate: mutateCategories, isLoading: categoriesLoading } = useSWR(
    isAdmin ? "admin-product-wall-categories" : "product-wall-categories",
    isAdmin ? listAdminProductWallCategories : listProductWallCategories,
  );
  const [active, setActive] = useState<WallItem | null>(null);
  const [filter, setFilter] = useState<WallFilter>("全部");
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("approved");
  const [managementKindFilter, setManagementKindFilter] = useState<ManagementKindFilter>("全部");
  const [query, setQuery] = useState("");
  const [managementOpen, setManagementOpen] = useState(false);
  const [managementQuery, setManagementQuery] = useState("");
  const [categoryDraft, setCategoryDraft] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const [manageMenuOpen, setManageMenuOpen] = useState(false);
  const [canvasMode, setCanvasMode] = useState<ProductWallCanvasMode>(() => {
    if (typeof window === "undefined") return "white";
    const saved = window.localStorage.getItem(PRODUCT_WALL_CANVAS_MODE_KEY);
    return saved === "checker" ? "checker" : "white";
  });
  const [defaultUploadKind, setDefaultUploadKind] = useState<ProductWallKind>(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(PRODUCT_WALL_DEFAULT_KIND_KEY) || "";
  });
  const [wallEditMode, setWallEditMode] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [renderCount, setRenderCount] = useState(PRODUCT_WALL_RENDER_BATCH_SIZE);
  const [editingItem, setEditingItem] = useState<WallItem | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<
    | { type: "single"; item: WallItem }
    | { type: "batch"; ids: string[] }
    | null
  >(null);
  const [deleting, setDeleting] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editKind, setEditKind] = useState<ProductWallKind>("公司产品");
  const [editTags, setEditTags] = useState("");
  const [favoriteImages, setFavoriteImages] = useState<Set<string>>(() => new Set());
  const [shareState, setShareState] = useState<"idle" | "copied">("idle");
  const [previewZoom, setPreviewZoom] = useState(1);
  const [previewPan, setPreviewPan] = useState({ x: 0, y: 0 });
  const [previewDragging, setPreviewDragging] = useState(false);
  const [columnCount, setColumnCount] = useState(getProductWallColumnCount);
  const apiError = itemsError || categoriesError;
  const initialLoading = (isLoading && !data) || (categoriesLoading && !categories);
  const items = data ?? [];
  const databaseCategoryNames = (categories || []).map((item) => item.name).filter(Boolean);
  const categoryNames = Array.from(new Set(databaseCategoryNames));
  const filters: WallFilter[] = ["全部", PRODUCT_WALL_FAVORITES_FILTER, ...categoryNames];
  const favoriteStorageKey = isLoggedIn && user?.id ? `${PRODUCT_WALL_FAVORITES_KEY_PREFIX}:${user.id}` : null;
  const resolvedDefaultUploadKind = categoryNames.includes(defaultUploadKind)
    ? defaultUploadKind
    : (categoryNames[0] || "");
  const isUtilityFilter = filter === "全部" || filter === PRODUCT_WALL_FAVORITES_FILTER;
  const isFavoritesFilter = filter === PRODUCT_WALL_FAVORITES_FILTER;
  const uploadKind = isUtilityFilter ? resolvedDefaultUploadKind : filter;
  const uploadDisabled = uploading || !uploadKind;
  const uploadHintFull = isAdmin
    ? uploadKind
      ? `${isUtilityFilter ? "默认上传到" : "上传到"}「${uploadKind}」`
      : "请先创建产品影像分类"
    : "投稿审核后展示";
  const normalizedQuery = query.trim().toLowerCase();
  const normalizedManagementQuery = managementQuery.trim().toLowerCase();
  const approvedItems = items.filter((item) => item.status === "approved");
  const filteredBaseItems = filter === "全部"
    ? approvedItems
    : filter === PRODUCT_WALL_FAVORITES_FILTER
      ? (isLoggedIn ? approvedItems.filter((item) => favoriteImages.has(item.image)) : [])
      : approvedItems.filter((item) => item.kind === filter);
  const visibleItems = filteredBaseItems.filter((item) => {
    if (!normalizedQuery) return true;
    return [item.title, item.kind, ...item.tags].some((value) => value.toLowerCase().includes(normalizedQuery));
  });
  const renderedItems = visibleItems.slice(0, renderCount);
  const hasMoreVisibleItems = renderedItems.length < visibleItems.length;
  const masonryColumns = renderedItems.reduce<WallItem[][]>((columns, item) => {
    let shortestColumnIndex = 0;
    for (let index = 1; index < columns.length; index += 1) {
      const currentHeight = columns[index].reduce((sum, image) => sum + 1 / productWallRatioValue(image.ratio), 0);
      const shortestHeight = columns[shortestColumnIndex].reduce((sum, image) => sum + 1 / productWallRatioValue(image.ratio), 0);
      if (currentHeight < shortestHeight) shortestColumnIndex = index;
    }
    columns[shortestColumnIndex].push(item);
    return columns;
  }, Array.from({ length: columnCount }, () => [] as WallItem[]));
  const managementStatusItems = reviewFilter === "all" ? items : items.filter((item) => item.status === reviewFilter);
  const managementBaseItems = managementKindFilter === "全部"
    ? managementStatusItems
    : managementStatusItems.filter((item) => item.kind === managementKindFilter);
  const managementItems = managementBaseItems.filter((item) => {
    if (!normalizedManagementQuery) return true;
    return [item.title, item.kind, item.uploaderName || "", ...item.tags].some((value) => value.toLowerCase().includes(normalizedManagementQuery));
  });
  const filterCounts = filters.reduce<Record<string, number>>((acc, item) => {
    acc[item] = item === "全部"
      ? approvedItems.length
      : item === PRODUCT_WALL_FAVORITES_FILTER
        ? (isLoggedIn ? approvedItems.filter((image) => favoriteImages.has(image.image)).length : 0)
        : approvedItems.filter((image) => image.kind === item).length;
    return acc;
  }, {});
  const categoryImageCounts = categoryNames.reduce<Record<string, number>>((acc, name) => {
    acc[name] = items.filter((item) => item.kind === name).length;
    return acc;
  }, {});
  const reviewCounts: Record<ReviewFilter, number> = {
    all: items.length,
    pending: items.filter((item) => item.status === "pending").length,
    approved: items.filter((item) => item.status === "approved").length,
    rejected: items.filter((item) => item.status === "rejected").length,
  };
  const canManageItem = (item?: WallItem) => Boolean(item?.id || item === undefined) && isAdmin;
  const selectableVisibleItems = visibleItems.filter(canManageItem);
  const activeFavorited = active ? favoriteImages.has(active.image) : false;
  const selectedCount = selectedIds.size;
  const previewZoomed = previewZoom > 1.01;
  const syncUpdatedWallItem = (updated: WallItem) => {
    setActive((current) => (current?.id === updated.id ? updated : current));
    setEditingItem((current) => (current?.id === updated.id ? updated : current));
    void mutate((current) => current?.map((item) => (item.id === updated.id ? updated : item)), { revalidate: false });
    void mutate();
  };
  const toggleFavorite = () => {
    if (!active) return;
    if (!isLoggedIn || !favoriteStorageKey) {
      toast("请先登录后再收藏图片", "error");
      return;
    }
    const imageUrl = active.image;
    setFavoriteImages((prev) => {
      const next = new Set(prev);
      const wasFavorite = next.has(imageUrl);
      if (wasFavorite) next.delete(imageUrl);
      else next.add(imageUrl);
      window.localStorage.setItem(favoriteStorageKey, JSON.stringify(Array.from(next)));
      toast(wasFavorite ? "已取消收藏" : "已收藏，可在产品影像「我的收藏」查看", "success");
      return next;
    });
  };
  const shareActiveImage = async () => {
    if (!active) return;
    const url = wallImageUrl(active);
    try {
      if (navigator.share) {
        await navigator.share({ title: active.title, text: active.kind, url });
      } else {
        await copyText(url);
        setShareState("copied");
        window.setTimeout(() => setShareState("idle"), 1600);
      }
    } catch {
      try {
        await copyText(url);
        setShareState("copied");
        window.setTimeout(() => setShareState("idle"), 1600);
      } catch {
        setShareState("idle");
      }
    }
  };
  const uploadFiles = useCallback(async (fileList: FileList | File[]) => {
    if (!canUpload) {
      toast("请先登录后再上传图片", "error");
      return;
    }
    if (!uploadKind) {
      toast("请先创建产品影像分类后再上传", "error");
      return;
    }
    const supportedFiles = Array.from(fileList).filter(isSupportedUploadFile);
    const oversizedImages = supportedFiles.filter((file) => isImageFile(file) && file.size > productWallMaxImageBytes);
    const files = supportedFiles.filter((file) => !oversizedImages.includes(file));
    if (!files.length) {
      if (oversizedImages.length) {
        const sample = oversizedImages.slice(0, 3).map((file) => `${file.name} ${formatFileSize(file.size)}`).join("、");
        toast(`已跳过 ${oversizedImages.length} 张超过 ${uploadPolicy.productWallImageMaxSizeMb}MB 的图片：${sample}`, "error");
      } else {
        toast("请选择图片、文件夹或 zip/rar 压缩包", "error");
      }
      return;
    }
    setUploading(true);
    try {
      let uploadedCount = 0;
      const failedMessages: string[] = [];
      for (let index = 0; index < files.length; index += PRODUCT_WALL_UPLOAD_BATCH_SIZE) {
        const batch = files.slice(index, index + PRODUCT_WALL_UPLOAD_BATCH_SIZE);
        try {
          const result = await uploadProductWallImages(batch, { admin: isAdmin, kind: uploadKind });
          uploadedCount += result.items.length;
        } catch (error) {
          failedMessages.push(errorMessage(error, "上传失败"));
        }
      }
      await mutate();
      if (uploadedCount) {
        const skippedText = oversizedImages.length ? `，已跳过 ${oversizedImages.length} 张超限图片` : "";
        toast(isAdmin ? `已上传 ${uploadedCount} 张图片到「${uploadKind}」${skippedText}` : `已提交 ${uploadedCount} 张图片，审核通过后展示${skippedText}`, "success");
      } else if (failedMessages.length) {
        toast(Array.from(new Set(failedMessages)).slice(0, 2).join("；"), "error");
      }
      if (uploadedCount && failedMessages.length) {
        toast(`部分图片上传失败：${Array.from(new Set(failedMessages)).slice(0, 2).join("；")}`, "error");
      } else if (!uploadedCount && oversizedImages.length) {
        const sample = oversizedImages.slice(0, 3).map((file) => `${file.name} ${formatFileSize(file.size)}`).join("、");
        toast(`已跳过 ${oversizedImages.length} 张超过 ${uploadPolicy.productWallImageMaxSizeMb}MB 的图片：${sample}`, "error");
      }
    } catch (error) {
      toast(errorMessage(error, "上传图片失败"), "error");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (folderInputRef.current) folderInputRef.current.value = "";
    }
  }, [canUpload, isAdmin, mutate, productWallMaxImageBytes, toast, uploadKind, uploadPolicy.productWallImageMaxSizeMb]);
  const handlePaste = async (event: ClipboardEvent<HTMLDivElement>) => {
    if (!canUpload) return;
    const pastedImages = Array.from(event.clipboardData.files)
      .filter((file) => file.type.startsWith("image/"));
    if (pastedImages.length) {
      event.preventDefault();
      await uploadFiles(pastedImages);
      return;
    }
  };
  useEffect(() => {
    const updateColumnCount = () => setColumnCount(getProductWallColumnCount());
    updateColumnCount();
    window.addEventListener("resize", updateColumnCount);
    return () => window.removeEventListener("resize", updateColumnCount);
  }, []);
  useEffect(() => {
    if (!canUpload) return;
    const hasFiles = (event: globalThis.DragEvent) => Array.from(event.dataTransfer?.types || []).includes("Files");
    const handleDocumentDragOver = (event: globalThis.DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDragActive(true);
    };
    const handleDocumentDragLeave = (event: globalThis.DragEvent) => {
      if (event.clientX <= 0 || event.clientY <= 0 || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight) {
        setDragActive(false);
      }
    };
    const handleDocumentDrop = (event: globalThis.DragEvent) => {
      if (!hasFiles(event) || !event.dataTransfer) return;
      event.preventDefault();
      setDragActive(false);
      void collectFilesFromDataTransfer(event.dataTransfer).then(uploadFiles);
    };
    document.addEventListener("dragover", handleDocumentDragOver);
    document.addEventListener("dragleave", handleDocumentDragLeave);
    document.addEventListener("drop", handleDocumentDrop);
    return () => {
      document.removeEventListener("dragover", handleDocumentDragOver);
      document.removeEventListener("dragleave", handleDocumentDragLeave);
      document.removeEventListener("drop", handleDocumentDrop);
    };
  }, [canUpload, uploadFiles]);
  useEffect(() => {
    setRenderCount(PRODUCT_WALL_RENDER_BATCH_SIZE);
    setSelectedIds(new Set());
    setWallEditMode(false);
    setSelectionMode(false);
  }, [filter, normalizedQuery]);
  useEffect(() => {
    setSelectedIds(new Set());
  }, [reviewFilter, managementKindFilter, normalizedManagementQuery]);
  useEffect(() => {
    setPreviewZoom(1);
    setPreviewPan({ x: 0, y: 0 });
    setPreviewDragging(false);
    previewDragRef.current = { active: false, moved: false, startX: 0, startY: 0, panX: 0, panY: 0 };
  }, [active?.id]);
  useEffect(() => {
    if (!favoriteStorageKey) {
      setFavoriteImages(new Set());
      return;
    }
    try {
      const saved = JSON.parse(window.localStorage.getItem(favoriteStorageKey) || "[]");
      setFavoriteImages(new Set(Array.isArray(saved) ? saved.filter((item): item is string => typeof item === "string") : []));
    } catch {
      setFavoriteImages(new Set());
    }
  }, [favoriteStorageKey]);
  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasMoreVisibleItems) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setRenderCount((count) => Math.min(count + PRODUCT_WALL_RENDER_BATCH_SIZE, visibleItems.length));
    }, { rootMargin: "480px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMoreVisibleItems, visibleItems.length]);
  useEffect(() => {
    if (!uploadMenuOpen && !manageMenuOpen) return;
    const close = () => {
      setUploadMenuOpen(false);
      setManageMenuOpen(false);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [uploadMenuOpen, manageMenuOpen]);
  useEffect(() => {
    if (!active || editingItem || deleteDialog) return;
    const closePreview = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setActive(null);
    };
    window.addEventListener("keydown", closePreview);
    return () => window.removeEventListener("keydown", closePreview);
  }, [active, editingItem, deleteDialog]);
  const setPreviewZoomLevel = (value: number) => {
    const nextZoom = Math.min(3, Math.max(1, value));
    setPreviewZoom(nextZoom);
    if (nextZoom <= 1.01) setPreviewPan({ x: 0, y: 0 });
  };
  const togglePreviewZoom = () => {
    setPreviewZoomLevel(previewZoomed ? 1 : 2.15);
  };
  const handlePreviewWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    setPreviewZoomLevel(previewZoom + (event.deltaY > 0 ? -0.18 : 0.18));
  };
  const handlePreviewPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (!previewZoomed) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    previewDragRef.current = {
      active: true,
      moved: false,
      startX: event.clientX,
      startY: event.clientY,
      panX: previewPan.x,
      panY: previewPan.y,
    };
    setPreviewDragging(true);
  };
  const handlePreviewPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const dragState = previewDragRef.current;
    if (!dragState.active) return;
    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) dragState.moved = true;
    setPreviewPan({ x: dragState.panX + dx, y: dragState.panY + dy });
  };
  const handlePreviewPointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    if (!previewDragRef.current.active) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    previewDragRef.current.active = false;
    setPreviewDragging(false);
  };
  const handlePreviewImageClick = () => {
    if (previewDragRef.current.moved) {
      previewDragRef.current.moved = false;
      return;
    }
    togglePreviewZoom();
  };
  const changeCanvasMode = (mode: ProductWallCanvasMode) => {
    setCanvasMode(mode);
    window.localStorage.setItem(PRODUCT_WALL_CANVAS_MODE_KEY, mode);
  };
  const changeDefaultUploadKind = (kind: ProductWallKind) => {
    setDefaultUploadKind(kind);
    window.localStorage.setItem(PRODUCT_WALL_DEFAULT_KIND_KEY, kind);
  };
  const openEditItem = (item: WallItem) => {
    setEditingItem(item);
    setEditTitle(item.title);
    setEditKind(item.kind);
    setEditTags(item.tags.join("，"));
  };
  const saveEditingItem = async () => {
    if (!editingItem) return;
    try {
      const updated = await updateProductWallItem(editingItem.id, {
        title: editTitle,
        tags: editTags,
        kind: editKind,
      });
      syncUpdatedWallItem(updated);
      setEditingItem(null);
      toast("图片信息已更新", "success");
    } catch (error) {
      toast(errorMessage(error, "更新失败"), "error");
    }
  };
  const removeItem = async (item: WallItem) => {
    setDeleteDialog({ type: "single", item });
  };
  const confirmDelete = async () => {
    if (!deleteDialog) return;
    setDeleting(true);
    try {
      if (deleteDialog.type === "single") {
        await deleteProductWallItem(deleteDialog.item.id);
        if (active?.id === deleteDialog.item.id) setActive(null);
        await mutate();
        toast("图片已删除", "success");
      } else {
        const result = await deleteProductWallItems(deleteDialog.ids);
        setSelectedIds(new Set());
        setSelectionMode(false);
        if (active && deleteDialog.ids.includes(active.id)) setActive(null);
        await mutate();
        toast(`已删除 ${result.deleted} 张图片`, "success");
      }
      setDeleteDialog(null);
    } catch (error) {
      toast(errorMessage(error, deleteDialog.type === "single" ? "删除失败" : "批量删除失败"), "error");
    } finally {
      setDeleting(false);
    }
  };
  const toggleSelectedItem = (item: WallItem) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  };
  const clearSelection = () => {
    setSelectedIds(new Set());
    setSelectionMode(false);
  };
  const selectCurrentManagementItems = () => {
    setSelectionMode(true);
    setSelectedIds(new Set(managementItems.map((item) => item.id)));
  };
  const selectCurrentVisibleItems = () => {
    setSelectionMode(true);
    setSelectedIds(new Set(selectableVisibleItems.map((item) => item.id)));
  };
  const openManagementPanel = () => {
    setManagementKindFilter(
      filter !== "全部" && filter !== PRODUCT_WALL_FAVORITES_FILTER && categoryNames.includes(filter)
        ? (filter as ProductWallKind)
        : "全部",
    );
    setSelectedIds(new Set());
    setSelectionMode(false);
    setManagementOpen(true);
  };
  const closeManagement = () => {
    setManagementOpen(false);
    setSelectedIds(new Set());
    setSelectionMode(false);
  };
  const removeSelectedItems = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) {
      toast("请先选择要删除的图片", "error");
      return;
    }
    setDeleteDialog({ type: "batch", ids });
  };
  const reviewItem = async (item: WallItem, status: "approved" | "rejected") => {
    const rejectReason = status === "rejected" ? window.prompt("拒绝原因，可留空", item.rejectReason || "") || undefined : undefined;
    try {
      const updated = await reviewProductWallItem(item.id, { status, rejectReason });
      syncUpdatedWallItem(updated);
      toast(status === "approved" ? "图片已通过审核" : "图片已拒绝", "success");
    } catch (error) {
      toast(errorMessage(error, "审核失败"), "error");
    }
  };
  const addCategory = async () => {
    const name = categoryDraft.trim();
    if (!name) {
      toast("请输入分类名称", "error");
      return;
    }
    try {
      await createProductWallCategory(name);
      setCategoryDraft("");
      await mutateCategories();
      toast("分类已创建", "success");
    } catch (error) {
      toast(errorMessage(error, "创建分类失败"), "error");
    }
  };
  const startEditCategory = (id: string, name: string) => {
    setEditingCategoryId(id);
    setEditingCategoryName(name);
  };
  const saveCategory = async (id: string) => {
    const name = editingCategoryName.trim();
    if (!name) {
      toast("分类名称不能为空", "error");
      return;
    }
    try {
      const oldName = categories?.find((item) => item.id === id)?.name;
      await updateProductWallCategory(id, { name });
      if (filter === oldName) setFilter(name);
      if (managementKindFilter === oldName) setManagementKindFilter(name as ProductWallKind);
      if (oldName && oldName !== name) {
        void mutate(
          (current) => current?.map((item) => (item.kind === oldName ? { ...item, kind: name } : item)),
          { revalidate: false },
        );
      }
      void mutateCategories(
        (current) => current?.map((item) => (item.id === id ? { ...item, name } : item)),
        { revalidate: false },
      );
      setEditingCategoryId(null);
      setEditingCategoryName("");
      await mutateCategories();
      await mutate();
      toast("分类已更新", "success");
    } catch (error) {
      toast(errorMessage(error, "更新分类失败"), "error");
    }
  };
  const removeCategory = async (id: string, name: string) => {
    if (!window.confirm(`确定删除分类「${name}」吗？仅空分类可以删除。`)) return;
    try {
      await deleteProductWallCategory(id);
      if (filter === name) setFilter("全部");
      if (managementKindFilter === name) setManagementKindFilter("全部");
      await mutateCategories();
      toast("分类已删除", "success");
    } catch (error) {
      toast(errorMessage(error, "删除分类失败"), "error");
    }
  };
  const actionButtonBase = "product-wall-action inline-flex h-9 w-9 items-center justify-center gap-1.5 rounded-sm px-0 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-container/35 disabled:cursor-not-allowed disabled:opacity-45 md:h-8 md:w-auto md:min-w-[96px] md:rounded-md md:px-3";
  const secondaryActionButton = `${actionButtonBase} font-medium text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface`;
  const managementButtonLabel = selectionMode
    ? `批量管理${selectedCount ? `(${selectedCount})` : ""}`
    : wallEditMode
      ? "编辑中"
      : "管理操作";
  const headerActions = canUpload ? (
    <div className="product-wall-action-row flex w-auto items-center justify-end gap-1.5 md:flex-wrap md:gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.zip,.rar,application/zip,application/vnd.rar"
        multiple
        className="hidden"
        onChange={(event) => event.target.files && void uploadFiles(event.target.files)}
      />
      <input
        ref={(node) => {
          folderInputRef.current = node;
          if (node) {
            node.setAttribute("webkitdirectory", "");
            node.setAttribute("directory", "");
          }
        }}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => event.target.files && void uploadFiles(event.target.files)}
      />
      <div className="product-wall-action relative md:hidden" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          onClick={() => setManageMenuOpen((value) => !value)}
          className={`${actionButtonBase} border border-outline-variant/24 font-medium text-on-surface hover:bg-surface-container-high`}
        >
          <Icon name="more_horiz" size={16} />
          <span className="sr-only">产品影像操作</span>
        </button>
        {manageMenuOpen && (
          <div className="fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[10001] overflow-hidden rounded-xl border border-outline-variant/14 bg-surface shadow-[0_22px_70px_rgba(0,0,0,0.22)]">
            <button
              type="button"
              disabled={uploadDisabled}
              onClick={() => {
                setManageMenuOpen(false);
                fileInputRef.current?.click();
              }}
              className="flex h-10 w-full items-center gap-2 px-3 text-left text-sm text-on-surface transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Icon name={uploading ? "sync" : "cloud_upload"} size={16} />
              本地图片 / 压缩包
            </button>
            <button
              type="button"
              disabled={uploadDisabled}
              onClick={() => {
                setManageMenuOpen(false);
                folderInputRef.current?.click();
              }}
              className="flex h-10 w-full items-center gap-2 px-3 text-left text-sm text-on-surface transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Icon name="folder" size={16} />
              选择文件夹
            </button>
            {isAdmin && (
              <>
                <div className="h-px bg-outline-variant/12" />
                <button
                  type="button"
                  disabled={!selectableVisibleItems.length}
                  onClick={() => {
                    setManageMenuOpen(false);
                    setWallEditMode((value) => !value);
                    setSelectionMode(false);
                    setSelectedIds(new Set());
                  }}
                  className="flex h-10 w-full items-center gap-2 px-3 text-left text-sm text-on-surface transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Icon name={wallEditMode ? "close" : "edit"} size={16} />
                  {wallEditMode ? "退出编辑" : "编辑图片"}
                </button>
                <button
                  type="button"
                  disabled={!selectableVisibleItems.length}
                  onClick={() => {
                    setManageMenuOpen(false);
                    setSelectionMode((value) => !value);
                    setWallEditMode(false);
                    if (selectionMode) setSelectedIds(new Set());
                  }}
                  className="flex h-10 w-full items-center gap-2 px-3 text-left text-sm text-on-surface transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Icon name={selectionMode ? "close" : "delete"} size={16} />
                  {selectionMode ? "退出批量" : "批量删除"}
                </button>
                {selectionMode && (
                  <>
                    <div className="h-px bg-outline-variant/12" />
                    <button
                      type="button"
                      onClick={() => {
                        setManageMenuOpen(false);
                        selectCurrentVisibleItems();
                      }}
                      disabled={!selectableVisibleItems.length}
                      className="flex h-10 w-full items-center gap-2 px-3 text-left text-sm text-on-surface transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <Icon name="check" size={16} />
                      全选当前
                    </button>
                    <button
                      type="button"
                      disabled={!selectedCount}
                      onClick={() => {
                        setManageMenuOpen(false);
                        void removeSelectedItems();
                      }}
                      className="flex h-10 w-full items-center gap-2 px-3 text-left text-sm text-red-600 transition-colors hover:bg-red-500/8 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <Icon name="delete" size={16} />
                      删除已选{selectedCount ? ` (${selectedCount})` : ""}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setManageMenuOpen(false);
                        clearSelection();
                      }}
                      className="flex h-10 w-full items-center gap-2 px-3 text-left text-sm text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
                    >
                      <Icon name="close" size={16} />
                      取消选择
                    </button>
                  </>
                )}
                <div className="h-px bg-outline-variant/12" />
                <button
                  type="button"
                  onClick={() => {
                    setManageMenuOpen(false);
                    openManagementPanel();
                  }}
                  className="flex h-10 w-full items-center gap-2 px-3 text-left text-sm text-on-surface transition-colors hover:bg-surface-container-high"
                >
                  <Icon name="image" size={16} />
                  图片管理
                </button>
              </>
            )}
          </div>
        )}
      </div>
      <div className="hidden items-center justify-end gap-1 rounded-xl border border-outline-variant/12 bg-surface-container-low/75 p-1 shadow-[0_8px_24px_rgba(20,18,15,0.04)] md:flex">
        <span
          className="hidden h-8 min-w-0 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-on-surface-variant lg:flex"
          title={uploadHintFull}
        >
          <Icon name="folder" size={14} className="text-primary-container/75" />
          <span className="text-on-surface-variant/70">{isUtilityFilter ? "默认" : "当前"}</span>
          <span className="max-w-20 truncate text-on-surface">{uploadKind || "未设置"}</span>
        </span>
        <div className="product-wall-action relative" onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            disabled={uploadDisabled}
            onClick={() => setUploadMenuOpen((value) => !value)}
            className={`${actionButtonBase} bg-primary-container/12 font-semibold text-primary-container hover:bg-primary-container/18 disabled:opacity-55`}
            aria-label="上传图片"
            title="上传图片"
          >
            <Icon name={uploading ? "sync" : "cloud_upload"} size={16} />
            <span className="hidden md:inline">上传图片</span>
          </button>
          {uploadMenuOpen && (
            <div className="absolute right-0 top-11 z-30 w-44 overflow-hidden rounded-md border border-outline-variant/18 bg-surface shadow-[0_16px_46px_rgba(0,0,0,0.16)]">
              <button
                type="button"
                onClick={() => {
                  setUploadMenuOpen(false);
                  fileInputRef.current?.click();
                }}
                className="flex h-10 w-full items-center gap-2 px-3 text-left text-sm text-on-surface transition-colors hover:bg-surface-container-high"
              >
                <Icon name="cloud_upload" size={16} />
                本地图片 / 压缩包
              </button>
              <button
                type="button"
                onClick={() => {
                  setUploadMenuOpen(false);
                  folderInputRef.current?.click();
                }}
                className="flex h-10 w-full items-center gap-2 px-3 text-left text-sm text-on-surface transition-colors hover:bg-surface-container-high"
              >
                <Icon name="folder" size={16} />
                选择文件夹
              </button>
            </div>
          )}
        </div>
        {isAdmin && (
          <>
            <div className="product-wall-action relative" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              disabled={!selectableVisibleItems.length}
              onClick={() => setManageMenuOpen((value) => !value)}
              className={`${actionButtonBase} border font-medium ${
                selectionMode
                  ? "border-red-500/25 bg-red-500/8 text-red-600 hover:bg-red-500/12"
                  : wallEditMode
                    ? "border-primary-container/35 bg-primary-container/10 text-primary-container"
                  : "border-outline-variant/24 text-on-surface hover:bg-surface-container-high"
              }`}
              aria-label={managementButtonLabel}
              title={managementButtonLabel}
            >
              <Icon name={selectionMode ? "delete" : wallEditMode ? "edit" : "more_horiz"} size={16} />
              <span className="hidden md:inline">{managementButtonLabel}</span>
            </button>
            {manageMenuOpen && (
              <div className="absolute right-0 top-11 z-30 w-44 overflow-hidden rounded-md border border-outline-variant/18 bg-surface shadow-[0_16px_46px_rgba(0,0,0,0.16)]">
                <button
                  type="button"
                  disabled={!selectableVisibleItems.length}
                  onClick={() => {
                    setManageMenuOpen(false);
                    setWallEditMode((value) => !value);
                    setSelectionMode(false);
                    setSelectedIds(new Set());
                  }}
                  className="flex h-10 w-full items-center gap-2 px-3 text-left text-sm text-on-surface transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Icon name={wallEditMode ? "close" : "edit"} size={16} />
                  {wallEditMode ? "退出编辑" : "编辑图片"}
                </button>
                <button
                  type="button"
                  disabled={!selectableVisibleItems.length}
                  onClick={() => {
                    setManageMenuOpen(false);
                    setSelectionMode((value) => !value);
                    setWallEditMode(false);
                    if (selectionMode) setSelectedIds(new Set());
                  }}
                  className="flex h-10 w-full items-center gap-2 px-3 text-left text-sm text-on-surface transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Icon name={selectionMode ? "close" : "delete"} size={16} />
                  {selectionMode ? "退出批量" : "批量删除"}
                </button>
                {selectionMode && (
                  <>
                    <div className="h-px bg-outline-variant/12" />
                    <button
                      type="button"
                      onClick={() => {
                        setManageMenuOpen(false);
                        selectCurrentVisibleItems();
                      }}
                      disabled={!selectableVisibleItems.length}
                      className="flex h-10 w-full items-center gap-2 px-3 text-left text-sm text-on-surface transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <Icon name="check" size={16} />
                      全选当前
                    </button>
                    <button
                      type="button"
                      disabled={!selectedCount}
                      onClick={() => {
                        setManageMenuOpen(false);
                        void removeSelectedItems();
                      }}
                      className="flex h-10 w-full items-center gap-2 px-3 text-left text-sm text-red-600 transition-colors hover:bg-red-500/8 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <Icon name="delete" size={16} />
                      删除已选{selectedCount ? ` (${selectedCount})` : ""}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setManageMenuOpen(false);
                        clearSelection();
                      }}
                      className="flex h-10 w-full items-center gap-2 px-3 text-left text-sm text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
                    >
                      <Icon name="close" size={16} />
                      取消选择
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
          {selectionMode && (
            <span className="hidden h-9 items-center whitespace-nowrap text-xs text-on-surface-variant lg:inline-flex">
              已选 {selectedCount} 张
            </span>
          )}
          <button
            type="button"
            onClick={openManagementPanel}
            className={secondaryActionButton}
            aria-label="图片管理"
            title="图片管理"
          >
            <Icon name="image" size={16} />
            <span className="hidden md:inline">图片管理</span>
          </button>
          </>
        )}
      </div>
    </div>
  ) : null;

  return (
    <AdminPageShell desktopContentClassName="p-8" mobileContentClassName="px-4 py-4 pb-20">
      <div
        className="relative"
        onPaste={handlePaste}
      >
      <AdminManagementPage
        title="产品影像"
        meta={initialLoading ? "加载中" : undefined}
        description="公司产品、使用现场和客户案例实拍图统一归档，按图库方式浏览。"
        actions={headerActions}
        toolbar={(
          <div className="product-wall-toolbar grid min-h-11 items-center gap-3 md:grid-cols-[minmax(0,1fr)_18rem]">
            <ResponsiveSectionTabs
              tabs={filters.map((item) => ({
                value: item,
                label: item,
                count: filterCounts[item] || 0,
                icon: item === "全部" ? "grid_view" : item === PRODUCT_WALL_FAVORITES_FILTER ? "favorite" : "image",
              }))}
              value={filter}
              onChange={setFilter}
              mobileTitle="当前分类"
              countUnit="张"
            />
            <label className="product-wall-search flex h-9 w-full min-w-0 items-center rounded-sm border border-outline-variant/30 bg-surface-container-lowest px-3 md:ml-auto md:w-72">
              <Icon name="search" size={15} className="mr-2 shrink-0 text-on-surface-variant" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索标题或标签..."
                className="min-w-0 flex-1 border-none bg-transparent text-sm text-on-surface outline-none placeholder:text-on-surface-variant/50"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="p-0.5 text-on-surface-variant hover:text-on-surface"
                  aria-label="清空搜索"
                >
                  <Icon name="close" size={14} />
                </button>
              )}
            </label>
          </div>
        )}
        contentClassName="overflow-visible"
      >
        {dragActive && (
          <div className="mb-4 flex h-10 items-center justify-center border-y border-primary-container/35 bg-primary-container/6 text-sm font-medium text-primary-container">
            松开上传
          </div>
        )}

        {initialLoading ? (
          <section className="flex min-h-[360px] items-center justify-center border-y border-outline-variant/18 bg-surface-container-low/25 px-4 py-12 text-center">
            <div className="max-w-sm">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary-container/10 text-primary-container">
                <Icon name="sync" size={22} className="animate-spin" />
              </div>
              <h2 className="mt-4 text-base font-semibold text-on-surface">正在加载产品影像</h2>
              <p className="mt-2 text-sm leading-6 text-on-surface-variant">正在读取分类和图片数据，请稍候。</p>
            </div>
          </section>
        ) : visibleItems.length ? (
        <>
        <section className="product-wall-masonry w-full">
          {masonryColumns.map((column, columnIndex) => (
            <div key={columnIndex} className="product-wall-masonry-column">
              {column.map((item, index) => {
            const selected = selectedIds.has(item.id);
            const selectable = canManageItem(item);
            return (
            <article
              key={item.id || `${item.title}-${index}`}
              className={`group relative break-inside-avoid overflow-hidden rounded-xl bg-transparent ${
                selected ? "outline outline-2 outline-offset-2 outline-primary-container" : ""
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  if (selectionMode) {
                    if (selectable) toggleSelectedItem(item);
                    return;
                  }
                  setActive(item);
                }}
                className={`block w-full overflow-hidden rounded-xl text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-container/35 ${
                  selectionMode && !selectable ? "cursor-not-allowed opacity-55" : ""
                }`}
              >
                <div className={`product-wall-image-surface product-wall-canvas-${canvasMode} relative overflow-hidden rounded-xl`}>
                  <SafeImage
                    src={item.image}
                    alt={item.title}
                    loading="lazy"
                    className="relative z-10 block h-auto w-full align-middle transition duration-300 group-hover:brightness-[0.96]"
                    fallbackClassName="min-h-40 w-full"
                  />
                  {selectionMode && selectable && (
                    <span className={`absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full border shadow-sm backdrop-blur ${
                      selected
                        ? "border-primary-container bg-primary-container text-on-primary-container"
                        : "border-white/50 bg-black/24 text-white"
                    }`}>
                      <Icon name={selected ? "check" : "add"} size={16} />
                    </span>
                  )}
                </div>
              </button>
              {wallEditMode && selectable && !selectionMode && (
                <div className="absolute right-2 top-2 z-20 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      openEditItem(item);
                    }}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-neutral-800 shadow-sm ring-1 ring-black/5 backdrop-blur transition-colors hover:bg-white"
                    aria-label="编辑图片"
                    title="编辑图片"
                  >
                    <Icon name="edit" size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void removeItem(item);
                    }}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-red-600 shadow-sm ring-1 ring-black/5 backdrop-blur transition-colors hover:bg-white"
                    aria-label="删除图片"
                    title="删除图片"
                  >
                    <Icon name="delete" size={14} />
                  </button>
                </div>
              )}
            </article>
            );
              })}
            </div>
          ))}
        </section>
        <div ref={loadMoreRef} className="flex h-16 w-full items-center justify-center text-xs text-on-surface-variant">
          {hasMoreVisibleItems ? "继续下拉加载更多" : "已经到底了"}
        </div>
        </>
        ) : (
          <section className="flex min-h-[360px] items-center justify-center border-y border-dashed border-outline-variant/28 bg-surface-container-low/35 px-4 py-12 text-center">
            <div className="max-w-sm">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary-container/10 text-primary-container">
                <Icon name="cloud_upload" size={22} />
              </div>
              <h2 className="mt-4 text-base font-semibold text-on-surface">
                {apiError ? "产品影像数据加载失败" : isFavoritesFilter ? "还没有收藏图片" : canUpload ? "这里还没有图片" : "暂无产品影像"}
              </h2>
              <p className="mt-2 text-sm leading-6 text-on-surface-variant">
                {apiError
                  ? errorMessage(apiError, "请检查后端接口和数据库连接，页面不会再用演示图片替代真实数据。")
                  : isFavoritesFilter
                    ? (isLoggedIn ? "打开图片详情后点击收藏，喜欢的产品影像会集中显示在这里。" : "请先登录，登录后才能收藏和查看已收藏的产品影像。")
                    : canUpload
                      ? uploadKind
                        ? `可上传图片、文件夹、zip 或 rar，系统会自动识别图片并保存到「${uploadKind}」。`
                        : "请先在图片管理里创建分类，然后再上传图片。"
                      : "当前分类还没有图片，登录后可以上传产品、案例或海报图片。"}
              </p>
              {canUpload && !isFavoritesFilter && (
                <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                  <div className="relative" onClick={(event) => event.stopPropagation()}>
                    <button
                      type="button"
                      disabled={uploadDisabled}
                      onClick={() => setUploadMenuOpen((value) => !value)}
                      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-sm bg-primary-container px-3 text-sm font-semibold text-on-primary-container transition-colors hover:bg-primary-container/90 disabled:cursor-not-allowed disabled:opacity-55"
                    >
                      <Icon name={uploading ? "sync" : "cloud_upload"} size={16} />
                      上传图片
                    </button>
                    {uploadMenuOpen && (
                      <div className="absolute left-1/2 top-11 z-30 w-44 -translate-x-1/2 overflow-hidden rounded-md border border-outline-variant/18 bg-surface text-left shadow-[0_16px_46px_rgba(0,0,0,0.16)]">
                        <button
                          type="button"
                          onClick={() => {
                            setUploadMenuOpen(false);
                            fileInputRef.current?.click();
                          }}
                          className="flex h-10 w-full items-center gap-2 px-3 text-left text-sm text-on-surface transition-colors hover:bg-surface-container-high"
                        >
                          <Icon name="cloud_upload" size={16} />
                          本地图片 / 压缩包
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setUploadMenuOpen(false);
                            folderInputRef.current?.click();
                          }}
                          className="flex h-10 w-full items-center gap-2 px-3 text-left text-sm text-on-surface transition-colors hover:bg-surface-container-high"
                        >
                          <Icon name="folder" size={16} />
                          选择文件夹
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
              </div>
          </section>
        )}
      </AdminManagementPage>
      </div>

      {managementOpen && isAdmin && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/35 px-3 py-4 backdrop-blur-sm md:px-6 md:py-8" onClick={closeManagement}>
          <section
            className="flex h-[92dvh] w-full max-w-7xl flex-col overflow-hidden rounded-lg border border-outline-variant/16 bg-surface shadow-[0_28px_100px_rgba(0,0,0,0.28)]"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="border-b border-outline-variant/14 px-4 py-4 md:px-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold tracking-[0.18em] text-primary-container">IMAGE LIBRARY</p>
                  <h2 className="mt-1 text-xl font-bold tracking-[-0.03em] text-on-surface">图片管理</h2>
                  <p className="mt-1 text-sm text-on-surface-variant">审核投稿、编辑资料、批量选择和删除图库图片。</p>
                </div>
                <button
                  type="button"
                  onClick={closeManagement}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
                  aria-label="关闭图片管理"
                >
                  <Icon name="close" size={17} />
                </button>
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_190px_300px]">
                <div className="flex h-10 min-w-0 items-center gap-1 overflow-x-auto border-b border-outline-variant/14 scrollbar-none">
                  {REVIEW_FILTERS.map((item) => {
                    const activeReview = item.key === reviewFilter;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        aria-pressed={activeReview}
                        onClick={() => {
                          setReviewFilter(item.key);
                          setSelectedIds(new Set());
                        }}
                        className={`relative inline-flex h-10 shrink-0 items-center justify-center gap-1.5 px-4 text-sm font-medium leading-none transition-colors ${
                          activeReview
                            ? "text-primary-container after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary-container"
                            : "text-on-surface-variant hover:text-on-surface"
                        }`}
                      >
                        <span className="whitespace-nowrap tabular-nums">{item.label} ({reviewCounts[item.key]})</span>
                      </button>
                    );
                  })}
                </div>
                <label className="flex h-10 w-full min-w-0 items-center border-b border-outline-variant/28 bg-transparent px-1">
                  <Icon name="filter_list" size={15} className="mr-2 shrink-0 text-on-surface-variant" />
                  <select
                    value={managementKindFilter}
                    onChange={(event) => setManagementKindFilter(event.target.value as ManagementKindFilter)}
                    className="min-w-0 flex-1 border-none bg-transparent text-sm text-on-surface outline-none"
                    aria-label="按分类筛选图片"
                  >
                    <option value="全部">全部分类</option>
                    {categoryNames.map((kind) => (
                      <option key={kind} value={kind}>{kind}</option>
                    ))}
                  </select>
                </label>
                <label className="flex h-10 w-full min-w-0 items-center border-b border-outline-variant/28 bg-transparent px-1">
                  <Icon name="search" size={15} className="mr-2 shrink-0 text-on-surface-variant" />
                  <input
                    value={managementQuery}
                    onChange={(event) => setManagementQuery(event.target.value)}
                    placeholder="搜索标题、标签、上传者..."
                    className="min-w-0 flex-1 border-none bg-transparent text-sm text-on-surface outline-none placeholder:text-on-surface-variant/50"
                  />
                  {managementQuery && (
                    <button
                      type="button"
                      onClick={() => setManagementQuery("")}
                      className="p-0.5 text-on-surface-variant hover:text-on-surface"
                      aria-label="清空管理搜索"
                    >
                      <Icon name="close" size={14} />
                    </button>
                  )}
                </label>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-on-surface-variant">
                  当前显示 <span className="font-semibold text-on-surface">{managementItems.length}</span> 张
                  {selectionMode && <span> · 已选 <span className="font-semibold text-primary-container">{selectedCount}</span> 张</span>}
                </p>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectionMode((value) => !value);
                      setSelectedIds(new Set());
                    }}
                    className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-sm px-3 text-sm font-medium transition-colors ${
                      selectionMode
                        ? "bg-surface-container-high text-on-surface"
                        : "border border-red-500/25 text-red-600 hover:bg-red-500/8"
                    }`}
                  >
                    <Icon name={selectionMode ? "close" : "delete"} size={16} />
                    {selectionMode ? "退出多选" : "批量删除"}
                  </button>
                  {selectionMode && (
                    <>
                      <button
                        type="button"
                        onClick={selectCurrentManagementItems}
                        disabled={!managementItems.length}
                        className="inline-flex h-9 items-center justify-center gap-1.5 rounded-sm border border-outline-variant/24 px-3 text-sm font-medium text-on-surface transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        全选当前
                      </button>
                      <button
                        type="button"
                        disabled={!selectedCount}
                        onClick={() => void removeSelectedItems()}
                        className="inline-flex h-9 items-center justify-center gap-1.5 rounded-sm bg-red-600 px-3 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <Icon name="delete" size={16} />
                        删除已选{selectedCount ? ` (${selectedCount})` : ""}
                      </button>
                      <button
                        type="button"
                        onClick={clearSelection}
                        className="inline-flex h-9 items-center justify-center gap-1.5 rounded-sm px-3 text-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
                      >
                        取消选择
                      </button>
                    </>
                  )}
                </div>
              </div>
            </header>
            <div className="min-h-0 flex-1 overflow-hidden md:grid md:grid-cols-[320px_minmax(0,1fr)]">
              <aside className="max-h-[42dvh] overflow-y-auto border-b border-outline-variant/12 px-4 py-4 md:max-h-none md:border-b-0 md:border-r md:px-5">
                <div className="space-y-5">
                  <section>
                    <div className="mb-3 flex items-center gap-2">
                      <Icon name="tune" size={16} className="text-primary-container" />
                      <h3 className="text-sm font-semibold text-on-surface">管理设置</h3>
                    </div>
                    <div className="space-y-4">
                      <div>
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <p className="text-xs font-medium text-on-surface-variant">透明图片背景</p>
                        </div>
                        <div className="grid grid-cols-2 overflow-hidden rounded-sm border border-outline-variant/18 bg-surface-container-lowest">
                          <button
                            type="button"
                            onClick={() => changeCanvasMode("white")}
                            className={`inline-flex h-9 items-center justify-center text-sm font-medium transition-colors ${
                              canvasMode === "white"
                                ? "bg-primary-container text-on-primary-container"
                                : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                            }`}
                          >
                            白色底
                          </button>
                          <button
                            type="button"
                            onClick={() => changeCanvasMode("checker")}
                            className={`inline-flex h-9 items-center justify-center border-l border-outline-variant/14 text-sm font-medium transition-colors ${
                              canvasMode === "checker"
                                ? "bg-primary-container text-on-primary-container"
                                : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                            }`}
                          >
                            棋盘底
                          </button>
                        </div>
                      </div>
                      <label className="block">
                        <span className="text-xs font-medium text-on-surface-variant">全部视图默认上传到</span>
                        <span className="mt-1 flex h-10 items-center border-b border-outline-variant/30">
                          <Icon name="filter_list" size={15} className="mr-2 shrink-0 text-on-surface-variant" />
                          <select
                            value={resolvedDefaultUploadKind}
                            onChange={(event) => changeDefaultUploadKind(event.target.value as ProductWallKind)}
                            className="min-w-0 flex-1 border-none bg-transparent text-sm text-on-surface outline-none"
                            aria-label="默认上传分类"
                          >
                            {categoryNames.map((kind) => (
                              <option key={kind} value={kind}>{kind}</option>
                            ))}
                          </select>
                        </span>
                      </label>
                    </div>
                  </section>

                  <section className="border-t border-outline-variant/10 pt-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Icon name="folder" size={16} className="text-primary-container" />
                          <h3 className="text-sm font-semibold text-on-surface">分类管理</h3>
                        </div>
                        <p className="mt-1 text-xs text-on-surface-variant">选择分类即可管理对应图片。</p>
                      </div>
                    </div>
                    <div className="mb-3 flex items-center gap-2">
                      <input
                        value={categoryDraft}
                        onChange={(event) => setCategoryDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void addCategory();
                        }}
                        placeholder="新分类名称"
                        className="h-9 min-w-0 flex-1 border-b border-outline-variant/35 bg-transparent px-1 text-sm text-on-surface outline-none transition-colors placeholder:text-on-surface-variant/50 focus:border-primary-container"
                      />
                      <button
                        type="button"
                        onClick={() => void addCategory()}
                        className="inline-flex h-9 shrink-0 items-center justify-center gap-1 rounded-sm border border-outline-variant/20 px-2.5 text-sm font-medium text-on-surface transition-colors hover:bg-surface-container-high"
                      >
                        <Icon name="add" size={16} />
                        新建
                      </button>
                    </div>
                    <div className="space-y-1">
                      <div className={`flex min-w-0 items-center justify-between gap-2 rounded-sm px-2 py-2 ${
                        managementKindFilter === "全部" ? "bg-primary-container/8" : "hover:bg-surface-container-high"
                      }`}>
                        <button
                          type="button"
                          onClick={() => setManagementKindFilter("全部")}
                          className={`flex min-w-0 flex-1 items-baseline gap-1 text-left text-sm font-medium transition-colors ${
                            managementKindFilter === "全部" ? "text-primary-container" : "text-on-surface"
                          }`}
                        >
                          <span className="truncate">全部分类</span>
                          <span className="shrink-0 text-xs font-normal text-on-surface-variant">{items.length}</span>
                        </button>
                        {managementKindFilter === "全部" && (
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary-container" />
                        )}
                      </div>
                      {(categories || []).map((category) => {
                        const editing = editingCategoryId === category.id;
                        const activeCategory = managementKindFilter === category.name;
                        return (
                          <div
                            key={category.id}
                            className={`flex min-w-0 items-center justify-between gap-2 rounded-sm px-2 py-2 transition-colors ${
                              activeCategory ? "bg-primary-container/8" : "hover:bg-surface-container-high"
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              {editing ? (
                                <input
                                  value={editingCategoryName}
                                  onChange={(event) => setEditingCategoryName(event.target.value)}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") void saveCategory(category.id);
                                    if (event.key === "Escape") setEditingCategoryId(null);
                                  }}
                                  className="h-8 w-full border-b border-primary-container bg-transparent text-sm text-on-surface outline-none"
                                />
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setManagementKindFilter(category.name as ProductWallKind)}
                                  className={`flex max-w-full items-baseline gap-1 text-left text-sm font-medium transition-colors ${
                                    activeCategory ? "text-primary-container" : "text-on-surface"
                                  }`}
                                >
                                  <span className="truncate">{category.name}</span>
                                  <span className="shrink-0 text-xs font-normal text-on-surface-variant">{categoryImageCounts[category.name] || 0}</span>
                                </button>
                              )}
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              {activeCategory && (
                                <span className="mr-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary-container" />
                              )}
                              {editing ? (
                                <button
                                  type="button"
                                  onClick={() => void saveCategory(category.id)}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-primary-container hover:bg-primary-container/10"
                                  aria-label="保存分类"
                                >
                                  <Icon name="check" size={15} />
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => startEditCategory(category.id, category.name)}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface"
                                  aria-label="编辑分类"
                                >
                                  <Icon name="edit" size={14} />
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => void removeCategory(category.id, category.name)}
                                disabled={(categoryImageCounts[category.name] || 0) > 0 || (categories?.length || 0) <= 1}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-red-500/8 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-35"
                                aria-label="删除分类"
                                title={(categoryImageCounts[category.name] || 0) > 0 ? "分类下有图片，不能删除" : "删除分类"}
                              >
                                <Icon name="delete" size={14} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                </div>
              </aside>

              <div className="min-h-0 overflow-y-auto px-4 py-4 md:px-6">
              {managementItems.length ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {managementItems.map((item) => {
                    const selected = selectedIds.has(item.id);
                    const showReviewActions = item.status === "pending";
                    const showRestoreAction = item.status === "rejected";
                    return (
                      <article
                        key={item.id}
                        className={`group relative overflow-hidden rounded-xl bg-surface shadow-sm ring-1 transition ${
                          selected ? "ring-2 ring-primary-container" : "ring-outline-variant/12 hover:-translate-y-0.5 hover:ring-outline-variant/24 hover:shadow-md"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            if (selectionMode) {
                              toggleSelectedItem(item);
                              return;
                            }
                            setActive(item);
                          }}
                          className="block w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-container/35"
                        >
                          <div className={`product-wall-canvas-${canvasMode} relative flex h-48 items-center justify-center overflow-hidden bg-surface-container-lowest p-3 sm:h-52`}>
                            <SafeImage
                              src={item.image}
                              alt={item.title}
                              loading="lazy"
                              className="max-h-full max-w-full object-contain drop-shadow-[0_10px_24px_rgba(15,23,42,0.10)]"
                              fallbackClassName="h-full w-full"
                            />
                            {reviewFilter === "all" && item.status !== "approved" && (
                              <span className={`absolute left-2 top-2 rounded-full px-2 py-1 text-[11px] font-semibold shadow-sm backdrop-blur ${
                                item.status === "pending" ? "bg-amber-400/90 text-neutral-950" : "bg-red-500/88 text-white"
                              }`}>
                                {STATUS_LABELS[item.status]}
                              </span>
                            )}
                            {selectionMode && (
                              <span className={`absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full border shadow-sm backdrop-blur ${
                                selected
                                  ? "border-primary-container bg-primary-container text-on-primary-container"
                                  : "border-white/50 bg-black/24 text-white"
                              }`}>
                                <Icon name={selected ? "check" : "add"} size={16} />
                              </span>
                            )}
                          </div>
                        </button>
                        <div className="border-t border-outline-variant/10 px-3 py-3">
                          <div className="flex min-w-0 items-start justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => setActive(item)}
                              className="min-w-0 flex-1 text-left"
                            >
                              <h3 className="line-clamp-2 min-h-10 text-sm font-semibold leading-5 text-on-surface">{item.title}</h3>
                            </button>
                            {!selectionMode && (
                              <div className="flex shrink-0 items-center justify-end gap-1 pt-0.5">
                                {showReviewActions && (
                                  <button
                                    type="button"
                                    onClick={() => void reviewItem(item, "approved")}
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-full text-emerald-700 transition-colors hover:bg-emerald-500/12"
                                    aria-label="通过审核"
                                    title="通过"
                                  >
                                    <Icon name="check" size={14} />
                                  </button>
                                )}
                                {showReviewActions && (
                                  <button
                                    type="button"
                                    onClick={() => void reviewItem(item, "rejected")}
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-full text-red-600 transition-colors hover:bg-red-500/10"
                                    aria-label="不通过审核"
                                    title="不通过"
                                  >
                                    <Icon name="close" size={14} />
                                  </button>
                                )}
                                {showRestoreAction && (
                                  <button
                                    type="button"
                                    onClick={() => void reviewItem(item, "approved")}
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-full text-emerald-700 transition-colors hover:bg-emerald-500/12"
                                    aria-label="重新通过审核"
                                    title="重新通过"
                                  >
                                    <Icon name="check" size={14} />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => openEditItem(item)}
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface"
                                  aria-label="编辑图片"
                                  title="编辑"
                                >
                                  <Icon name="edit" size={14} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void removeItem(item)}
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-red-500/8 hover:text-red-600"
                                  aria-label="删除图片"
                                  title="删除"
                                >
                                  <Icon name="delete" size={14} />
                                </button>
                              </div>
                            )}
                          </div>
                          <p className="mt-1 truncate text-xs text-on-surface-variant">
                            {item.kind}{item.uploaderName ? ` · ${item.uploaderName}` : ""}
                          </p>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="flex h-full min-h-[280px] flex-col items-center justify-center text-center text-on-surface-variant">
                  <Icon name="image" size={36} className="mb-3 opacity-45" />
                  <p className="text-sm font-medium">暂无匹配图片</p>
                  <p className="mt-1 text-xs">可以切换审核状态或清空搜索条件。</p>
                </div>
              )}
            </div>
            </div>
          </section>
        </div>
      )}

      {deleteDialog && (
        <div
          className="fixed inset-0 z-[10002] flex items-center justify-center bg-black/42 px-4 py-6 backdrop-blur-md"
          onClick={() => {
            if (!deleting) setDeleteDialog(null);
          }}
        >
          <section
            className="w-full max-w-md overflow-hidden rounded-xl border border-outline-variant/16 bg-surface shadow-[0_28px_100px_rgba(0,0,0,0.32)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="p-5">
              <div className="flex items-start gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-600">
                  <Icon name="delete" size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold tracking-[0.18em] text-red-600">DELETE IMAGE</p>
                  <h2 className="mt-1 text-lg font-bold tracking-[-0.03em] text-on-surface">确认删除图片？</h2>
                  <p className="mt-2 text-sm leading-6 text-on-surface-variant">
                    {deleteDialog.type === "single"
                      ? "删除后图片会从产品影像和图片管理中移除，已上传到本地的图片文件也会一并清理。"
                      : `将删除已选的 ${deleteDialog.ids.length} 张图片，删除后无法恢复。`}
                  </p>
                </div>
              </div>

              {deleteDialog.type === "single" ? (
                <div className="mt-5 flex items-center gap-3 border-y border-outline-variant/12 py-3">
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-surface-container">
                    <SafeImage
                      src={deleteDialog.item.image}
                      alt={deleteDialog.item.title}
                      className="h-full w-full object-cover"
                      fallbackClassName="h-full w-full"
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-on-surface">{deleteDialog.item.title}</p>
                    <p className="mt-1 text-xs text-on-surface-variant">{deleteDialog.item.kind}</p>
                  </div>
                </div>
              ) : (
                <div className="mt-5 rounded-lg border border-red-500/16 bg-red-500/6 px-4 py-3 text-sm text-red-700">
                  已选择 <span className="font-semibold">{deleteDialog.ids.length}</span> 张图片，请确认是否批量删除。
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-outline-variant/12 bg-surface-container-low/60 px-5 py-4">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setDeleteDialog(null)}
                className="inline-flex h-9 items-center justify-center rounded-sm px-4 text-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void confirmDelete()}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-sm bg-red-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Icon name={deleting ? "sync" : "delete"} size={16} className={deleting ? "animate-spin" : ""} />
                {deleting ? "删除中" : "确认删除"}
              </button>
            </div>
          </section>
        </div>
      )}

      {editingItem && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/35 px-4 py-6 backdrop-blur-sm" onClick={() => setEditingItem(null)}>
          <form
            className="w-full max-w-lg rounded-sm border border-outline-variant/18 bg-surface p-5 shadow-[0_24px_80px_rgba(0,0,0,0.22)]"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              void saveEditingItem();
            }}
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold tracking-[0.18em] text-primary-container">IMAGE SETTINGS</p>
                <h2 className="mt-1 text-lg font-bold text-on-surface">编辑图片信息</h2>
              </div>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
                aria-label="关闭"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <div className="space-y-4">
              <label className="block">
                <span className="text-xs font-medium text-on-surface-variant">标题</span>
                <input
                  value={editTitle}
                  onChange={(event) => setEditTitle(event.target.value)}
                  className="mt-1 h-10 w-full border-b border-outline-variant/35 bg-transparent text-sm text-on-surface outline-none transition-colors focus:border-primary-container"
                  placeholder="例如：不锈钢快插接头"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-on-surface-variant">分类</span>
                <select
                  value={editKind}
                  onChange={(event) => setEditKind(event.target.value as ProductWallKind)}
                  className="mt-1 h-10 w-full border-b border-outline-variant/35 bg-transparent text-sm text-on-surface outline-none transition-colors focus:border-primary-container"
                >
                  {categoryNames.map((kind) => (
                    <option key={kind} value={kind}>{kind}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-on-surface-variant">标签</span>
                <input
                  value={editTags}
                  onChange={(event) => setEditTags(event.target.value)}
                  className="mt-1 h-10 w-full border-b border-outline-variant/35 bg-transparent text-sm text-on-surface outline-none transition-colors focus:border-primary-container"
                  placeholder="多个标签用逗号隔开"
                />
              </label>
            </div>
            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="inline-flex h-9 items-center justify-center rounded-sm px-3 text-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
              >
                取消
              </button>
              <button
                type="submit"
                className="inline-flex h-9 items-center justify-center rounded-sm bg-primary-container px-4 text-sm font-semibold text-on-primary-container transition-colors hover:bg-primary-container/90"
              >
                保存
              </button>
            </div>
          </form>
        </div>
      )}

      {active && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/68 p-0 backdrop-blur-xl md:p-6"
          onClick={() => setActive(null)}
        >
          <div
            className="product-wall-preview-panel relative flex h-dvh w-full flex-col overflow-hidden bg-surface shadow-none md:h-[94dvh] md:max-w-[1500px] md:rounded-xl md:border md:border-outline-variant/18 md:shadow-[0_34px_120px_rgba(0,0,0,0.34)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div
              className={`product-wall-preview-canvas product-wall-canvas-${canvasMode} relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-0 ${previewZoomed ? "select-none" : ""}`}
              onWheel={handlePreviewWheel}
            >
              <div
                className="pointer-events-none absolute inset-0 scale-125 bg-cover bg-center opacity-10 blur-3xl"
                style={{ backgroundImage: `url(${productWallPreviewImage(active)})` }}
              />
              <button
                type="button"
                onClick={handlePreviewImageClick}
                onPointerDown={handlePreviewPointerDown}
                onPointerMove={handlePreviewPointerMove}
                onPointerUp={handlePreviewPointerUp}
                onPointerCancel={handlePreviewPointerUp}
                className={`product-wall-preview-zoom-target relative z-10 flex h-full w-full shrink-0 touch-none items-center justify-center border-none bg-transparent p-0 focus:outline-none ${
                  previewZoomed ? (previewDragging ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in"
                }`}
                aria-label={previewZoomed ? "还原图片" : "放大图片"}
                title={previewZoomed ? "拖动查看，点击还原" : "点击放大"}
              >
                <SafeImage
                  src={productWallPreviewImage(active)}
                  alt={active.title}
                  loading="eager"
                  className={`product-wall-preview-image h-full w-full object-contain drop-shadow-[0_16px_42px_rgba(0,0,0,0.18)] ${previewDragging ? "" : "transition-transform duration-300 ease-out"}`}
                  fallbackClassName="h-full w-full"
                  style={{ transform: `translate3d(${previewPan.x}px, ${previewPan.y}px, 0) scale(${previewZoom})` }}
                />
              </button>
              <button
                type="button"
                onClick={() => {
                  setPreviewZoomLevel(1);
                  setActive(null);
                }}
                className="product-wall-preview-close absolute right-4 top-4 z-20 inline-flex h-9 w-9 items-center justify-center rounded-full border border-black/8 bg-white/78 text-neutral-800 shadow-[0_8px_24px_rgba(0,0,0,0.14)] backdrop-blur-md transition-colors hover:bg-white"
                aria-label="关闭"
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="product-wall-preview-info z-20 flex shrink-0 items-center justify-between gap-3 border-t border-outline-variant/12 bg-surface px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 text-on-surface md:px-5 md:py-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold tracking-[0.18em] text-primary-container">{active.kind}</p>
                <h2 className="mt-1 truncate text-base font-bold md:text-lg">{active.title}</h2>
              </div>
              <div className="product-wall-preview-actions flex shrink-0 items-center gap-1.5">
                <PreviewActionButton
                  icon={previewZoomed ? "zoom_out" : "zoom_in"}
                  label={previewZoomed ? "还原" : "放大"}
                  active={previewZoomed}
                  onClick={togglePreviewZoom}
                />
                <PreviewActionButton
                  icon={activeFavorited ? "favorite" : "star"}
                  label={activeFavorited ? "取消收藏" : "收藏"}
                  active={activeFavorited}
                  onClick={toggleFavorite}
                />
                <PreviewActionButton
                  icon={shareState === "copied" ? "check" : "share"}
                  label={shareState === "copied" ? "已复制" : "分享"}
                  active={shareState === "copied"}
                  onClick={shareActiveImage}
                />
                <a
                  href={active.image}
                  download={productWallDownloadName(active)}
                  className="product-wall-preview-action inline-flex h-9 w-9 items-center justify-center rounded-full border border-outline-variant/16 bg-transparent text-on-surface-variant transition-colors hover:border-outline-variant/28 hover:bg-surface-container-high hover:text-on-surface"
                  title="下载"
                  aria-label="下载"
                >
                  <Icon name="download" size={16} />
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
      <style>{`
        .product-wall-image-surface,
        .product-wall-preview-canvas,
        .product-wall-mode-swatch {
          background-color: #ffffff;
        }
        .product-wall-canvas-checker,
        .product-wall-mode-swatch {
          background-color: #f6f3ed;
          background-image:
            linear-gradient(45deg, rgba(25, 23, 20, 0.045) 25%, transparent 25%),
            linear-gradient(-45deg, rgba(25, 23, 20, 0.045) 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, rgba(25, 23, 20, 0.045) 75%),
            linear-gradient(-45deg, transparent 75%, rgba(25, 23, 20, 0.045) 75%);
          background-position: 0 0, 0 6px, 6px -6px, -6px 0;
          background-size: 12px 12px;
        }
        .product-wall-canvas-white {
          background-color: #ffffff;
          background-image: none;
        }
        .product-wall-image-surface::after {
          position: absolute;
          inset: 0;
          z-index: 11;
          pointer-events: none;
          content: "";
          box-shadow: inset 0 0 0 1px rgba(30, 27, 23, 0.08);
        }
        @media (max-width: 767px) {
          .product-wall-toolbar {
            display: grid;
            grid-template-columns: minmax(0, 1fr);
            gap: 10px;
          }
          .product-wall-toolbar .product-wall-search,
          .product-wall-toolbar .product-wall-filter-row {
            width: 100%;
          }
          .product-wall-toolbar .product-wall-search {
            order: 1;
          }
          .product-wall-toolbar .product-wall-filter-row {
            order: 2;
            min-width: 0;
          }
          .product-wall-action-row {
            display: flex;
            min-width: 0;
            max-width: 100%;
            gap: 6px;
          }
          .product-wall-action-row .product-wall-action,
          .product-wall-action-row > button {
            flex: 0 0 auto;
            min-width: 0;
          }
          .product-wall-action > button,
          .product-wall-action-row > button {
            min-width: 0;
            justify-content: center;
          }
        }
        .product-wall-masonry {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
          align-items: start;
        }
        .product-wall-masonry-column {
          display: flex;
          min-width: 0;
          flex-direction: column;
          gap: 12px;
        }
        @media (min-width: 640px) {
          .product-wall-masonry {
            gap: 16px;
          }
          .product-wall-masonry-column {
            gap: 16px;
          }
        }
        @media (min-width: 860px) {
          .product-wall-masonry {
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 20px;
          }
          .product-wall-masonry-column {
            gap: 20px;
          }
        }
        @media (min-width: 1280px) {
          .product-wall-masonry {
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 24px;
          }
          .product-wall-masonry-column {
            gap: 24px;
          }
        }
        @media (min-width: 1680px) {
          .product-wall-masonry {
            grid-template-columns: repeat(5, minmax(0, 1fr));
          }
        }
        @keyframes productWallPreviewIn {
          0% {
            opacity: 0;
            transform: translateY(18px) scale(0.92);
            filter: blur(8px);
          }
          62% {
            opacity: 1;
            transform: translateY(0) scale(1.012);
            filter: blur(0);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: blur(0);
          }
        }
        .product-wall-preview-panel {
          animation: productWallPreviewIn 320ms cubic-bezier(0.2, 0.9, 0.18, 1) both;
          transform-origin: center center;
        }
        @media (max-width: 767px) {
          .product-wall-preview-panel {
            background: #f8f6f2;
          }
          .product-wall-preview-canvas {
            flex: 1 1 auto;
            min-height: 0;
            padding: max(0.75rem, env(safe-area-inset-top)) 0.75rem 0.75rem;
          }
          .product-wall-preview-image {
            max-height: 100%;
            object-fit: contain;
          }
          .product-wall-preview-close {
            top: max(0.75rem, env(safe-area-inset-top));
            right: 0.75rem;
          }
          .product-wall-preview-info {
            display: grid;
            grid-template-columns: minmax(0, 1fr);
            gap: 12px;
            box-shadow: 0 -14px 36px rgba(15, 23, 42, 0.08);
          }
          .product-wall-preview-actions {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            width: 100%;
            gap: 8px;
          }
          .product-wall-preview-action {
            width: 100%;
            border-radius: 10px;
            background: var(--color-surface-container-low);
          }
        }
      `}</style>
    </AdminPageShell>
  );
}
