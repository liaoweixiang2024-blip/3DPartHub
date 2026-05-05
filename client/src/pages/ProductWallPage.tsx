import {
  useCallback,
  useEffect,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type PointerEvent,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import '../styles/product-wall.css';
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
  listProductWallFavorites,
  addProductWallFavorite,
  removeProductWallFavorite,
  type ProductWallItem,
  type ProductWallKind,
  type ProductWallStatus,
} from '../api/productWall';
import ProductWallActionMenu from '../components/product-wall/ActionMenu';
import ProductWallManagementPanel from '../components/product-wall/ManagementPanel';
import { AdminManagementPage } from '../components/shared/AdminManagementPage';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import Icon from '../components/shared/Icon';
import LoginConfirmDialog from '../components/shared/LoginConfirmDialog';
import { isLoginDialogEnabled } from '../components/shared/ProtectedLink';
import ResponsiveSectionTabs from '../components/shared/ResponsiveSectionTabs';
import SafeImage from '../components/shared/SafeImage';
import { useToast } from '../components/shared/Toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useImeSafeSearchInput } from '../hooks/useImeSafeSearchInput';
import { getBusinessConfig } from '../lib/businessConfig';
import { copyText } from '../lib/clipboard';
import { useAuthStore } from '../stores/useAuthStore';

type WallItem = ProductWallItem;

type WallFilter = string;
type ReviewFilter = 'all' | ProductWallStatus;
type ManagementKindFilter = '全部' | ProductWallKind;
type ProductWallCanvasMode = 'white' | 'checker';
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
const PRODUCT_WALL_SKELETON_COUNT = 15;
const PRODUCT_WALL_CANVAS_MODE_KEY = 'product-wall-canvas-mode';
const PRODUCT_WALL_DEFAULT_KIND_KEY = 'product-wall-default-kind';
const PRODUCT_WALL_FAVORITES_FILTER = '我的收藏';

function isZipFile(file: File) {
  return (
    file.type === 'application/zip' ||
    file.type === 'application/x-zip-compressed' ||
    file.name.toLowerCase().endsWith('.zip')
  );
}

function isRarFile(file: File) {
  return (
    file.type === 'application/vnd.rar' ||
    file.type === 'application/x-rar-compressed' ||
    file.name.toLowerCase().endsWith('.rar')
  );
}

