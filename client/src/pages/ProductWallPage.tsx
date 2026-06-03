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
import { useTranslation } from 'react-i18next';
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
  PRODUCT_WALL_MOBILE_EAGER_IMAGE_COUNT,
  PRODUCT_WALL_MOBILE_RENDER_BATCH_SIZE,
  PRODUCT_WALL_EAGER_IMAGE_COUNT,
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
import ConfirmDialog from '../components/shared/ConfirmDialog';
import Icon from '../components/shared/Icon';
import LoginConfirmDialog from '../components/shared/LoginConfirmDialog';
import { PageRefreshIndicator } from '../components/shared/PageRefreshFallback';
import ResponsiveSectionTabs from '../components/shared/ResponsiveSectionTabs';
import SearchField from '../components/shared/SearchField';
import { useToast } from '../components/shared/Toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useImeSafeSearchInput } from '../hooks/useImeSafeSearchInput';
import { downloadBrowserFile } from '../lib/browserDownload';
import { getBusinessConfig } from '../lib/businessConfig';
import { copyText } from '../lib/clipboard';
import { useAuthStore } from '../stores/useAuthStore';

type WallItem = ProductWallItem;

type WallFilter = string;
type ReviewFilter = 'all' | ProductWallStatus;
type ManagementKindFilter = ProductWallKind;

type ProductWallMasonryEntry = {
  imageIndex: number;
  item: WallItem;
};

const PRODUCT_WALL_ALL_FILTER = '__all__';
const PRODUCT_WALL_MANAGEMENT_ALL_FILTER = '__all__';

function ProductWallLoadingState() {
  const { t } = useTranslation();

  return (
    <section className="flex min-h-[320px] w-full">
      <PageRefreshIndicator label={t('productWall.loadingLabel')} />
    </section>
  );
}

