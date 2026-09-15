import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { mutate as mutateSWR } from 'swr';
import useSWRInfinite from 'swr/infinite';
import type { ProductWallCategory, ProductWallItem, ProductWallKind } from '../api/productWall';
import { listAdminProductWallCategories } from '../api/productWall';
import {
  createProductWallCategory,
  deleteProductWallCategory,
  deleteProductWallItem,
  deleteProductWallItems,
  listAdminProductWallItems,
  purgeProductWallItems,
  restoreProductWallItems,
  updateProductWallItemsKind,
  reviewProductWallItem,
  updateProductWallCategory,
  updateProductWallItem,
  type ProductWallAdminListResponse,
  type ProductWallAdminStatusFilter,
} from '../api/productWall';
import {
  errorMessage,
  productWallDownloadName,
  PRODUCT_WALL_CANVAS_MODE_KEY,
  PRODUCT_WALL_DEFAULT_KIND_KEY,
  type ProductWallCanvasMode,
} from '../components/product-wall-admin/productWallAdminUtils';
import CategoryFilterDropdown from '../components/product-wall-admin/CategoryFilterDropdown';
import {
  ProductWallDeleteDialog,
  type DeleteDialogState,
} from '../components/product-wall-admin/ProductWallDeleteDialog';
import { ProductWallEditDialog } from '../components/product-wall-admin/ProductWallEditDialog';
import { ProductWallPreview } from '../components/product-wall-admin/ProductWallPreview';
import { ProductWallThumbnail } from '../components/product-wall-admin/ProductWallThumbnail';
import { ProductWallUploadModal } from '../components/product-wall-admin/ProductWallUploadModal';
import { AdminButton } from '../components/shared/AdminControls';
import { AdminManagementPage } from '../components/shared/AdminManagementPage';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import DialogOverlay from '../components/shared/DialogOverlay';
import Icon from '../components/shared/Icon';
import { PageRefreshIndicator } from '../components/shared/PageRefreshFallback';
import ResponsiveSectionTabs from '../components/shared/ResponsiveSectionTabs';
import SearchField from '../components/shared/SearchField';
import { useToast } from '../components/shared/Toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useImeSafeSearchInput } from '../hooks/useImeSafeSearchInput';
import { downloadBrowserFile } from '../lib/browserDownload';
const MANAGEMENT_ALL = '__all__';
const MANAGEMENT_DEFAULT_PAGE_SIZE = 40;
const MANAGEMENT_EAGER_IMAGE_COUNT = 8;

const STATUS_TABS: { value: ProductWallAdminStatusFilter; labelKey: string; icon: string }[] = [
  { value: 'all', labelKey: 'productWall.management.statusAll', icon: 'apps' },
  { value: 'pending', labelKey: 'productWall.management.statusPending', icon: 'schedule' },
  { value: 'approved', labelKey: 'productWall.management.statusApproved', icon: 'check_circle' },
  { value: 'rejected', labelKey: 'productWall.management.statusRejected', icon: 'block' },
  { value: 'trash', labelKey: 'productWall.management.statusTrash', icon: 'delete' },
];

const STATUS_BADGE_CLASSES: Record<string, string> = {
  approved: 'bg-emerald-500/12 text-emerald-500 dark:text-emerald-400',
  pending: 'bg-amber-500/12 text-amber-600 dark:text-amber-400',
  rejected: 'bg-error-container/20 text-error',
};

