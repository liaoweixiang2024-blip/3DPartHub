import {
  startTransition,
  useCallback,
  useEffect,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
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
import {
  collectFilesFromDataTransfer,
  errorMessage,
  formatFileSize,
  getProductWallColumnCount,
  isSupportedUploadFile,
  isImageFile,
  productWallDownloadName,
  wallImageUrl,
  PRODUCT_WALL_RENDER_BATCH_SIZE,
  PRODUCT_WALL_FAVORITES_FILTER,
  PRODUCT_WALL_CANVAS_MODE_KEY,
  PRODUCT_WALL_DEFAULT_KIND_KEY,
  PRODUCT_WALL_UPLOAD_BATCH_SIZE,
  productWallRatioValue,
  type ProductWallCanvasMode,
} from '../components/product-wall-admin/productWallAdminUtils';
import {
  ProductWallDeleteDialog,
  type DeleteDialogState,
} from '../components/product-wall-admin/ProductWallDeleteDialog';
import { ProductWallEditDialog } from '../components/product-wall-admin/ProductWallEditDialog';
import { ProductWallPreview } from '../components/product-wall-admin/ProductWallPreview';
import { ProductWallThumbnail } from '../components/product-wall-admin/ProductWallThumbnail';
import { ProductWallUploadDialog } from '../components/product-wall-admin/ProductWallUploadDialog';
import { AdminManagementPage } from '../components/shared/AdminManagementPage';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import Icon from '../components/shared/Icon';
import LoginConfirmDialog from '../components/shared/LoginConfirmDialog';
import { PageRefreshIndicator } from '../components/shared/PageRefreshFallback';
import { isLoginDialogEnabled } from '../components/shared/ProtectedLink';
import ResponsiveSectionTabs from '../components/shared/ResponsiveSectionTabs';
import SearchField from '../components/shared/SearchField';
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

type ProductWallMasonryEntry = {
  imageIndex: number;
  item: WallItem;
};

function ProductWallLoadingState() {
  return (
    <section className="flex min-h-[320px] w-full">
      <PageRefreshIndicator label="产品图库刷新中" />
    </section>
  );
}

export default function ProductWallPage() {
  useDocumentTitle('产品图库');
  const navigate = useNavigate();
  const location = useLocation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const loadMoreRef = useRef<HTMLButtonElement | null>(null);
  const previewMenuBlockUntilRef = useRef(0);
  const activePreviewRef = useRef<WallItem | null>(null);
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
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
  const setManageMenuOpenGuarded = useCallback((value: boolean | ((prev: boolean) => boolean)) => {
    if (performance.now() < previewMenuBlockUntilRef.current) {
      setManageMenuOpen(false);
      return;
    }
    setManageMenuOpen(value);
  }, []);
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
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState>(null);
  const [deleting, setDeleting] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editKind, setEditKind] = useState<ProductWallKind>('公司产品');
  const [editTags, setEditTags] = useState('');
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => new Set());
  const [shareState, setShareState] = useState<'idle' | 'copied'>('idle');
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
    const columns = Array.from({ length: columnCount }, () => [] as ProductWallMasonryEntry[]);
    const heights = Array.from({ length: columnCount }, () => 0);
    renderedItems.forEach((item, imageIndex) => {
      let shortestColumnIndex = 0;
      for (let index = 1; index < columns.length; index += 1) {
        if (heights[index] < heights[shortestColumnIndex]) shortestColumnIndex = index;
      }
      columns[shortestColumnIndex].push({ imageIndex, item });
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
  activePreviewRef.current = active;
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
    [
      canUpload,
      isAdmin,
      location.pathname,
      mutate,
      navigate,
      productWallMaxImageBytes,
      toast,
      uploadKind,
      uploadPolicy.productWallImageMaxSizeMb,
    ],
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
  const { data: favoriteData } = useSWR(isLoggedIn ? 'product-wall-favorites' : null, listProductWallFavorites);
  useEffect(() => {
    setFavoriteIds(new Set(favoriteData || []));
  }, [favoriteData]);
  const visibleItemsLengthRef = useRef(0);
  const renderCountRef = useRef(renderCount);
  const loadMoreFrameRef = useRef<number | null>(null);
  renderCountRef.current = renderCount;
  visibleItemsLengthRef.current = visibleItems.length;
  const loadMoreVisibleItems = useCallback(() => {
    if (loadMoreFrameRef.current != null) return;
    loadMoreFrameRef.current = window.requestAnimationFrame(() => {
      loadMoreFrameRef.current = null;
      startTransition(() => {
        setRenderCount((count) => Math.min(count + PRODUCT_WALL_RENDER_BATCH_SIZE, visibleItemsLengthRef.current));
      });
    });
  }, []);
  useEffect(
    () => () => {
      if (loadMoreFrameRef.current != null) window.cancelAnimationFrame(loadMoreFrameRef.current);
    },
    [],
  );
  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasMoreVisibleItems || !wallReady) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        loadMoreVisibleItems();
      },
      { rootMargin: '360px 0px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMoreVisibleItems, wallReady, loadMoreVisibleItems]);
  const closeActivePreview = useCallback(() => {
    cancelAnimationFrame(0);
    previewMenuBlockUntilRef.current = performance.now() + 520;
    setActive(null);
    setManageMenuOpen(false);
  }, []);
  useEffect(() => {
    const blockPreviewClickThrough = (event: Event) => {
      if (performance.now() >= previewMenuBlockUntilRef.current || activePreviewRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      if ('stopImmediatePropagation' in event) event.stopImmediatePropagation();
    };
    window.addEventListener('click', blockPreviewClickThrough, true);
    window.addEventListener('pointerup', blockPreviewClickThrough, true);
    window.addEventListener('touchend', blockPreviewClickThrough, true);
    return () => {
      window.removeEventListener('click', blockPreviewClickThrough, true);
      window.removeEventListener('pointerup', blockPreviewClickThrough, true);
      window.removeEventListener('touchend', blockPreviewClickThrough, true);
    };
  }, []);
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
      closeActivePreview();
    };
    window.addEventListener('keydown', closePreview);
    return () => window.removeEventListener('keydown', closePreview);
  }, [active, editingItem, deleteDialog, closeActivePreview]);
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
        setManageMenuOpen={setManageMenuOpenGuarded}
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
        setManageMenuOpen={setManageMenuOpenGuarded}
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
    <AdminPageShell desktopContentClassName="p-6" mobileContentClassName="px-4 py-4 pb-20">
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
              <SearchField
                inputProps={queryInputProps}
                value={queryInputValue}
                onClear={() => setQuery('')}
                placeholder="搜索标题或标签..."
                className="product-wall-search md:ml-auto md:w-72"
              />
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
            <ProductWallLoadingState />
          ) : visibleItems.length ? (
            <>
              <section className="product-wall-masonry w-full">
                {masonryColumns.map((column, columnIndex) => (
                  <div key={columnIndex} className="product-wall-masonry-column">
                    {column.map(({ imageIndex, item }) => {
                      const selected = selectedIds.has(item.id);
                      const selectable = canManageItem(item);
                      const itemFavorited = favoriteIds.has(item.id);
                      return (
                        <article
                          key={item.id || `${item.title}-${imageIndex}`}
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
                              setManageMenuOpen(false);
                            }}
                            className={`block w-full overflow-hidden rounded-xl text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-container/35 ${
                              selectionMode && !selectable ? 'cursor-not-allowed opacity-55' : ''
                            }`}
                          >
                            <ProductWallThumbnail item={item} canvasMode={canvasMode} imageIndex={imageIndex}>
                              {selectionMode && selectable && (
                                <span
                                  className={`absolute right-2 top-2 z-20 inline-flex h-8 w-8 items-center justify-center rounded-full border shadow-sm backdrop-blur ${
                                    selected
                                      ? 'border-primary-container bg-primary-container text-on-primary-container'
                                      : 'border-white/50 bg-black/24 text-white'
                                  }`}
                                >
                                  <Icon name={selected ? 'check' : 'add'} size={16} />
                                </span>
                              )}
                            </ProductWallThumbnail>
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

      <ProductWallDeleteDialog
        deleteDialog={deleteDialog}
        deleting={deleting}
        onCancel={() => setDeleteDialog(null)}
        onConfirm={confirmDelete}
      />

      {editingItem && (
        <ProductWallEditDialog
          editingItem={editingItem}
          editTitle={editTitle}
          editDescription={editDescription}
          editKind={editKind}
          editTags={editTags}
          categoryNames={categoryNames}
          setEditTitle={setEditTitle}
          setEditDescription={setEditDescription}
          setEditKind={setEditKind}
          setEditTags={setEditTags}
          onCancel={() => setEditingItem(null)}
          onSave={() => void saveEditingItem()}
        />
      )}

      {pendingUploadFiles && !isAdmin && (
        <ProductWallUploadDialog
          pendingUploadFiles={pendingUploadFiles}
          uploadTitle={uploadTitle}
          uploadDescription={uploadDescription}
          uploadKind={uploadKind}
          fileInputRef={fileInputRef}
          folderInputRef={folderInputRef}
          setUploadTitle={setUploadTitle}
          setUploadDescription={setUploadDescription}
          onCancel={() => setPendingUploadFiles(null)}
          onSubmit={submitPendingUpload}
        />
      )}

      {active && (
        <ProductWallPreview
          active={active}
          canvasMode={canvasMode}
          activeFavorited={activeFavorited}
          shareState={shareState}
          onClose={closeActivePreview}
          onToggleFavorite={() => void toggleFavorite()}
          onShare={() => void shareActiveImage()}
        />
      )}
      <LoginConfirmDialog open={loginDialogOpen} onClose={() => setLoginDialogOpen(false)} reason={loginDialogReason} />
    </AdminPageShell>
  );
}