function isImageFile(file: File) {
  return file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(file.name);
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

async function collectFilesFromEntry(entry: WebkitFileSystemEntry, maxDepth = 5): Promise<File[]> {
  if (entry.isFile) return [await readFileEntry(entry as WebkitFileSystemFileEntry)];
  if (!entry.isDirectory || maxDepth <= 0) return [];
  const children = await readDirectoryEntries(entry as WebkitFileSystemDirectoryEntry);
  const nested = await Promise.all(children.map((child) => collectFilesFromEntry(child, maxDepth - 1)));
  return nested.flat();
}

async function collectFilesFromDataTransfer(dataTransfer: DataTransfer) {
  const items = Array.from(dataTransfer.items || []) as DataTransferItemWithEntry[];
  if (!items.length) return Array.from(dataTransfer.files);
  const nested = await Promise.all(
    items.map(async (item) => {
      const entry = item.webkitGetAsEntry?.();
      if (entry) return collectFilesFromEntry(entry);
      const file = item.getAsFile();
      return file ? [file] : [];
    }),
  );
  return nested.flat();
}
function wallImageUrl(item: WallItem) {
  if (typeof window === 'undefined') return item.image;
  return new URL(item.image, window.location.origin).toString();
}

function productWallDownloadName(item: WallItem) {
  const ext = item.image.split('.').pop()?.split('?')[0] || 'webp';
  return `${item.title}.${ext}`;
}

function productWallPreviewImage(item: WallItem) {
  return item.previewImage || item.image;
}

function productWallRatioValue(ratio: string) {
  const [width, height] = ratio.split('/').map((part) => Number(part.trim()));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 4 / 5;
  return width / height;
}

function getProductWallColumnCount() {
  if (typeof window === 'undefined') return 2;
  const width = window.innerWidth;
  if (width >= 1680) return 5;
  if (width >= 1280) return 4;
  if (width >= 860) return 3;
  return 2;
}

function ProductWallSkeletonGrid({ columns }: { columns: number }) {
  const items = Array.from({ length: PRODUCT_WALL_SKELETON_COUNT }, (_, index) => ({
    id: index,
    ratio: index % 5 === 0 ? '3 / 4' : index % 3 === 0 ? '4 / 3' : '4 / 5',
  }));
  const grouped = items.reduce<Array<typeof items>>((acc, item, index) => {
    const columnIndex = index % columns;
    if (!acc[columnIndex]) acc[columnIndex] = [];
    acc[columnIndex].push(item);
    return acc;
  }, []);
  return (
    <section className="product-wall-masonry product-wall-skeleton-grid w-full" aria-hidden="true">
      {grouped.map((column, columnIndex) => (
        <div key={columnIndex} className="product-wall-masonry-column">
          {column.map((item) => (
            <div key={item.id} className="product-wall-skeleton-card rounded-xl" style={{ aspectRatio: item.ratio }} />
          ))}
        </div>
      ))}
    </section>
  );
}

function errorMessage(error: unknown, fallback = '操作失败，请稍后重试') {
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
          ? 'border-primary-container/25 bg-primary-container/10 text-primary-container'
          : 'border-outline-variant/16 bg-transparent text-on-surface-variant hover:border-outline-variant/28 hover:bg-surface-container-high hover:text-on-surface'
      }`}
      aria-label={label}
      data-tooltip-ignore
    >
      <Icon name={icon} size={16} />
    </button>
  );
}

export default function ProductWallPage() {
  useDocumentTitle('产品图库');
  const navigate = useNavigate();
  const location = useLocation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const loadMoreRef = useRef<HTMLButtonElement | null>(null);
  const previewCloseRef = useRef<HTMLButtonElement | null>(null);
  const previewDragRef = useRef({ active: false, moved: false, startX: 0, startY: 0, panX: 0, panY: 0 });
  const { user, isAuthenticated, hasHydrated } = useAuthStore();
  const { toast } = useToast();
  const { uploadPolicy } = getBusinessConfig();
  const productWallMaxImageBytes = Math.max(1, uploadPolicy.productWallImageMaxSizeMb) * 1024 * 1024;
  const isLoggedIn = hasHydrated && isAuthenticated;
  const isAdmin = isLoggedIn && user?.role === 'ADMIN';
  const canUpload = isLoggedIn;
  const {
    data,
    error: itemsError,
    mutate,
    isLoading,
  } = useSWR(
    isAdmin ? 'admin-product-wall-items' : 'product-wall-items',
    isAdmin ? listAdminProductWallItems : listProductWallItems,
  );
  const {
    data: categories,
    error: categoriesError,
    mutate: mutateCategories,
    isLoading: categoriesLoading,
  } = useSWR(
    isAdmin ? 'admin-product-wall-categories' : 'product-wall-categories',
    isAdmin ? listAdminProductWallCategories : listProductWallCategories,
  );
  const [active, setActive] = useState<WallItem | null>(null);
  const [filter, setFilter] = useState<WallFilter>('全部');
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('approved');
  const [managementKindFilter, setManagementKindFilter] = useState<ManagementKindFilter>('全部');
  const {
    value: query,
    draftValue: queryInputValue,
    setValue: setQuery,
    inputProps: queryInputProps,
  } = useImeSafeSearchInput();
  const [managementOpen, setManagementOpen] = useState(false);
  const [managementQuery, setManagementQuery] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingUploadFiles, setPendingUploadFiles] = useState<File[] | null>(null);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadDescription, setUploadDescription] = useState('');
  const [manageMenuOpen, setManageMenuOpen] = useState(false);
  const [canvasMode] = useState<ProductWallCanvasMode>(() => {
    if (typeof window === 'undefined') return 'white';
    const saved = window.localStorage.getItem(PRODUCT_WALL_CANVAS_MODE_KEY);
    return saved === 'checker' ? 'checker' : 'white';
  });
  const [defaultUploadKind] = useState<ProductWallKind>(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(PRODUCT_WALL_DEFAULT_KIND_KEY) || '';
  });
  const [wallEditMode, setWallEditMode] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [renderCount, setRenderCount] = useState(PRODUCT_WALL_RENDER_BATCH_SIZE);
  const [editingItem, setEditingItem] = useState<WallItem | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<
    { type: 'single'; item: WallItem } | { type: 'batch'; ids: string[] } | null
  >(null);
  const [deleting, setDeleting] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editKind, setEditKind] = useState<ProductWallKind>('公司产品');
  const [editTags, setEditTags] = useState('');
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => new Set());
  const [shareState, setShareState] = useState<'idle' | 'copied'>('idle');
  const [previewZoom, setPreviewZoom] = useState(1);
  const [previewPan, setPreviewPan] = useState({ x: 0, y: 0 });
  const [previewDragging, setPreviewDragging] = useState(false);
  const [columnCount, setColumnCount] = useState(getProductWallColumnCount);
  const [wallReady, setWallReady] = useState(false);
  const [managementRenderCount, setManagementRenderCount] = useState(PRODUCT_WALL_RENDER_BATCH_SIZE);
  const apiError = itemsError || categoriesError;
  const initialLoading = (isLoading && !data) || (categoriesLoading && !categories);
  const items = useMemo(() => data ?? [], [data]);
  const categoryList = useMemo(() => categories ?? [], [categories]);
  const databaseCategoryNames = useMemo(() => categoryList.map((item) => item.name).filter(Boolean), [categoryList]);
  const categoryNames = useMemo(() => Array.from(new Set(databaseCategoryNames)), [databaseCategoryNames]);
  const filters = useMemo<WallFilter[]>(
    () => ['全部', PRODUCT_WALL_FAVORITES_FILTER, ...categoryNames],
    [categoryNames],
  );
  const resolvedDefaultUploadKind = categoryNames.includes(defaultUploadKind)
    ? defaultUploadKind
    : categoryNames[0] || '';
  const isUtilityFilter = filter === '全部' || filter === PRODUCT_WALL_FAVORITES_FILTER;
  const isFavoritesFilter = filter === PRODUCT_WALL_FAVORITES_FILTER;
  const uploadKind = isUtilityFilter ? resolvedDefaultUploadKind : filter;
  const uploadDisabled = uploading || !uploadKind;
  const deferredQuery = useDeferredValue(query);
  const deferredManagementQuery = useDeferredValue(managementQuery);
  const normalizedQuery = deferredQuery.trim().toLowerCase();
  const normalizedManagementQuery = deferredManagementQuery.trim().toLowerCase();
  const approvedItems = useMemo(() => items.filter((item) => item.status === 'approved'), [items]);
  const visibleItems = useMemo(() => {
    const base =
      filter === '全部'
        ? approvedItems
        : filter === PRODUCT_WALL_FAVORITES_FILTER
          ? isLoggedIn
            ? approvedItems.filter((item) => favoriteIds.has(item.id))
            : []
          : approvedItems.filter((item) => item.kind === filter);
    if (!normalizedQuery) return base;
    return base.filter((item) =>
      [item.title, item.description || '', item.kind, ...item.tags].some((value) =>
        value.toLowerCase().includes(normalizedQuery),
      ),
    );
  }, [approvedItems, filter, isLoggedIn, favoriteIds, normalizedQuery]);
  const renderedItems = visibleItems.slice(0, renderCount);
  const hasMoreVisibleItems = renderedItems.length < visibleItems.length;
  const masonryColumns = useMemo(() => {
    const columns = Array.from({ length: columnCount }, () => [] as WallItem[]);
    const heights = Array.from({ length: columnCount }, () => 0);
    renderedItems.forEach((item) => {
      let shortestColumnIndex = 0;
      for (let index = 1; index < columns.length; index += 1) {
        if (heights[index] < heights[shortestColumnIndex]) shortestColumnIndex = index;
      }
      columns[shortestColumnIndex].push(item);
      heights[shortestColumnIndex] += 1 / productWallRatioValue(item.ratio);
    });
    return columns;
  }, [renderedItems, columnCount]);
  const managementItems = useMemo(() => {
    const byStatus = reviewFilter === 'all' ? items : items.filter((item) => item.status === reviewFilter);
    const byKind =
      managementKindFilter === '全部' ? byStatus : byStatus.filter((item) => item.kind === managementKindFilter);
    if (!normalizedManagementQuery) return byKind;
    return byKind.filter((item) =>
      [item.title, item.description || '', item.kind, ...item.tags].some((value) =>
        value.toLowerCase().includes(normalizedManagementQuery),
      ),
    );
  }, [items, reviewFilter, managementKindFilter, normalizedManagementQuery]);
  const filterCounts = useMemo(
    () =>
      filters.reduce<Record<string, number>>((acc, item) => {
        acc[item] =
          item === '全部'
            ? approvedItems.length
            : item === PRODUCT_WALL_FAVORITES_FILTER
              ? isLoggedIn
                ? approvedItems.filter((image) => favoriteIds.has(image.id)).length
                : 0
              : approvedItems.filter((image) => image.kind === item).length;
        return acc;
      }, {}),
    [filters, approvedItems, isLoggedIn, favoriteIds],
  );
  const canManageItem = useCallback((item?: WallItem) => Boolean(item?.id) && isAdmin, [isAdmin]);
  const selectableVisibleItems = useMemo(() => visibleItems.filter(canManageItem), [visibleItems, canManageItem]);
  const activeFavorited = active ? favoriteIds.has(active.id) : false;
  const activeId = active?.id;
  const selectedCount = selectedIds.size;
  const editForm = useMemo(
    () => ({ title: editTitle, description: editDescription, kind: editKind, tags: editTags }),
    [editDescription, editKind, editTags, editTitle],
  );
  const setEditForm = useCallback(
    (form: { title: string; description?: string; kind: ProductWallKind; tags: string }) => {
      setEditTitle(form.title);
      setEditDescription(form.description || '');
      setEditKind(form.kind);
      setEditTags(form.tags);
    },
    [],
  );
  const resolvedFilters = categoryNames;
  const previewZoomed = previewZoom > 1.01;
  const syncUpdatedWallItem = (updated: WallItem) => {
    setActive((current) => (current?.id === updated.id ? updated : current));
    setEditingItem((current) => (current?.id === updated.id ? updated : current));
    void mutate((current) => current?.map((item) => (item.id === updated.id ? updated : item)), { revalidate: false });
  };
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [loginDialogReason, setLoginDialogReason] = useState('');
  const toggleFavoriteItem = async (item: WallItem) => {
    if (!isLoggedIn) {
      if (isLoginDialogEnabled()) {
        setLoginDialogReason('收藏图片');
        setLoginDialogOpen(true);
      } else {
        navigate('/login', { state: { from: location.pathname } });
      }
      return;
    }
    const wasFavorite = favoriteIds.has(item.id);
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (wasFavorite) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
    toast(wasFavorite ? '已取消收藏' : '已收藏，可在产品图库「我的收藏」查看', 'success');
    try {
      if (wasFavorite) await removeProductWallFavorite(item.id);
      else await addProductWallFavorite(item.id);
    } catch {
      setFavoriteIds((prev) => {
        const next = new Set(prev);
        if (wasFavorite) next.add(item.id);
        else next.delete(item.id);
        return next;
      });
      toast('收藏操作失败', 'error');
    }
  };
  const toggleFavorite = async () => {
    if (!active) return;
    await toggleFavoriteItem(active);
  };
  const shareTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shareActiveImage = async () => {
    if (!active) return;
    const url = wallImageUrl(active);
    try {
      if (navigator.share) {
        await navigator.share({ title: active.title, text: active.kind, url });
      } else {
        await copyText(url);
        setShareState('copied');
        if (shareTimeoutRef.current) clearTimeout(shareTimeoutRef.current);
        shareTimeoutRef.current = setTimeout(() => setShareState('idle'), 1600);
      }
    } catch {
      try {
        await copyText(url);
        setShareState('copied');
        if (shareTimeoutRef.current) clearTimeout(shareTimeoutRef.current);
        shareTimeoutRef.current = setTimeout(() => setShareState('idle'), 1600);
      } catch {
        setShareState('idle');
      }
    }
  };
  const uploadFiles = useCallback(
    async (fileList: FileList | File[], meta?: { title?: string; description?: string }) => {
      if (!canUpload) {
        if (isLoginDialogEnabled()) {
          setLoginDialogReason('上传图片');
          setLoginDialogOpen(true);
        } else {
          navigate('/login', { state: { from: location.pathname } });
        }
        return;
      }
      if (!uploadKind) {
        toast('请先创建产品图库分类后再上传', 'error');
        return;
      }
      const title = (meta?.title || '').trim();
      const description = (meta?.description || '').trim();
      if (!isAdmin && (!title || !description)) {
        const files = Array.from(fileList);
        if (!files.length) return;
        setPendingUploadFiles(files);
        setUploadTitle(title);
        setUploadDescription(description);
        return;
      }
      const supportedFiles = Array.from(fileList).filter(isSupportedUploadFile);
      const oversizedImages = supportedFiles.filter(
        (file) => isImageFile(file) && file.size > productWallMaxImageBytes,
      );
      const files = supportedFiles.filter((file) => !oversizedImages.includes(file));
      if (!files.length) {
        if (oversizedImages.length) {
          const sample = oversizedImages
            .slice(0, 3)
            .map((file) => `${file.name} ${formatFileSize(file.size)}`)
            .join('、');
          toast(
            `已跳过 ${oversizedImages.length} 张超过 ${uploadPolicy.productWallImageMaxSizeMb}MB 的图片：${sample}`,
            'error',
          );
        } else {
          toast('请选择图片、文件夹或 zip/rar 压缩包', 'error');
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
            const firstTitle = batch[0]?.name.replace(/\.[^.]+$/, '') || undefined;
            const result = await uploadProductWallImages(batch, {
              admin: isAdmin,
              kind: uploadKind,
              title: isAdmin ? (files.length === 1 ? firstTitle : undefined) : title,
              description: isAdmin ? undefined : description,
            });
            uploadedCount += result.items.length;
          } catch (error) {
            failedMessages.push(errorMessage(error, '上传失败'));
          }
        }
        await mutate();
        if (uploadedCount) {
          const skippedText = oversizedImages.length ? `，已跳过 ${oversizedImages.length} 张超限图片` : '';
          const failText = failedMessages.length
            ? `；部分失败：${Array.from(new Set(failedMessages)).slice(0, 2).join('；')}`
            : '';
          toast(
            isAdmin
              ? `已上传 ${uploadedCount} 张图片到「${uploadKind}」${skippedText}${failText}`
              : `已提交 ${uploadedCount} 张图片，审核通过后展示${skippedText}${failText}`,
            uploadedCount && !failedMessages.length ? 'success' : 'success',
          );
        } else if (failedMessages.length) {
          toast(Array.from(new Set(failedMessages)).slice(0, 2).join('；'), 'error');
        } else if (oversizedImages.length) {
          const sample = oversizedImages
            .slice(0, 3)
            .map((file) => `${file.name} ${formatFileSize(file.size)}`)
            .join('、');
          toast(
            `已跳过 ${oversizedImages.length} 张超过 ${uploadPolicy.productWallImageMaxSizeMb}MB 的图片：${sample}`,
            'error',
          );
        }
      } catch (error) {
        toast(errorMessage(error, '上传图片失败'), 'error');
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
        if (folderInputRef.current) folderInputRef.current.value = '';
      }
    },
    [canUpload, isAdmin, mutate, productWallMaxImageBytes, toast, uploadKind, uploadPolicy.productWallImageMaxSizeMb],
  );
  const handleUploadSource = useCallback(
    (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      if (!files.length) return;
      if (!isAdmin) {
        setPendingUploadFiles(files);
        setUploadTitle('');
        setUploadDescription('');
        return;
      }
      void uploadFiles(files);
    },
    [isAdmin, uploadFiles],
  );
  const submitPendingUpload = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!pendingUploadFiles?.length) return;
    const title = uploadTitle.trim();
    const description = uploadDescription.trim();
    if (!title) {
      toast('请填写图片标题', 'error');
      return;
    }
    if (!description) {
      toast('请填写图片描述', 'error');
      return;
    }
    const files = pendingUploadFiles;
    setPendingUploadFiles(null);
    void uploadFiles(files, { title, description });
  };
  const handlePaste = useCallback(
    async (event: ClipboardEvent<HTMLDivElement>) => {
      if (!canUpload) return;
      if (!uploadKind) {
        toast('请先创建产品图库分类后再上传', 'error');
        return;
      }
      const pastedImages = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'));
      if (pastedImages.length) {
        event.preventDefault();
        handleUploadSource(pastedImages);
        return;
      }
    },
    [canUpload, handleUploadSource, uploadKind, toast],
  );
  useEffect(() => {
    const updateColumnCount = () => setColumnCount(getProductWallColumnCount());
    updateColumnCount();
    window.addEventListener('resize', updateColumnCount);
    return () => window.removeEventListener('resize', updateColumnCount);
  }, []);
  useEffect(() => {
    if (folderInputRef.current) {
      folderInputRef.current.setAttribute('webkitdirectory', '');
      folderInputRef.current.setAttribute('directory', '');
    }
    return () => {
      if (shareTimeoutRef.current) clearTimeout(shareTimeoutRef.current);
    };
  }, []);
  useEffect(() => {
    if (!canUpload) return;
    const hasFiles = (event: globalThis.DragEvent) => Array.from(event.dataTransfer?.types || []).includes('Files');
    const handleDocumentDragOver = (event: globalThis.DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDragActive(true);
    };
    const handleDocumentDragLeave = (event: globalThis.DragEvent) => {
      if (
        event.clientX <= 0 ||
        event.clientY <= 0 ||
        event.clientX >= window.innerWidth ||
        event.clientY >= window.innerHeight
      ) {
        setDragActive(false);
      }
    };
    const handleDocumentDrop = (event: globalThis.DragEvent) => {
      if (!hasFiles(event) || !event.dataTransfer) return;
      event.preventDefault();
      setDragActive(false);
      void collectFilesFromDataTransfer(event.dataTransfer).then(handleUploadSource);
    };
    document.addEventListener('dragover', handleDocumentDragOver);
    document.addEventListener('dragleave', handleDocumentDragLeave);
    document.addEventListener('drop', handleDocumentDrop);
    return () => {
      document.removeEventListener('dragover', handleDocumentDragOver);
      document.removeEventListener('dragleave', handleDocumentDragLeave);
      document.removeEventListener('drop', handleDocumentDrop);
    };
  }, [canUpload, handleUploadSource]);
  useEffect(() => {
    setRenderCount(PRODUCT_WALL_RENDER_BATCH_SIZE);
    setWallReady(false);
    setSelectedIds(new Set());
    setWallEditMode(false);
    setSelectionMode(false);
  }, [filter, normalizedQuery]);
  useEffect(() => {
    if (initialLoading) {
      setWallReady(false);
      return;
    }
    const frame = window.requestAnimationFrame(() => setWallReady(true));
    return () => window.cancelAnimationFrame(frame);
  }, [initialLoading, filter, normalizedQuery, columnCount]);
  useEffect(() => {
    setSelectedIds(new Set());
    setManagementRenderCount(PRODUCT_WALL_RENDER_BATCH_SIZE);
  }, [reviewFilter, managementKindFilter, normalizedManagementQuery]);
  useEffect(() => {
    setPreviewZoom(1);
    setPreviewPan({ x: 0, y: 0 });
    setPreviewDragging(false);
    previewDragRef.current = { active: false, moved: false, startX: 0, startY: 0, panX: 0, panY: 0 };
    if (activeId) requestAnimationFrame(() => previewCloseRef.current?.focus());
  }, [activeId]);
  const { data: favoriteData } = useSWR(isLoggedIn ? 'product-wall-favorites' : null, listProductWallFavorites);
  useEffect(() => {
    setFavoriteIds(new Set(favoriteData || []));
  }, [favoriteData]);
  const visibleItemsLengthRef = useRef(0);
  const renderCountRef = useRef(renderCount);
  renderCountRef.current = renderCount;
  const previewCanvasRef = useRef<HTMLDivElement | null>(null);
  visibleItemsLengthRef.current = visibleItems.length;
  const loadMoreVisibleItems = useCallback(() => {
    setRenderCount((count) => Math.min(count + PRODUCT_WALL_RENDER_BATCH_SIZE, visibleItemsLengthRef.current));
  }, []);
  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasMoreVisibleItems || !wallReady) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        loadMoreVisibleItems();
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [visibleItems.length, hasMoreVisibleItems, renderedItems.length, wallReady, loadMoreVisibleItems]);
  const previewZoomRef = useRef(previewZoom);
  previewZoomRef.current = previewZoom;
  const setPreviewZoomLevel = (value: number) => {
    const nextZoom = Math.min(5, Math.max(1, value));
    setPreviewZoom(nextZoom);
    if (nextZoom <= 1.01) setPreviewPan({ x: 0, y: 0 });
  };
  useEffect(() => {
    const el = previewCanvasRef.current;
    if (!el) return;
    const handler = (e: globalThis.WheelEvent) => {
      e.preventDefault();
      setPreviewZoomLevel(previewZoomRef.current + (e.deltaY > 0 ? -0.18 : 0.18));
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [active]);
  useEffect(() => {
    if (!manageMenuOpen) return;
    const close = () => {
      setManageMenuOpen(false);
    };
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [manageMenuOpen]);
  useEffect(() => {
    if (!active || editingItem || deleteDialog) return;
    const closePreview = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setActive(null);
    };
    window.addEventListener('keydown', closePreview);
    return () => window.removeEventListener('keydown', closePreview);
  }, [active, editingItem, deleteDialog]);
  const togglePreviewZoom = () => {
    setPreviewZoomLevel(previewZoomed ? 1 : 2.15);
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
  const openEditItem = (item: WallItem) => {
    setEditingItem(item);
    setEditTitle(item.title);
    setEditDescription(item.description || '');
    setEditKind(item.kind);
    setEditTags(item.tags.join('，'));
  };
  const saveEditingItem = async () => {
    if (!editingItem) return;
    try {
      const updated = await updateProductWallItem(editingItem.id, {
        title: editTitle,
        description: editDescription,
        tags: editTags,
        kind: editKind,
      });
      syncUpdatedWallItem(updated);
      setEditingItem(null);
      toast('图片信息已更新', 'success');
    } catch (error) {
      toast(errorMessage(error, '更新失败'), 'error');
    }
  };
  const removeItem = async (item: WallItem) => {
    setDeleteDialog({ type: 'single', item });
  };
  const confirmDelete = async () => {
    if (!deleteDialog) return;
    setDeleting(true);
    try {
      if (deleteDialog.type === 'single') {
        await deleteProductWallItem(deleteDialog.item.id);
        if (active?.id === deleteDialog.item.id) setActive(null);
        await mutate();
        toast('图片已删除', 'success');
      } else {
        const result = await deleteProductWallItems(deleteDialog.ids);
        setSelectedIds(new Set());
        setSelectionMode(false);
        if (active && deleteDialog.ids.includes(active.id)) setActive(null);
        await mutate();
        toast(`已删除 ${result.deleted} 张图片`, 'success');
      }
      setDeleteDialog(null);
    } catch (error) {
      toast(errorMessage(error, deleteDialog.type === 'single' ? '删除失败' : '批量删除失败'), 'error');
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
  const selectCurrentVisibleItems = () => {
    setSelectionMode(true);
    setSelectedIds(new Set(selectableVisibleItems.map((item) => item.id)));
  };
  const openManagementPanel = () => {
    setManagementKindFilter(
      filter !== '全部' && filter !== PRODUCT_WALL_FAVORITES_FILTER && categoryNames.includes(filter)
        ? (filter as ProductWallKind)
        : '全部',
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
      toast('请先选择要删除的图片', 'error');
      return;
    }
    setDeleteDialog({ type: 'batch', ids });
  };
  const reviewItem = async (item: WallItem, input: { status: 'approved' | 'rejected'; rejectReason?: string }) => {
    const rejectReason =
      input.status === 'rejected'
        ? (input.rejectReason ?? (window.prompt('拒绝原因，可留空', item.rejectReason || '') || undefined))
        : undefined;
    try {
      const updated = await reviewProductWallItem(item.id, { status: input.status, rejectReason });
      syncUpdatedWallItem(updated);
      toast(input.status === 'approved' ? '图片已通过审核' : '图片已拒绝', 'success');
    } catch (error) {
      toast(errorMessage(error, '审核失败'), 'error');
    }
  };
  const createCategory = async (rawName: string) => {
    const name = rawName.trim();
    if (!name) {
      toast('请输入分类名称', 'error');
      return;
    }
    try {
      await createProductWallCategory(name);
      await mutateCategories();
      toast('分类已创建', 'success');
    } catch (error) {
      toast(errorMessage(error, '创建分类失败'), 'error');
    }
  };
  const renameCategory = async (id: string, rawName: string) => {
    const name = rawName.trim();
    if (!name) {
      toast('分类名称不能为空', 'error');
      return;
    }
    try {
      const oldName = categories?.find((item) => item.id === id)?.name;
      await updateProductWallCategory(id, { name });
      if (filter === oldName) setFilter(name);
      if (managementKindFilter === oldName) setManagementKindFilter(name as ProductWallKind);
      if (oldName && oldName !== name) {
        void mutate((current) => current?.map((item) => (item.kind === oldName ? { ...item, kind: name } : item)), {
          revalidate: false,
        });
      }
      void mutateCategories((current) => current?.map((item) => (item.id === id ? { ...item, name } : item)), {
        revalidate: false,
      });
      toast('分类已更新', 'success');
    } catch (error) {
      toast(errorMessage(error, '更新分类失败'), 'error');
    }
  };
  const removeCategory = async (id: string, name: string) => {
    if (!window.confirm(`确定删除分类「${name}」吗？仅空分类可以删除。`)) return;
    try {
      await deleteProductWallCategory(id);
      if (filter === name) setFilter('全部');
      if (managementKindFilter === name) setManagementKindFilter('全部');
      await mutateCategories();
      toast('分类已删除', 'success');
    } catch (error) {
      toast(errorMessage(error, '删除分类失败'), 'error');
    }
  };
  const headerActions = canUpload ? (
    <div className="product-wall-action-row flex w-auto items-center justify-end gap-1.5 md:flex-wrap md:gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.zip,.rar,application/zip,application/vnd.rar"
        multiple
        className="hidden"
        onChange={(event) => event.target.files && handleUploadSource(event.target.files)}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => event.target.files && handleUploadSource(event.target.files)}
      />
      <ProductWallActionMenu
        variant="mobile"
        isAdmin={isAdmin}
        uploading={uploading}
        uploadDisabled={uploadDisabled}
        wallEditMode={wallEditMode}
        selectionMode={selectionMode}
        selectedCount={selectedCount}
        selectableVisibleItems={selectableVisibleItems}
        manageMenuOpen={manageMenuOpen}
        setManageMenuOpen={setManageMenuOpen}
        fileInputRef={fileInputRef}
        folderInputRef={folderInputRef}
        onToggleEditMode={() => {
          setManageMenuOpen(false);
          setWallEditMode((v) => !v);
          setSelectionMode(false);
          setSelectedIds(new Set());
        }}
        onToggleSelectionMode={() => {
          setManageMenuOpen(false);
          setSelectionMode((v) => !v);
          setWallEditMode(false);
          if (selectionMode) setSelectedIds(new Set());
        }}
        onSelectAll={() => {
          setManageMenuOpen(false);
          selectCurrentVisibleItems();
        }}
        onDeleteSelected={() => {
          setManageMenuOpen(false);
          void removeSelectedItems();
        }}
        onClearSelection={() => {
          setManageMenuOpen(false);
          clearSelection();
        }}
        onOpenManagement={() => {
          setManageMenuOpen(false);
          openManagementPanel();
        }}
      />
      <ProductWallActionMenu
        variant="desktop"
        isAdmin={isAdmin}
        uploading={uploading}
        uploadDisabled={uploadDisabled}
        wallEditMode={wallEditMode}
        selectionMode={selectionMode}
        selectedCount={selectedCount}
        selectableVisibleItems={selectableVisibleItems}
        manageMenuOpen={manageMenuOpen}
        setManageMenuOpen={setManageMenuOpen}
        fileInputRef={fileInputRef}
        folderInputRef={folderInputRef}
        onToggleEditMode={() => {
          setManageMenuOpen(false);
          setWallEditMode((v) => !v);
          setSelectionMode(false);
          setSelectedIds(new Set());
        }}
        onToggleSelectionMode={() => {
          setManageMenuOpen(false);
          setSelectionMode((v) => !v);
          setWallEditMode(false);
          if (selectionMode) setSelectedIds(new Set());
        }}
        onSelectAll={() => {
          setManageMenuOpen(false);
          selectCurrentVisibleItems();
        }}
        onDeleteSelected={() => {
          setManageMenuOpen(false);
          void removeSelectedItems();
        }}
        onClearSelection={() => {
          setManageMenuOpen(false);
          clearSelection();
        }}
        onOpenManagement={openManagementPanel}
      />
    </div>
  ) : null;

  return (
    <AdminPageShell desktopContentClassName="p-8" mobileContentClassName="px-4 py-4 pb-20">
      <div className="relative" onPaste={handlePaste}>
        <AdminManagementPage
          title="产品图库"
          meta={initialLoading ? '加载中' : undefined}
          description="公司产品、使用现场和客户案例实拍图统一归档，按图库方式浏览。"
          actions={headerActions}
          toolbar={
            <div className="product-wall-toolbar grid min-h-11 items-center gap-3 md:grid-cols-[minmax(0,1fr)_18rem]">
              <ResponsiveSectionTabs
                tabs={filters.map((item) => ({
                  value: item,
                  label: item,
                  count: filterCounts[item] || 0,
                  icon: item === '全部' ? 'grid_view' : item === PRODUCT_WALL_FAVORITES_FILTER ? 'favorite' : 'image',
                }))}
                value={filter}
                onChange={setFilter}
                mobileTitle="当前分类"
                countUnit="张"
              />
              <label className="product-wall-search flex h-9 w-full min-w-0 items-center rounded-sm border border-outline-variant/30 bg-surface-container-lowest px-3 md:ml-auto md:w-72">
                <Icon name="search" size={15} className="mr-2 shrink-0 text-on-surface-variant" />
                <input
                  {...queryInputProps}
                  placeholder="搜索标题或标签..."
                  className="h-full min-w-0 flex-1 border-none bg-transparent p-0 text-sm leading-none text-on-surface outline-none placeholder:text-on-surface-variant/50"
                />
                {queryInputValue && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    className="p-0.5 text-on-surface-variant hover:text-on-surface"
                    aria-label="清空搜索"
                    data-tooltip-ignore
                  >
                    <Icon name="close" size={14} />
                  </button>
                )}
              </label>
            </div>
          }
          contentClassName="overflow-visible"
        >
          {dragActive && (
            <div className="mb-4 flex h-10 items-center justify-center border-y border-primary-container/35 bg-primary-container/6 text-sm font-medium text-primary-container">
              松开上传
            </div>
          )}

          {initialLoading || (visibleItems.length > 0 && !wallReady) ? (
            <ProductWallSkeletonGrid columns={columnCount} />
          ) : visibleItems.length ? (
            <>
              <section className="product-wall-masonry w-full">
                {masonryColumns.map((column, columnIndex) => (
                  <div key={columnIndex} className="product-wall-masonry-column">
                    {column.map((item, index) => {
                      const selected = selectedIds.has(item.id);
                      const selectable = canManageItem(item);
                      const itemFavorited = favoriteIds.has(item.id);
                      return (
                        <article
                          key={item.id || `${item.title}-${index}`}
                          className={`product-wall-card group relative break-inside-avoid overflow-hidden rounded-xl bg-transparent ${
                            selected ? 'outline outline-2 outline-offset-2 outline-primary-container' : ''
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
                              selectionMode && !selectable ? 'cursor-not-allowed opacity-55' : ''
                            }`}
                          >
                            <div
                              className={`product-wall-image-surface product-wall-canvas-${canvasMode} relative overflow-hidden rounded-xl`}
                            >
                              <SafeImage
                                src={productWallPreviewImage(item)}
                                alt={item.title}
                                loading={index < 2 ? 'eager' : 'lazy'}
                                className="relative z-10 block h-auto w-full align-middle transition duration-300 group-hover:brightness-[0.96]"
                                fallbackClassName="min-h-40 w-full"
                              />
                              {selectionMode && selectable && (
                                <span
                                  className={`absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full border shadow-sm backdrop-blur ${
                                    selected
                                      ? 'border-primary-container bg-primary-container text-on-primary-container'
                                      : 'border-white/50 bg-black/24 text-white'
                                  }`}
                                >
                                  <Icon name={selected ? 'check' : 'add'} size={16} />
                                </span>
                              )}
                            </div>
                          </button>
                          {!wallEditMode && !selectionMode && (
                            <div className="product-wall-card-actions absolute right-2 top-2 z-20 flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void toggleFavoriteItem(item);
                                }}
                                className={`product-wall-card-action ${itemFavorited ? 'is-active' : ''}`}
                                aria-label={itemFavorited ? '取消收藏' : '收藏图片'}
                                title={itemFavorited ? '取消收藏' : '收藏'}
                                data-tooltip-ignore
                              >
                                <Icon name={itemFavorited ? 'favorite' : 'star'} size={14} />
                              </button>
                              <a
                                href={item.image}
                                download={productWallDownloadName(item)}
                                onClick={(event) => event.stopPropagation()}
                                className="product-wall-card-action"
                                aria-label="下载图片"
                                title="下载"
                                data-tooltip-ignore
                              >
                                <Icon name="download" size={14} />
                              </a>
                            </div>
                          )}
                          {wallEditMode && selectable && !selectionMode && (
                            <div className="product-wall-card-actions product-wall-card-actions-edit absolute right-2 top-2 z-20 flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openEditItem(item);
                                }}
                                className="product-wall-card-action"
                                aria-label="编辑图片"
                                title="编辑"
                                data-tooltip-ignore
                              >
                                <Icon name="edit" size={14} />
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void removeItem(item);
                                }}
                                className="product-wall-card-action is-danger"
                                aria-label="删除图片"
                                title="删除"
                                data-tooltip-ignore
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
              {hasMoreVisibleItems ? (
                <button
                  ref={loadMoreRef}
                  type="button"
                  onClick={loadMoreVisibleItems}
                  className="product-wall-load-more flex h-16 w-full items-center justify-center gap-2 text-xs text-on-surface-variant transition-colors hover:text-primary-container"
                >
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-on-surface-variant/50" />
                  继续下拉加载更多
                  <span
                    className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-on-surface-variant/50"
                    style={{ animationDelay: '0.3s' }}
                  />
                </button>
              ) : visibleItems.length > PRODUCT_WALL_RENDER_BATCH_SIZE ? (
                <div className="flex h-12 w-full items-center justify-center text-xs text-on-surface-variant/40">
                  — 已经到底了 —
                </div>
              ) : null}
            </>
          ) : (
            <section className="flex min-h-[360px] items-center justify-center border-y border-dashed border-outline-variant/28 bg-surface-container-low/35 px-4 py-12 text-center">
              <div className="max-w-sm">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary-container/10 text-primary-container">
                  <Icon name="cloud_upload" size={22} />
                </div>
                <h2 className="mt-4 text-base font-semibold text-on-surface">
                  {apiError
                    ? '产品图库数据加载失败'
                    : isFavoritesFilter
                      ? '还没有收藏图片'
                      : canUpload
                        ? '这里还没有图片'
                        : '暂无产品图库'}
                </h2>
                <p className="mt-2 text-sm leading-6 text-on-surface-variant">
                  {apiError
                    ? errorMessage(apiError, '请检查后端接口和数据库连接，页面不会再用演示图片替代真实数据。')
                    : isFavoritesFilter
                      ? isLoggedIn
                        ? '打开图片详情后点击收藏，喜欢的产品图片会集中显示在这里。'
                        : '请先登录，登录后才能收藏和查看已收藏的产品图片。'
                      : canUpload
                        ? uploadKind
                          ? `可通过标题右侧的上传入口添加图片，当前默认保存到「${uploadKind}」。`
                          : '请先在图片管理里创建分类，然后再上传图片。'
                        : '当前分类还没有图片，登录后可以上传产品、案例或海报图片。'}
                </p>
              </div>
            </section>
          )}
        </AdminManagementPage>
      </div>

      {managementOpen && isAdmin && (
        <ProductWallManagementPanel
          items={managementItems}
          categories={categoryList}
          reviewFilter={reviewFilter}
          setReviewFilter={setReviewFilter}
          managementKindFilter={managementKindFilter}
          setManagementKindFilter={setManagementKindFilter}
          managementQuery={managementQuery}
          setManagementQuery={setManagementQuery}
          managementRenderCount={managementRenderCount}
          setManagementRenderCount={setManagementRenderCount}
          canManageItem={canManageItem}
          close={closeManagement}
          onReview={(id, input) => {
            const item = managementItems.find((candidate) => candidate.id === id);
            if (item) void reviewItem(item, input);
          }}
          onUpdateItem={(id) => {
            const item = managementItems.find((i) => i.id === id);
            if (item) openEditItem(item);
          }}
          onDeleteItem={(id) => {
            const item = managementItems.find((candidate) => candidate.id === id);
            if (item) void removeItem(item);
          }}
          onSaveCategory={(name) => void createCategory(name)}
          onRenameCategory={(id, name) => void renameCategory(id, name)}
          onDeleteCategory={(id) => {
            const category = categoryList.find((item) => item.id === id);
            if (category) void removeCategory(id, category.name);
          }}
          editingItem={editingItem}
          setEditingItem={setEditingItem}
          editForm={editForm}
          setEditForm={setEditForm}
          saveEdit={() => void saveEditingItem()}
          resolvedFilters={resolvedFilters}
        />
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
                    {deleteDialog.type === 'single'
                      ? '删除后图片会从产品图库和图片管理中移除，已上传到本地的图片文件也会一并清理。'
                      : `将删除已选的 ${deleteDialog.ids.length} 张图片，删除后无法恢复。`}
                  </p>
                </div>
              </div>

              {deleteDialog.type === 'single' ? (
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
                <Icon name={deleting ? 'sync' : 'delete'} size={16} className={deleting ? 'animate-spin' : ''} />
                {deleting ? '删除中' : '确认删除'}
              </button>
            </div>
          </section>
        </div>
      )}

      {editingItem && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/35 px-4 py-6 backdrop-blur-sm"
          onClick={() => setEditingItem(null)}
        >
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
                data-tooltip-ignore
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
                <span className="text-xs font-medium text-on-surface-variant">描述</span>
                <textarea
                  value={editDescription}
                  onChange={(event) => setEditDescription(event.target.value)}
                  rows={3}
                  className="mt-1 w-full resize-none border-b border-outline-variant/35 bg-transparent py-2 text-sm text-on-surface outline-none transition-colors focus:border-primary-container"
                  placeholder="补充图片内容、现场信息或使用场景"
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
                    <option key={kind} value={kind}>
                      {kind}
                    </option>
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

      {pendingUploadFiles && !isAdmin && (
        <div
          className="fixed inset-0 z-[10003] flex items-center justify-center bg-black/42 px-4 py-6 backdrop-blur-md"
          onClick={() => {
            setPendingUploadFiles(null);
            if (fileInputRef.current) fileInputRef.current.value = '';
            if (folderInputRef.current) folderInputRef.current.value = '';
          }}
        >
          <form
            className="w-full max-w-md overflow-hidden rounded-xl border border-outline-variant/16 bg-surface shadow-[0_28px_100px_rgba(0,0,0,0.32)]"
            onClick={(event) => event.stopPropagation()}
            onSubmit={submitPendingUpload}
          >
            <div className="border-b border-outline-variant/12 px-5 py-4">
              <p className="text-xs font-semibold tracking-[0.16em] text-primary-container">UPLOAD INFO</p>
              <h2 className="mt-1 text-lg font-bold text-on-surface">填写图片信息</h2>
              <p className="mt-1 text-sm text-on-surface-variant">
                将提交 {pendingUploadFiles.length} 个文件到「{uploadKind}」，审核通过后展示。
              </p>
            </div>
            <div className="space-y-4 px-5 py-5">
              <label className="block">
                <span className="text-xs font-medium text-on-surface-variant">
                  标题 <span className="text-red-500">*</span>
                </span>
                <input
                  value={uploadTitle}
                  onChange={(event) => setUploadTitle(event.target.value)}
                  className="mt-1 h-10 w-full border-b border-outline-variant/35 bg-transparent text-sm text-on-surface outline-none transition-colors focus:border-primary-container"
                  placeholder="例如：现场安装效果"
                  autoFocus
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-on-surface-variant">
                  描述 <span className="text-red-500">*</span>
                </span>
                <textarea
                  value={uploadDescription}
                  onChange={(event) => setUploadDescription(event.target.value)}
                  rows={4}
                  className="mt-1 w-full resize-none rounded-md border border-outline-variant/24 bg-surface-container-lowest px-3 py-2 text-sm leading-6 text-on-surface outline-none transition-colors focus:border-primary-container"
                  placeholder="说明图片内容、产品型号、安装场景或用途，方便管理员审核和后续查找。"
                />
              </label>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-outline-variant/12 bg-surface-container-low/60 px-5 py-4">
              <button
                type="button"
                onClick={() => {
                  setPendingUploadFiles(null);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                  if (folderInputRef.current) folderInputRef.current.value = '';
                }}
                className="inline-flex h-9 items-center justify-center rounded-sm px-4 text-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
              >
                取消
              </button>
              <button
                type="submit"
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-sm bg-primary-container px-4 text-sm font-semibold text-on-primary-container transition-colors hover:bg-primary-container/90"
              >
                <Icon name="cloud_upload" size={16} />
                提交审核
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
              className={`product-wall-preview-canvas product-wall-canvas-${canvasMode} relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-0 ${previewZoomed ? 'select-none' : ''}`}
              ref={previewCanvasRef}
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
                  previewZoomed ? (previewDragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in'
                }`}
                aria-label={previewZoomed ? '还原图片' : '放大图片'}
                data-tooltip-ignore
              >
                <SafeImage
                  src={productWallPreviewImage(active)}
                  alt={active.title}
                  loading="eager"
                  className={`product-wall-preview-image h-full w-full object-contain drop-shadow-[0_16px_42px_rgba(0,0,0,0.18)] ${previewDragging ? '' : 'transition-transform duration-300 ease-out'}`}
                  fallbackClassName="h-full w-full"
                  style={{ transform: `translate3d(${previewPan.x}px, ${previewPan.y}px, 0) scale(${previewZoom})` }}
                />
              </button>
              <button
                ref={previewCloseRef}
                type="button"
                onClick={() => {
                  setPreviewZoomLevel(1);
                  setActive(null);
                }}
                className="product-wall-preview-close absolute right-4 top-4 z-20 inline-flex h-9 w-9 items-center justify-center rounded-full border border-black/8 bg-white/78 text-neutral-800 shadow-[0_8px_24px_rgba(0,0,0,0.14)] backdrop-blur-md transition-colors hover:bg-white"
                aria-label="关闭"
                data-tooltip-ignore
              >
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="product-wall-preview-info z-20 flex shrink-0 items-center justify-between gap-3 border-t border-outline-variant/12 bg-surface px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 text-on-surface md:px-5 md:py-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold tracking-[0.18em] text-primary-container">{active.kind}</p>
                <h2 className="mt-1 truncate text-base font-bold md:text-lg">{active.title}</h2>
                {active.description ? (
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-on-surface-variant">{active.description}</p>
                ) : null}
              </div>
              <div className="product-wall-preview-actions flex shrink-0 items-center gap-1.5">
                <PreviewActionButton
                  icon={previewZoomed ? 'zoom_out' : 'zoom_in'}
                  label={previewZoomed ? '还原' : '放大'}
                  active={previewZoomed}
                  onClick={togglePreviewZoom}
                />
                <PreviewActionButton
                  icon={activeFavorited ? 'favorite' : 'star'}
                  label={activeFavorited ? '取消收藏' : '收藏'}
                  active={activeFavorited}
                  onClick={toggleFavorite}
                />
                <PreviewActionButton
                  icon={shareState === 'copied' ? 'check' : 'share'}
                  label={shareState === 'copied' ? '已复制' : '分享'}
                  active={shareState === 'copied'}
                  onClick={shareActiveImage}
                />
                <a
                  href={active.image}
                  download={productWallDownloadName(active)}
                  className="product-wall-preview-action inline-flex h-9 w-9 items-center justify-center rounded-full border border-outline-variant/16 bg-transparent text-on-surface-variant transition-colors hover:border-outline-variant/28 hover:bg-surface-container-high hover:text-on-surface"
                  aria-label="下载"
                  data-tooltip-ignore
                >
                  <Icon name="download" size={16} />
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
      <LoginConfirmDialog open={loginDialogOpen} onClose={() => setLoginDialogOpen(false)} reason={loginDialogReason} />
    </AdminPageShell>
  );
}