type CategoryDialogState = { mode: 'create' } | { mode: 'rename'; id: string; name: string } | null;

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const labelKey =
    status === 'approved'
      ? 'productWall.management.statusApproved'
      : status === 'pending'
        ? 'productWall.management.statusPending'
        : 'productWall.management.statusRejected';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE_CLASSES[status] || 'bg-surface-container-high text-on-surface-variant'}`}
    >
      {t(labelKey)}
    </span>
  );
}

export default function ProductWallAdminPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('nav.admin.productWall'));
  const { toast } = useToast();
  const [status, setStatus] = useState<ProductWallAdminStatusFilter>('all');
  const [kind, setKind] = useState<ProductWallKind | typeof MANAGEMENT_ALL>(MANAGEMENT_ALL);
  const {
    value: committedQuery,
    draftValue: queryInputValue,
    setValue: setQueryInput,
    inputProps: queryInputProps,
  } = useImeSafeSearchInput();
  const { data: categoriesData, mutate: mutateCategories } = useSWR(
    'admin-product-wall-categories',
    listAdminProductWallCategories,
  );
  const categories = useMemo<ProductWallCategory[]>(() => categoriesData ?? [], [categoriesData]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [defaultUploadKind] = useState<ProductWallKind>(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(PRODUCT_WALL_DEFAULT_KIND_KEY) || '';
  });
  const [canvasMode] = useState<ProductWallCanvasMode>(() => {
    if (typeof window === 'undefined') return 'white';
    const saved = window.localStorage.getItem(PRODUCT_WALL_CANVAS_MODE_KEY);
    return saved === 'checker' ? 'checker' : 'white';
  });

  // 无限滚动（前台墙同款）：按需逐页加载，滚动到底自动拉下一页
  const pageSize = MANAGEMENT_DEFAULT_PAGE_SIZE;
  const {
    data: pages,
    error,
    isLoading,
    mutate: mutateList,
    size,
    setSize,
  } = useSWRInfinite(
    (pageIndex: number, previousPage: ProductWallAdminListResponse | null) => {
      if (previousPage && previousPage.items.length < pageSize) return null;
      return `admin-product-wall-page?p=${pageIndex + 1}&st=${status}&k=${kind}&q=${committedQuery}`;
    },
    (key: string) => {
      const params = new URLSearchParams(key.split('?')[1] || '');
      return listAdminProductWallItems({
        page: Number(params.get('p')) || 1,
        pageSize,
        status,
        kind: kind === MANAGEMENT_ALL ? undefined : kind,
        q: committedQuery || undefined,
      });
    },
    // 翻页/聚焦不重校验已加载页（变更都通过 mutateList() 显式刷新）
    { revalidateFirstPage: false, revalidateOnFocus: false },
  );

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [moveTargetKind, setMoveTargetKind] = useState('');
  const [movingKind, setMovingKind] = useState(false);

  // 换筛选条件时新 key 无缓存，useSWRInfinite 会瞬时清空列表 → 内容塌陷、主滚动条
  // 出现/消失把 tabs 整条左右拉伸；沿用上一份成功数据（stale-while-revalidate）消除闪烁
  const lastPagesRef = useRef<ProductWallAdminListResponse[] | null>(null);
  useEffect(() => {
    if (pages && pages.length) lastPagesRef.current = pages;
  }, [pages]);
  const displayPages = pages && pages.length ? pages : lastPagesRef.current;
  const showingStaleList = isLoading && displayPages !== pages && Boolean(displayPages);
  const items = useMemo(() => displayPages?.flatMap((page) => page.items) ?? [], [displayPages]);
  const counts = displayPages?.[0]?.counts;
  const total = displayPages?.[0]?.total ?? 0;
  const hasMorePages = items.length < total;

  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // 滚动哨兵：接近视口底部自动加载下一页（页面级滚动，与前台一致）
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMorePages) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        if (!isLoading) void setSize(size + 1);
      },
      { rootMargin: '480px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMorePages, isLoading, size, setSize]);

  // 切换筛选/搜索条件后回到第一页（useSWRInfinite 换 key 不会自动重置 size；仅条件真实变化时触发）
  const lastQueryKeyRef = useRef(`${status}|${kind}|${committedQuery}`);
  useEffect(() => {
    const nextKey = `${status}|${kind}|${committedQuery}`;
    if (lastQueryKeyRef.current === nextKey) return;
    lastQueryKeyRef.current = nextKey;
    setSize(1);
  }, [status, kind, committedQuery, setSize]);

  // ── 操作状态 ──
  const [previewItem, setPreviewItem] = useState<ProductWallItem | null>(null);
  const [rejectTarget, setRejectTarget] = useState<ProductWallItem | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [editingItem, setEditingItem] = useState<ProductWallItem | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editKind, setEditKind] = useState<ProductWallKind>('');
  const [editTags, setEditTags] = useState('');
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState>(null);
  const [deleting, setDeleting] = useState(false);
  const [categoryDialog, setCategoryDialog] = useState<CategoryDialogState>(null);
  const [categoryNameDraft, setCategoryNameDraft] = useState('');
  const [categorySubmitting, setCategorySubmitting] = useState(false);
  const [deleteCategoryTarget, setDeleteCategoryTarget] = useState<{ id: string; name: string } | null>(null);

  const categoryNames = useMemo(() => categories.map((item) => item.name).filter(Boolean), [categories]);
  // 手机端分类管理弹层（桌面端用左侧栏的管理分类模式）
  const [categorySheetOpen, setCategorySheetOpen] = useState(false);

  // Esc 关闭大图预览
  useEffect(() => {
    if (!previewItem) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreviewItem(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [previewItem]);

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

  const refreshAfterChange = async () => {
    await mutateList();
    // 前台 tab 计数即时刷新；墙列表由前台页面重新挂载时的 SWR revalidate 更新
    void mutateSWR('product-wall-counts');
  };

  const reviewItem = async (item: ProductWallItem, nextStatus: 'approved' | 'rejected', reason?: string) => {
    try {
      await reviewProductWallItem(item.id, { status: nextStatus, rejectReason: reason });
      toast(
        nextStatus === 'approved' ? t('productWall.toasts.reviewApproved') : t('productWall.toasts.reviewRejected'),
        'success',
      );
      await refreshAfterChange();
    } catch (err) {
      toast(errorMessage(err, t('productWall.toasts.reviewFailed')), 'error');
    }
  };

  const openEditItem = (item: ProductWallItem) => {
    setEditingItem(item);
    setEditTitle(item.title);
    setEditDescription(item.description || '');
    setEditKind(item.kind);
    setEditTags(item.tags.join('，'));
  };

  const saveEditingItem = async () => {
    if (!editingItem) return;
    try {
      await updateProductWallItem(editingItem.id, {
        title: editTitle,
        description: editDescription,
        tags: editTags,
        kind: editKind,
      });
      setEditingItem(null);
      toast(t('productWall.toasts.imageUpdated'), 'success');
      await refreshAfterChange();
    } catch (err) {
      toast(errorMessage(err, t('productWall.toasts.updateFailed')), 'error');
    }
  };

  const toggleSelectedItem = (item: ProductWallItem) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  };
  const selectAllPage = () => {
    setSelectionMode(true);
    setSelectedIds(new Set(items.map((item) => item.id)));
  };
  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };
  const removeSelectedItems = () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) {
      toast(t('productWall.toasts.noSelectionToDelete'), 'error');
      return;
    }
    setDeleteDialog({ type: 'batch', ids });
  };
  const confirmMoveKind = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length || !moveTargetKind) return;
    setMovingKind(true);
    try {
      const result = await updateProductWallItemsKind(ids, moveTargetKind);
      toast(t('productWall.management.moveKindSuccess', { count: result.updated, kind: result.kind }), 'success');
      setMoveDialogOpen(false);
      exitSelectionMode();
      await refreshAfterChange();
    } catch (err) {
      toast(errorMessage(err, t('productWall.management.moveKindFailed')), 'error');
    } finally {
      setMovingKind(false);
    }
  };

  const restoreItem = async (item: ProductWallItem) => {
    try {
      await restoreProductWallItems([item.id]);
      toast(t('productWall.toasts.restored'), 'success');
      await refreshAfterChange();
    } catch (err) {
      toast(errorMessage(err, t('productWall.toasts.restoreFailed')), 'error');
    }
  };
  const purgeItem = async (item: ProductWallItem) => {
    try {
      await purgeProductWallItems([item.id]);
      toast(t('productWall.toasts.purged'), 'success');
      await refreshAfterChange();
    } catch (err) {
      toast(errorMessage(err, t('productWall.toasts.purgeFailed')), 'error');
    }
  };
  const confirmDelete = async () => {
    if (!deleteDialog) return;
    setDeleting(true);
    try {
      if (deleteDialog.type === 'single') {
        await deleteProductWallItem(deleteDialog.item.id);
      } else {
        await deleteProductWallItems(deleteDialog.ids);
        setSelectedIds(new Set());
        setSelectionMode(false);
      }
      toast(t('productWall.toasts.imageDeleted'), 'success');
      setDeleteDialog(null);
      await refreshAfterChange();
    } catch (err) {
      toast(errorMessage(err, t('productWall.toasts.deleteFailed')), 'error');
    } finally {
      setDeleting(false);
    }
  };

  const submitCategoryDialog = async () => {
    if (!categoryDialog) return;
    const name = categoryNameDraft.trim();
    if (!name) {
      toast(t('productWall.toasts.categoryNameRequired'), 'error');
      return;
    }
    setCategorySubmitting(true);
    try {
      if (categoryDialog.mode === 'create') {
        await createProductWallCategory(name);
        toast(t('productWall.toasts.categoryCreated'), 'success');
      } else {
        await updateProductWallCategory(categoryDialog.id, { name });
        if (kind === categoryDialog.name) setKind(name);
        toast(t('productWall.toasts.categoryUpdated'), 'success');
      }
      setCategoryDialog(null);
      await mutateCategories();
      void mutateSWR('product-wall-counts');
    } catch (err) {
      toast(
        errorMessage(
          err,
          categoryDialog.mode === 'create'
            ? t('productWall.toasts.categoryCreateFailed')
            : t('productWall.toasts.categoryUpdateFailed'),
        ),
        'error',
      );
    } finally {
      setCategorySubmitting(false);
    }
  };

  const removeCategory = async () => {
    if (!deleteCategoryTarget) return;
    try {
      await deleteProductWallCategory(deleteCategoryTarget.id);
      if (kind === deleteCategoryTarget.name) setKind(MANAGEMENT_ALL);
      setDeleteCategoryTarget(null);
      toast(t('productWall.toasts.categoryDeleted'), 'success');
      await mutateCategories();
      await mutateList();
      void mutateSWR('product-wall-counts');
    } catch (err) {
      toast(errorMessage(err, t('productWall.toasts.categoryDeleteFailed')), 'error');
    }
  };

  const isLoadingFirstPage = isLoading && !displayPages;
  const emptyHintKey =
    status === 'pending'
      ? 'productWall.management.emptyPendingDescription'
      : status === 'rejected'
        ? 'productWall.management.emptyRejectedDescription'
        : 'productWall.management.emptyDescription';
  return (
    <AdminPageShell>
      <AdminManagementPage
        title={t('productWall.management.title')}
        meta={t('productWall.management.metaTotal', { count: counts?.all ?? total })}
        description={t('productWall.management.pageDescription')}
        toolbarSticky
        actions={
          <div className="flex items-center gap-1.5">
            <AdminButton variant="primary" onClick={() => setUploadOpen(true)} icon="cloud_upload">
              {t('productWall.actions.upload')}
            </AdminButton>
          </div>
        }
        toolbar={
          <div className="flex min-h-10 min-w-0 flex-col gap-3 md:flex-row md:items-center">
            <div className="min-w-0 flex-1">
              <ResponsiveSectionTabs
                tabs={STATUS_TABS.map((tab) => ({
                  value: tab.value,
                  label: t(tab.labelKey),
                  icon: tab.icon,
                  count: counts ? counts[tab.value] : undefined,
                }))}
                value={status}
                onChange={(value) => {
                  setStatus(value as ProductWallAdminStatusFilter);
                  if (value === 'trash') exitSelectionMode();
                }}
                mobileTitle={t('productWall.management.statusTitle')}
                countPrefixText=""
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SearchField
                inputProps={queryInputProps}
                value={queryInputValue}
                onClear={() => setQueryInput('')}
                placeholder={t('productWall.management.searchPlaceholder')}
                className="min-w-[140px] flex-1 md:w-56 md:flex-none md:shrink-0"
              />
              <CategoryFilterDropdown
                categories={categories}
                value={kind}
                allValue={MANAGEMENT_ALL}
                allLabel={t('productWall.management.allCategories')}
                onChange={(next) => setKind(next as ProductWallKind | typeof MANAGEMENT_ALL)}
                ariaLabel={t('productWall.currentCategory')}
              />
              {status !== 'trash' && (
                <AdminButton
                  onClick={() => (selectionMode ? exitSelectionMode() : setSelectionMode(true))}
                  active={selectionMode}
                  icon={selectionMode ? 'close' : 'checklist'}
                  title={selectionMode ? t('productWall.actions.exitBatch') : t('productWall.management.batchSelect')}
                >
                  <span className="hidden sm:inline">
                    {selectionMode ? t('productWall.actions.exitBatch') : t('productWall.management.batchSelect')}
                  </span>
                </AdminButton>
              )}
              <AdminButton
                onClick={() => setCategorySheetOpen(true)}
                icon="category"
                aria-label={t('productWall.management.manageCategories')}
                title={t('productWall.management.manageCategories')}
              >
                <span className="hidden sm:inline">{t('productWall.management.manageCategories')}</span>
              </AdminButton>
            </div>
          </div>
        }
      >
        <div className="flex flex-col">
          {/* 图片网格（服务端分页） */}
          <div className="flex-1">
            {error && !displayPages ? (
              <div className="flex h-full min-h-[280px] flex-col items-center justify-center text-center">
                <Icon name="warning" size={34} className="mb-3 text-on-surface-variant/40" />
                <p className="text-sm font-medium text-on-surface">{t('productWall.management.loadFailed')}</p>
                <button
                  type="button"
                  onClick={() => void mutateList()}
                  className="mt-3 inline-flex h-8 items-center rounded-md border border-outline-variant/24 px-3 text-xs font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high"
                >
                  {t('productWall.management.retry')}
                </button>
              </div>
            ) : isLoadingFirstPage ? (
              <div className="flex h-full min-h-[280px] w-full items-center justify-center">
                <PageRefreshIndicator />
              </div>
            ) : items.length > 0 ? (
              <div
                className={`product-wall-management-grid grid grid-cols-2 gap-2.5 transition-opacity sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 ${
                  showingStaleList ? 'opacity-60' : 'opacity-100'
                }`}
              >
                {items.map((item, index) => (
                  <article
                    key={item.id}
                    className="group relative overflow-hidden rounded-lg border border-outline-variant/12 bg-surface-container-low/50 transition-colors hover:border-outline-variant/24"
                  >
                    <button
                      type="button"
                      onClick={() => (selectionMode ? toggleSelectedItem(item) : setPreviewItem(item))}
                      className={`block w-full text-left transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-container/35 ${
                        selectionMode ? 'cursor-pointer' : 'cursor-zoom-in hover:opacity-90'
                      }`}
                      aria-label={
                        selectionMode ? t('productWall.selectionBar.selected', { count: 1 }) : t('common.preview')
                      }
                      title={selectionMode ? undefined : t('common.preview')}
                      data-tooltip-ignore
                    >
                      <ProductWallThumbnail
                        item={item}
                        canvasMode={canvasMode}
                        imageIndex={index}
                        eagerImageCount={MANAGEMENT_EAGER_IMAGE_COUNT}
                        lazyRootMargin="360px 0px"
                        ratioOverride={1}
                      >
                        {item.status === 'pending' && (
                          <span className="absolute left-2 top-2 z-10 inline-flex items-center gap-1 rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
                            <Icon name="schedule" size={11} />
                            {t('productWall.management.statusPending')}
                          </span>
                        )}
                        {selectionMode && (
                          <span
                            className={`absolute right-2 top-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full border shadow-sm backdrop-blur transition-colors ${
                              selectedIds.has(item.id)
                                ? 'border-primary-container bg-primary-container text-on-primary-container'
                                : 'border-white/50 bg-black/24 text-white'
                            }`}
                          >
                            <Icon name={selectedIds.has(item.id) ? 'check' : 'add'} size={16} />
                          </span>
                        )}
                      </ProductWallThumbnail>
                    </button>
                    <div className="p-2.5">
                      <p className="truncate text-xs font-medium text-on-surface" title={item.title}>
                        {item.title}
                      </p>
                      <p className="mt-0.5 truncate text-[10px] text-on-surface-variant">
                        {item.description || item.kind}
                      </p>
                      <div className="mt-1.5 flex items-center justify-between gap-1">
                        <StatusBadge status={item.status} />
                        <div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                          {status === 'trash' ? (
                            <>
                              <button
                                type="button"
                                onClick={() => void restoreItem(item)}
                                className="flex h-6 w-6 items-center justify-center rounded text-primary-container transition-colors hover:bg-primary-container/15"
                                aria-label={t('productWall.management.restore')}
                                title={t('productWall.management.restore')}
                                data-tooltip-ignore
                              >
                                <Icon name="restore" size={13} />
                              </button>
                              <button
                                type="button"
                                onClick={() => void purgeItem(item)}
                                className="flex h-6 w-6 items-center justify-center rounded text-error transition-colors hover:bg-error-container/25"
                                aria-label={t('productWall.management.purge')}
                                title={t('productWall.management.purge')}
                                data-tooltip-ignore
                              >
                                <Icon name="delete_sweep" size={13} />
                              </button>
                            </>
                          ) : item.status === 'pending' ? (
                            <>
                              <button
                                type="button"
                                onClick={() => void reviewItem(item, 'approved')}
                                className="flex h-6 w-6 items-center justify-center rounded text-emerald-600 transition-colors hover:bg-emerald-500/10"
                                aria-label={t('productWall.management.approve')}
                                title={t('productWall.management.approve')}
                                data-tooltip-ignore
                              >
                                <Icon name="check" size={13} />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setRejectReason(item.rejectReason || '');
                                  setRejectTarget(item);
                                }}
                                className="flex h-6 w-6 items-center justify-center rounded text-error transition-colors hover:bg-error-container/25"
                                aria-label={t('productWall.management.reject')}
                                title={t('productWall.management.reject')}
                                data-tooltip-ignore
                              >
                                <Icon name="close" size={13} />
                              </button>
                              <button
                                type="button"
                                onClick={() => openEditItem(item)}
                                className="flex h-6 w-6 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
                                aria-label={t('productWall.actions.edit')}
                                title={t('productWall.actions.edit')}
                                data-tooltip-ignore
                              >
                                <Icon name="edit" size={13} />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteDialog({ type: 'single', item })}
                                className="flex h-6 w-6 items-center justify-center rounded text-error transition-colors hover:bg-error-container/25"
                                aria-label={t('common.delete')}
                                title={t('common.delete')}
                                data-tooltip-ignore
                              >
                                <Icon name="delete" size={13} />
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => openEditItem(item)}
                                className="flex h-6 w-6 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
                                aria-label={t('productWall.actions.edit')}
                                title={t('productWall.actions.edit')}
                                data-tooltip-ignore
                              >
                                <Icon name="edit" size={13} />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteDialog({ type: 'single', item })}
                                className="flex h-6 w-6 items-center justify-center rounded text-error transition-colors hover:bg-error-container/25"
                                aria-label={t('common.delete')}
                                title={t('common.delete')}
                                data-tooltip-ignore
                              >
                                <Icon name="delete" size={13} />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="flex h-full min-h-[280px] flex-col items-center justify-center text-center text-on-surface-variant">
                <Icon name="image" size={36} className="mb-3 opacity-45" />
                <p className="text-sm font-medium text-on-surface">{t('productWall.management.emptyTitle')}</p>
                <p className="mt-1 text-xs">{t(emptyHintKey)}</p>
              </div>
            )}
          </div>

          {/* 选择模式操作条：吸底悬浮（不滚到底也能看到）——已选数量 + 全选本页 + 批量操作 + 退出 */}
          {selectionMode && (
            <div className="pointer-events-none sticky bottom-[4.5rem] z-20 mt-3 md:bottom-4">
              <div className="pointer-events-auto mx-auto flex w-fit max-w-[calc(100vw-2.5rem)] flex-wrap items-center justify-center gap-1 rounded-2xl border border-outline-variant/22 bg-surface/95 py-1.5 pl-3 pr-1.5 shadow-panel backdrop-blur-md sm:gap-1.5">
                <span className="text-xs font-medium text-on-surface">
                  {t('productWall.selectionBar.selected', { count: selectedIds.size })}
                </span>
                <span className="mx-0.5 h-4 w-px bg-outline-variant/20" />
                <button
                  type="button"
                  onClick={selectAllPage}
                  disabled={!items.length}
                  className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:opacity-40"
                >
                  <Icon name="select_all" size={13} />
                  {t('productWall.actions.selectCurrent')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMoveTargetKind(kind === MANAGEMENT_ALL ? '' : kind);
                    setMoveDialogOpen(true);
                  }}
                  disabled={!selectedIds.size}
                  className="inline-flex h-7 items-center gap-1 rounded-full bg-primary-container/15 px-2.5 text-xs font-semibold text-primary-container transition-colors hover:bg-primary-container/30 disabled:opacity-40"
                >
                  <Icon name="drive_file_move" size={13} />
                  {t('productWall.selectionBar.moveKind')}
                </button>
                <button
                  type="button"
                  onClick={removeSelectedItems}
                  disabled={!selectedIds.size}
                  className="inline-flex h-7 items-center gap-1 rounded-full bg-error-container/40 px-2.5 text-xs font-semibold text-error transition-colors hover:bg-error-container/70 disabled:opacity-40"
                >
                  <Icon name="delete" size={13} />
                  {t('productWall.selectionBar.deleteSelected', { count: selectedIds.size })}
                </button>
                <span className="mx-0.5 h-4 w-px bg-outline-variant/20" />
                <button
                  type="button"
                  onClick={exitSelectionMode}
                  className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
                >
                  <Icon name="close" size={13} />
                  {t('productWall.actions.exitBatch')}
                </button>
              </div>
            </div>
          )}

          {/* 无限滚动：滚动接近底部静默加载下一页，无文案指示 */}
          {hasMorePages && <div ref={sentinelRef} className="h-1 w-full" />}
        </div>
      </AdminManagementPage>

      {/* 拒绝原因对话框 */}
      {moveDialogOpen && selectionMode && (
        <DialogOverlay
          onClose={() => setMoveDialogOpen(false)}
          zIndex={10000}
          backdropClassName="bg-black/35 backdrop-blur-sm"
          animated={false}
          className="px-4 py-6"
        >
          <form
            className="w-full max-w-sm rounded-sm border border-outline-variant/18 bg-surface p-5 shadow-modal"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              void confirmMoveKind();
            }}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold tracking-[0.18em] text-primary-container">MOVE</p>
                <h2 className="mt-1 text-lg font-bold text-on-surface">{t('productWall.management.moveKindTitle')}</h2>
                <p className="mt-1 text-xs text-on-surface-variant">
                  {t('productWall.selectionBar.selected', { count: selectedIds.size })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMoveDialogOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
                aria-label={t('common.close')}
                data-tooltip-ignore
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {categoryNames.map((name) => {
                const active = moveTargetKind === name;
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setMoveTargetKind(name)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                      active
                        ? 'border-primary-container/35 bg-primary-container/20 text-primary-container'
                        : 'border-outline-variant/12 bg-surface-container-highest/20 text-on-surface-variant hover:bg-surface-container-high'
                    }`}
                  >
                    <Icon name={active ? 'check_circle' : 'folder'} size={14} />
                    {name}
                  </button>
                );
              })}
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setMoveDialogOpen(false)}
                className="inline-flex h-9 items-center justify-center rounded-sm px-3 text-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                disabled={!moveTargetKind || movingKind || !selectedIds.size}
                className="inline-flex h-9 items-center justify-center rounded-sm bg-primary-container px-4 text-sm font-semibold text-on-primary-container transition-colors hover:bg-primary-container/90 disabled:opacity-50"
              >
                {movingKind ? t('common.loading') : t('productWall.management.moveKindConfirm')}
              </button>
            </div>
          </form>
        </DialogOverlay>
      )}

      {rejectTarget && (
        <DialogOverlay
          onClose={() => setRejectTarget(null)}
          zIndex={10000}
          backdropClassName="bg-black/35 backdrop-blur-sm"
          animated={false}
          className="px-4 py-6"
        >
          <form
            className="w-full max-w-md rounded-sm border border-outline-variant/18 bg-surface p-5 shadow-modal"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              const reason = rejectReason.trim();
              if (!reason) {
                toast(t('productWall.management.rejectReasonRequired'), 'error');
                return;
              }
              const target = rejectTarget;
              setRejectTarget(null);
              void reviewItem(target, 'rejected', reason);
            }}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold tracking-[0.18em] text-error">REVIEW</p>
                <h2 className="mt-1 text-lg font-bold text-on-surface">{t('productWall.management.rejectTitle')}</h2>
                <p className="mt-1 truncate text-xs text-on-surface-variant">{rejectTarget.title}</p>
              </div>
              <button
                type="button"
                onClick={() => setRejectTarget(null)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
                aria-label={t('common.close')}
                data-tooltip-ignore
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <label className="block">
              <span className="text-xs font-medium text-on-surface-variant">
                {t('productWall.management.rejectReasonLabel')}
              </span>
              <textarea
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
                rows={3}
                autoFocus
                className="mt-1 w-full resize-none border-b border-outline-variant/35 bg-transparent py-2 text-sm text-on-surface outline-none transition-colors focus:border-primary-container"
                placeholder={t('productWall.management.rejectReasonPlaceholder')}
              />
            </label>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setRejectTarget(null)}
                className="inline-flex h-9 items-center justify-center rounded-sm px-3 text-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                className="inline-flex h-9 items-center justify-center rounded-sm bg-primary-container px-4 text-sm font-semibold text-on-primary-container transition-colors hover:bg-primary-container/90"
              >
                {t('productWall.management.rejectConfirm')}
              </button>
            </div>
          </form>
        </DialogOverlay>
      )}

      {/* 分类新建/重命名对话框 */}
      {categoryDialog && (
        <DialogOverlay
          onClose={() => setCategoryDialog(null)}
          zIndex={10000}
          backdropClassName="bg-black/35 backdrop-blur-sm"
          animated={false}
          className="px-4 py-6"
        >
          <form
            className="w-full max-w-sm rounded-sm border border-outline-variant/18 bg-surface p-5 shadow-modal"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              void submitCategoryDialog();
            }}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold tracking-[0.18em] text-primary-container">CATEGORY</p>
                <h2 className="mt-1 text-lg font-bold text-on-surface">
                  {categoryDialog.mode === 'create'
                    ? t('productWall.management.categoryCreateTitle')
                    : t('productWall.management.categoryRenameTitle')}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setCategoryDialog(null)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
                aria-label={t('common.close')}
                data-tooltip-ignore
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <label className="block">
              <span className="text-xs font-medium text-on-surface-variant">
                {t('productWall.management.categoryNameLabel')}
              </span>
              <input
                value={categoryNameDraft}
                onChange={(event) => setCategoryNameDraft(event.target.value)}
                autoFocus
                maxLength={40}
                className="mt-1 h-10 w-full border-b border-outline-variant/35 bg-transparent text-sm text-on-surface outline-none transition-colors focus:border-primary-container"
                placeholder={t('productWall.management.categoryNamePlaceholder')}
              />
            </label>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setCategoryDialog(null)}
                className="inline-flex h-9 items-center justify-center rounded-sm px-3 text-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                disabled={categorySubmitting}
                className="inline-flex h-9 items-center justify-center rounded-sm bg-primary-container px-4 text-sm font-semibold text-on-primary-container transition-colors hover:bg-primary-container/90 disabled:opacity-50"
              >
                {t('common.confirm')}
              </button>
            </div>
          </form>
        </DialogOverlay>
      )}

      {/* 编辑图片 */}
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

      {/* 分类管理弹层：点击筛选 + 重命名/删除/添加（标题区入口） */}
      {categorySheetOpen && (
        <DialogOverlay
          onClose={() => setCategorySheetOpen(false)}
          zIndex={10000}
          bottomOnMobile
          animated={false}
          className="px-3 py-4 md:px-6 md:py-6"
        >
          <div
            className="flex max-h-[80dvh] w-full flex-col overflow-hidden rounded-t-xl border border-outline-variant/16 bg-surface shadow-heavy sm:max-w-md sm:rounded-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-outline-variant/12 px-5 py-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold tracking-[0.18em] text-primary-container">CATEGORY</p>
                <h2 className="mt-1 text-lg font-bold text-on-surface">
                  {t('productWall.management.manageCategories')}
                </h2>
                <p className="mt-1 text-xs text-on-surface-variant">
                  {categories.length
                    ? t('productWall.management.categorySheetHint', { count: categories.length })
                    : t('productWall.management.noCategoriesHint')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCategorySheetOpen(false)}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
                aria-label={t('common.close')}
                data-tooltip-ignore
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <div className="flex-1 space-y-1 overflow-y-auto p-3 custom-scrollbar">
              {categories.map((category) => {
                const active = kind === category.name;
                return (
                  <div
                    key={category.id}
                    className={`flex items-center gap-1 rounded-lg border transition-colors ${
                      active
                        ? 'border-primary-container/30 bg-primary-container/8'
                        : 'border-transparent hover:bg-surface-container-high/50'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setKind(category.name);
                        setCategorySheetOpen(false);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-2 pl-2.5 pr-1 text-left"
                      title={category.name}
                    >
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                          active
                            ? 'bg-primary-container/15 text-primary-container'
                            : 'bg-surface-container-high/70 text-on-surface-variant'
                        }`}
                      >
                        <Icon name="folder" size={16} />
                      </span>
                      <span
                        className={`min-w-0 truncate text-sm ${
                          active ? 'font-semibold text-primary-container' : 'font-medium text-on-surface'
                        }`}
                      >
                        {category.name}
                      </span>
                    </button>
                    <div className="flex shrink-0 items-center pr-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setCategoryNameDraft(category.name);
                          setCategoryDialog({ mode: 'rename', id: category.id, name: category.name });
                          setCategorySheetOpen(false);
                        }}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
                        aria-label={t('productWall.management.renameCategory')}
                        title={t('productWall.management.renameCategory')}
                        data-tooltip-ignore
                      >
                        <Icon name="edit" size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteCategoryTarget({ id: category.id, name: category.name });
                          setCategorySheetOpen(false);
                        }}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-on-surface-variant transition-colors hover:bg-error-container/30 hover:text-error"
                        aria-label={t('common.delete')}
                        title={t('common.delete')}
                        data-tooltip-ignore
                      >
                        <Icon name="delete" size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
              {categories.length === 0 ? (
                <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
                  <Icon name="folder" size={30} className="mb-2 text-on-surface-variant/40" />
                  <p className="text-sm font-medium text-on-surface">{t('productWall.management.noCategories')}</p>
                  <p className="mt-1 text-xs text-on-surface-variant">{t('productWall.management.noCategoriesHint')}</p>
                </div>
              ) : null}
            </div>
            <div className="border-t border-outline-variant/12 px-4 py-3">
              <button
                type="button"
                onClick={() => {
                  setCategoryNameDraft('');
                  setCategoryDialog({ mode: 'create' });
                  setCategorySheetOpen(false);
                }}
                className="flex h-10 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-primary-container/40 bg-primary-container/8 text-sm font-medium text-primary-container transition-colors hover:bg-primary-container/16"
              >
                <Icon name="add" size={15} />
                {t('productWall.management.addCategory')}
              </button>
            </div>
          </div>
        </DialogOverlay>
      )}

      {previewItem && (
        <ProductWallPreview
          active={previewItem}
          canvasMode={canvasMode}
          activeFavorited={false}
          shareState="idle"
          showFavorite={false}
          showShare={false}
          onClose={() => setPreviewItem(null)}
          onToggleFavorite={() => {}}
          onShare={() => {}}
          onDownload={(item) => void downloadProductWallItem(item)}
        />
      )}

      <ProductWallDeleteDialog
        deleteDialog={deleteDialog}
        deleting={deleting}
        onCancel={() => setDeleteDialog(null)}
        onConfirm={() => void confirmDelete()}
      />

      <ConfirmDialog
        open={Boolean(deleteCategoryTarget)}
        onClose={() => setDeleteCategoryTarget(null)}
        onConfirm={() => void removeCategory()}
        title={t('productWall.categoryDeleteTitle')}
        description={t('productWall.categoryDeleteConfirm', { name: deleteCategoryTarget?.name || '' })}
        confirmLabel={t('common.confirm')}
      />

      {uploadOpen && (
        <ProductWallUploadModal
          open={uploadOpen}
          isAdmin
          categories={categoryNames}
          defaultKind={defaultUploadKind}
          initialFiles={null}
          onClose={() => setUploadOpen(false)}
          onCompleted={() => {
            void mutateList();
            void mutateSWR('product-wall-counts');
          }}
        />
      )}
    </AdminPageShell>
  );
}