export default function ProductWallPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('productWall.title'));
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
  const productWallUploadBatchSize = Math.max(
    1,
    Math.min(50, Number(uploadPolicy.productWallUploadMaxFiles) || PRODUCT_WALL_UPLOAD_BATCH_SIZE),
  );
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
  const [filter, setFilter] = useState<WallFilter>(PRODUCT_WALL_ALL_FILTER);
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('approved');
  const [managementKindFilter, setManagementKindFilter] = useState<ManagementKindFilter>(
    PRODUCT_WALL_MANAGEMENT_ALL_FILTER,
  );
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
  const [columnCount, setColumnCount] = useState(getProductWallColumnCount);
  const initialRenderBatchSize =
    columnCount <= 2 ? PRODUCT_WALL_MOBILE_RENDER_BATCH_SIZE : PRODUCT_WALL_RENDER_BATCH_SIZE;
  const [renderCount, setRenderCount] = useState(initialRenderBatchSize);
  const [editingItem, setEditingItem] = useState<WallItem | null>(null);
  const [deleteCategoryTarget, setDeleteCategoryTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState>(null);
  const [deleting, setDeleting] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editKind, setEditKind] = useState<ProductWallKind>('');
  const [editTags, setEditTags] = useState('');
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => new Set());
  const [shareState, setShareState] = useState<'idle' | 'copied'>('idle');
  const [wallReady, setWallReady] = useState(false);
  const [managementRenderCount, setManagementRenderCount] = useState(PRODUCT_WALL_RENDER_BATCH_SIZE);
  const apiError = itemsError || categoriesError;
  const initialLoading = (isLoading && !data) || (categoriesLoading && !categories);
  const items = useMemo(() => data ?? [], [data]);
  const categoryList = useMemo(() => categories ?? [], [categories]);
  const databaseCategoryNames = useMemo(() => categoryList.map((item) => item.name).filter(Boolean), [categoryList]);
  const categoryNames = useMemo(() => Array.from(new Set(databaseCategoryNames)), [databaseCategoryNames]);
  const filters = useMemo<WallFilter[]>(
    () => [PRODUCT_WALL_ALL_FILTER, PRODUCT_WALL_FAVORITES_FILTER, ...categoryNames],
    [categoryNames],
  );
  const resolvedDefaultUploadKind = categoryNames.includes(defaultUploadKind)
    ? defaultUploadKind
    : categoryNames[0] || '';
  const isUtilityFilter = filter === PRODUCT_WALL_ALL_FILTER || filter === PRODUCT_WALL_FAVORITES_FILTER;
  const isFavoritesFilter = filter === PRODUCT_WALL_FAVORITES_FILTER;
  const uploadKind = isUtilityFilter ? resolvedDefaultUploadKind : filter;
  const uploadDisabled = uploading || !uploadKind;
  const isCompactWallLayout = columnCount <= 2;
  const renderBatchSize = isCompactWallLayout ? PRODUCT_WALL_MOBILE_RENDER_BATCH_SIZE : PRODUCT_WALL_RENDER_BATCH_SIZE;
  const eagerImageCount = isCompactWallLayout ? PRODUCT_WALL_MOBILE_EAGER_IMAGE_COUNT : PRODUCT_WALL_EAGER_IMAGE_COUNT;
  const thumbnailLazyRootMargin = isCompactWallLayout ? '180px 0px' : '300px 0px';
  const loadMoreRootMargin = isCompactWallLayout ? '180px 0px' : '300px 0px';
  const deferredQuery = useDeferredValue(query);
  const deferredManagementQuery = useDeferredValue(managementQuery);
  const normalizedQuery = deferredQuery.trim().toLowerCase();
  const normalizedManagementQuery = deferredManagementQuery.trim().toLowerCase();
  const approvedItems = useMemo(() => items.filter((item) => item.status === 'approved'), [items]);
  const visibleItems = useMemo(() => {
    const base =
      filter === PRODUCT_WALL_ALL_FILTER
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
      managementKindFilter === PRODUCT_WALL_MANAGEMENT_ALL_FILTER
        ? byStatus
        : byStatus.filter((item) => item.kind === managementKindFilter);
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
          item === PRODUCT_WALL_ALL_FILTER
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
      setLoginDialogReason(t('productWall.aria.favoriteImage'));
      setLoginDialogOpen(true);
      return;
    }
    const wasFavorite = favoriteIds.has(item.id);
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (wasFavorite) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
    toast(wasFavorite ? t('productWall.toasts.favoriteRemoved') : t('productWall.toasts.favoriteAdded'), 'success');
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
      toast(t('productWall.toasts.favoriteFailed'), 'error');
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
  const downloadProductWallItem = useCallback(
    async (item: ProductWallItem) => {
      try {
        await downloadBrowserFile(item.image, { fileName: productWallDownloadName(item) });
      } catch (err) {
        toast(errorMessage(err, t('productWall.toasts.downloadFailed')), 'error');
      }
    },
    [t, toast],
  );
  const uploadFiles = useCallback(
    async (fileList: FileList | File[], meta?: { title?: string; description?: string }) => {
      if (!canUpload) {
        setLoginDialogReason(t('productWall.actions.upload'));
        setLoginDialogOpen(true);
        return;
      }
      if (!uploadKind) {
        toast(t('productWall.toasts.noCategoryBeforeUpload'), 'error');
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
            t('productWall.toasts.uploadSkippedDetail', {
              count: oversizedImages.length,
              size: uploadPolicy.productWallImageMaxSizeMb,
              sample,
            }),
            'error',
          );
        } else {
          toast(t('productWall.toasts.unsupportedUpload'), 'error');
        }
        return;
      }
      setUploading(true);
      try {
        let uploadedCount = 0;
        const failedMessages: string[] = [];
        for (let index = 0; index < files.length; index += productWallUploadBatchSize) {
          const batch = files.slice(index, index + productWallUploadBatchSize);
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
            failedMessages.push(errorMessage(error, t('productWall.toasts.uploadFailed')));
          }
        }
        await mutate();
        if (uploadedCount) {
          const skippedText = oversizedImages.length
            ? t('productWall.toasts.uploadSkipped', { count: oversizedImages.length })
            : '';
          const failText = failedMessages.length
            ? t('productWall.toasts.uploadPartialFailed', {
                message: Array.from(new Set(failedMessages)).slice(0, 2).join('; '),
              })
            : '';
          toast(
            isAdmin
              ? t('productWall.toasts.uploadSuccess', {
                  count: uploadedCount,
                  kind: uploadKind,
                  skipped: skippedText,
                  failed: failText,
                })
              : t('productWall.toasts.uploadSubmitted', {
                  count: uploadedCount,
                  skipped: skippedText,
                  failed: failText,
                }),
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
            t('productWall.toasts.uploadSkippedDetail', {
              count: oversizedImages.length,
              size: uploadPolicy.productWallImageMaxSizeMb,
              sample,
            }),
            'error',
          );
        }
      } catch (error) {
        toast(errorMessage(error, t('productWall.toasts.uploadImageFailed')), 'error');
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
        if (folderInputRef.current) folderInputRef.current.value = '';
      }
    },
    [
      canUpload,
      isAdmin,
      mutate,
      productWallMaxImageBytes,
      productWallUploadBatchSize,
      t,
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
      toast(t('productWall.toasts.titleRequired'), 'error');
      return;
    }
    if (!description) {
      toast(t('productWall.toasts.descriptionRequired'), 'error');
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
        toast(t('productWall.toasts.noCategoryBeforeUpload'), 'error');
        return;
      }
      const pastedImages = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'));
      if (pastedImages.length) {
        event.preventDefault();
        handleUploadSource(pastedImages);
        return;
      }
    },
    [canUpload, handleUploadSource, t, uploadKind, toast],
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
    if (window.matchMedia?.('(hover: none) and (pointer: coarse)').matches) return;
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
    setRenderCount(renderBatchSize);
    setWallReady(false);
    setSelectedIds(new Set());
    setWallEditMode(false);
    setSelectionMode(false);
  }, [filter, normalizedQuery, renderBatchSize]);
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
        setRenderCount((count) => Math.min(count + renderBatchSize, visibleItemsLengthRef.current));
      });
    });
  }, [renderBatchSize]);
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
      { rootMargin: loadMoreRootMargin },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMoreVisibleItems, loadMoreRootMargin, wallReady, loadMoreVisibleItems]);
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
      toast(t('productWall.toasts.imageUpdated'), 'success');
    } catch (error) {
      toast(errorMessage(error, t('productWall.toasts.updateFailed')), 'error');
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
        toast(t('productWall.toasts.imageDeleted'), 'success');
      } else {
        const result = await deleteProductWallItems(deleteDialog.ids);
        setSelectedIds(new Set());
        setSelectionMode(false);
        if (active && deleteDialog.ids.includes(active.id)) setActive(null);
        await mutate();
        toast(t('productWall.toasts.batchDeleted', { count: result.deleted }), 'success');
      }
      setDeleteDialog(null);
    } catch (error) {
      toast(
        errorMessage(
          error,
          deleteDialog.type === 'single' ? t('productWall.toasts.deleteFailed') : t('productWall.batchDeleteFailed'),
        ),
        'error',
      );
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
      filter !== PRODUCT_WALL_ALL_FILTER && filter !== PRODUCT_WALL_FAVORITES_FILTER && categoryNames.includes(filter)
        ? (filter as ProductWallKind)
        : PRODUCT_WALL_MANAGEMENT_ALL_FILTER,
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
      toast(t('productWall.toasts.noSelectionToDelete'), 'error');
      return;
    }
    setDeleteDialog({ type: 'batch', ids });
  };
  const reviewItem = async (item: WallItem, input: { status: 'approved' | 'rejected'; rejectReason?: string }) => {
    const rejectReason =
      input.status === 'rejected'
        ? (input.rejectReason ??
          (window.prompt(t('productWall.reviewRejectPrompt'), item.rejectReason || '') || undefined))
        : undefined;
    try {
      const updated = await reviewProductWallItem(item.id, { status: input.status, rejectReason });
      syncUpdatedWallItem(updated);
      toast(
        input.status === 'approved' ? t('productWall.toasts.reviewApproved') : t('productWall.toasts.reviewRejected'),
        'success',
      );
    } catch (error) {
      toast(errorMessage(error, t('productWall.toasts.reviewFailed')), 'error');
    }
  };
  const createCategory = async (rawName: string) => {
    const name = rawName.trim();
    if (!name) {
      toast(t('productWall.toasts.categoryNameRequired'), 'error');
      return;
    }
    try {
      await createProductWallCategory(name);
      await mutateCategories();
      toast(t('productWall.toasts.categoryCreated'), 'success');
    } catch (error) {
      toast(errorMessage(error, t('productWall.toasts.categoryCreateFailed')), 'error');
    }
  };
  const renameCategory = async (id: string, rawName: string) => {
    const name = rawName.trim();
    if (!name) {
      toast(t('productWall.toasts.categoryEmpty'), 'error');
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
      toast(t('productWall.toasts.categoryUpdated'), 'success');
    } catch (error) {
      toast(errorMessage(error, t('productWall.toasts.categoryUpdateFailed')), 'error');
    }
  };
  const removeCategory = async (id: string, name: string) => {
    try {
      await deleteProductWallCategory(id);
      setDeleteCategoryTarget(null);
      if (filter === name) setFilter(PRODUCT_WALL_ALL_FILTER);
      if (managementKindFilter === name) setManagementKindFilter(PRODUCT_WALL_MANAGEMENT_ALL_FILTER);
      await mutateCategories();
      toast(t('productWall.toasts.categoryDeleted'), 'success');
    } catch (error) {
      toast(errorMessage(error, t('productWall.toasts.categoryDeleteFailed')), 'error');
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
    <AdminPageShell
      desktopContentClassName="app-public-tool-shell app-product-wall-shell p-6"
      mobileContentClassName="px-4 py-4 pb-20"
    >
      <div className="relative" onPaste={handlePaste}>
        <AdminManagementPage
          title={t('productWall.title')}
          meta={initialLoading ? t('productWall.loading') : undefined}
          description={t('productWall.description')}
          actions={headerActions}
          className="app-public-tool-page app-public-tool-page-product-wall"
          toolbar={
            <div className="product-wall-toolbar grid min-h-11 items-center gap-3 md:grid-cols-[minmax(0,1fr)_18rem]">
              <ResponsiveSectionTabs
                tabs={filters.map((item) => ({
                  value: item,
                  label:
                    item === PRODUCT_WALL_ALL_FILTER
                      ? t('productWall.filters.all')
                      : item === PRODUCT_WALL_FAVORITES_FILTER
                        ? t('productWall.filters.favorites')
                        : item,
                  count: filterCounts[item] || 0,
                  icon:
                    item === PRODUCT_WALL_ALL_FILTER
                      ? 'grid_view'
                      : item === PRODUCT_WALL_FAVORITES_FILTER
                        ? 'favorite'
                        : 'image',
                }))}
                value={filter}
                onChange={setFilter}
                mobileTitle={t('productWall.currentCategory')}
                countUnit={t('productWall.countUnit')}
              />
              <SearchField
                inputProps={queryInputProps}
                value={queryInputValue}
                onClear={() => setQuery('')}
                placeholder={t('productWall.searchPlaceholder')}
                className="product-wall-search md:ml-auto md:w-72"
              />
            </div>
          }
          contentClassName="overflow-visible"
        >
          {dragActive && (
            <div className="mb-4 flex h-10 items-center justify-center border-y border-primary-container/35 bg-primary-container/6 text-sm font-medium text-primary-container">
              {t('productWall.dragReleaseUpload')}
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
                            <ProductWallThumbnail
                              item={item}
                              canvasMode={canvasMode}
                              imageIndex={imageIndex}
                              eagerImageCount={eagerImageCount}
                              lazyRootMargin={thumbnailLazyRootMargin}
                            >
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
                                aria-label={
                                  itemFavorited ? t('productWall.aria.unfavorite') : t('productWall.aria.favoriteImage')
                                }
                                title={
                                  itemFavorited
                                    ? t('productWall.preview.unfavorite')
                                    : t('productWall.preview.favorite')
                                }
                                data-tooltip-ignore
                              >
                                <Icon name={itemFavorited ? 'favorite' : 'star'} size={14} />
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void downloadProductWallItem(item);
                                }}
                                className="product-wall-card-action"
                                aria-label={t('productWall.aria.downloadImage')}
                                title={t('productWall.preview.download')}
                                data-tooltip-ignore
                              >
                                <Icon name="download" size={14} />
                              </button>
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
                                aria-label={t('productWall.aria.editImage')}
                                title={t('productWall.actions.edit')}
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
                                aria-label={t('productWall.aria.deleteImage')}
                                title={t('common.delete')}
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
                  {t('productWall.loadMore')}
                  <span
                    className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-on-surface-variant/50"
                    style={{ animationDelay: '0.3s' }}
                  />
                </button>
              ) : visibleItems.length > renderBatchSize ? (
                <div className="flex h-12 w-full items-center justify-center text-xs text-on-surface-variant/40">
                  {t('productWall.reachedEnd')}
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
                    ? t('productWall.empty.loadFailed')
                    : isFavoritesFilter
                      ? t('productWall.empty.favoritesTitle')
                      : canUpload
                        ? t('productWall.empty.categoryEmpty')
                        : t('productWall.empty.noGallery')}
                </h2>
                <p className="mt-2 text-sm leading-6 text-on-surface-variant">
                  {apiError
                    ? errorMessage(apiError, t('productWall.empty.apiErrorDescription'))
                    : isFavoritesFilter
                      ? isLoggedIn
                        ? t('productWall.empty.favoritesLoggedIn')
                        : t('productWall.empty.favoritesLogin')
                      : canUpload
                        ? uploadKind
                          ? t('productWall.empty.uploadHint', { kind: uploadKind })
                          : t('productWall.empty.noCategoryUpload')
                        : t('productWall.empty.publicEmpty')}
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
            if (category) setDeleteCategoryTarget({ id, name: category.name });
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
      <ConfirmDialog
        open={Boolean(deleteCategoryTarget)}
        onClose={() => setDeleteCategoryTarget(null)}
        onConfirm={() => {
          if (deleteCategoryTarget) void removeCategory(deleteCategoryTarget.id, deleteCategoryTarget.name);
        }}
        title={t('productWall.categoryDeleteTitle')}
        description={t('productWall.categoryDeleteConfirm', { name: deleteCategoryTarget?.name || '' })}
        confirmLabel={t('common.confirm')}
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
          onDownload={(item) => void downloadProductWallItem(item)}
        />
      )}
      <LoginConfirmDialog open={loginDialogOpen} onClose={() => setLoginDialogOpen(false)} reason={loginDialogReason} />
    </AdminPageShell>
  );
}
