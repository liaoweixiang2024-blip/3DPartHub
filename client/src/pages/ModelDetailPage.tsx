import { motion, AnimatePresence } from 'framer-motion';
import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate, Link, useLocation } from 'react-router-dom';
import useSWR, { mutate as globalMutate } from 'swr';
import { categoriesApi } from '../api/categories';
import { downloadModelFile, isDownloadAuthRequiredError, openModelDrawing } from '../api/downloads';
import { modelApi, type ServerModelListResponse } from '../api/models';
import { updateSettings } from '../api/settings';
import CadViewerPanel from '../components/3d/CadViewerPanel';
import type { ViewMode, CameraPreset } from '../components/3d/ModelViewer';
import type { MaterialPresetKey } from '../components/3d/viewerControls';
import { dispatchFitModel } from '../components/3d/viewerEvents';
import { DEFAULT_VIEWER_TUNING, viewerTuningFromSettings, type ViewerTuning } from '../components/3d/viewerTuning';
import { DesktopDetail, SpecTable } from '../components/model-detail/DesktopDetail';
import { DetailEditDialog } from '../components/model-detail/DetailEditDialog';
import {
  type ModelInfo,
  type ModelDetailLocationState,
  DEFAULT_VIEWER_DISPLAY_PREFS,
  markHomeRestorePending,
  getViewerDisplayPrefs,
  saveViewerDisplayPrefs,
  formatFileSize,
} from '../components/model-detail/modelDetailUtils';
import Icon from '../components/shared/Icon';
import LoginConfirmDialog from '../components/shared/LoginConfirmDialog';
import {
  ModelDetailDesktopFrame,
  MODEL_DETAIL_MOBILE_BOTTOM_NAV_OFFSET,
  getModelDetailMobilePeekHeight,
  getModelDetailMobilePeekVariant,
} from '../components/shared/ModelDetailFrame';
import ModelDetailPageSkeleton from '../components/shared/ModelDetailPageSkeleton';
import ModelThumbnail from '../components/shared/ModelThumbnail';
import { checkProtectedAccess } from '../components/shared/ProtectedLink';
import { PublicPageShell } from '../components/shared/PublicPageShell';
import ShareDialog from '../components/shared/ShareDialog';
import { useToast } from '../components/shared/Toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useModel } from '../hooks/useModels';
import { useMediaQuery } from '../layouts/hooks/useMediaQuery';
import { cacheModelDetailTitle, getCachedModelDetailTitle } from '../lib/modelDetailTitleCache';
import { getModelReturnPath, normalizeModelReturnPath } from '../lib/modelReturnPath';
import {
  getCachedPublicSettings,
  getModelDetailCopyright,
  getModelDetailDisclaimer,
  refreshSiteConfig,
  useFeatureFlags,
} from '../lib/publicSettings';
import { useFavoriteStore, useAuthStore } from '../stores';

export default function ModelDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { i18n, t } = useTranslation();
  useDocumentTitle();
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const featureFlags = useFeatureFlags();
  const initialViewerPrefs = useMemo(() => getViewerDisplayPrefs(), []);

  const [activeView, setActiveView] = useState<ViewMode>(initialViewerPrefs.activeView);
  const [activeCamera, setActiveCamera] = useState<CameraPreset>(initialViewerPrefs.activeCamera);
  const [expandedSpecs, setExpandedSpecs] = useState(true);
  const [showDimensions, setShowDimensions] = useState(initialViewerPrefs.showDimensions);
  const [materialPreset, setMaterialPreset] = useState<MaterialPresetKey>(initialViewerPrefs.materialPreset);
  const [showEdges, setShowEdges] = useState(initialViewerPrefs.showEdges);
  const [clipEnabled, setClipEnabled] = useState(false);
  const [clipPosition, setClipPosition] = useState(0);
  const [clipDirection, setClipDirection] = useState<'x' | 'y' | 'z'>('x');
  const [clipInverted, setClipInverted] = useState(false);
  const [showAxis, setShowAxis] = useState(initialViewerPrefs.showAxis);
  const [viewerTuning, setViewerTuning] = useState<ViewerTuning>(DEFAULT_VIEWER_TUNING);
  const [savedViewerTuning, setSavedViewerTuning] = useState<ViewerTuning>(DEFAULT_VIEWER_TUNING);
  const [viewerTuningOpen, setViewerTuningOpen] = useState(false);
  const [viewerTuningSaving, setViewerTuningSaving] = useState(false);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const sheetContentRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef(0);
  const dragStartScrollTop = useRef(0);
  const dragStartExpanded = useRef(false);
  const isMouseDraggingSheet = useRef(false);
  const [sheetDragOffset, setSheetDragOffset] = useState(0);
  const sheetDragOffsetFrameRef = useRef<number | null>(null);
  const pendingSheetDragOffsetRef = useRef<number | null>(null);
  const [loginPromptOpen, setLoginPromptOpen] = useState(false);
  const [loginPromptReason, setLoginPromptReason] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [viewerFullscreen, setViewerFullscreen] = useState(false);
  const isAdmin = useAuthStore.getState().user?.role === 'ADMIN';
  const { toast } = useToast();
  const currentPath = `${location.pathname}${location.search}${location.hash}`;

  const handleShare = useCallback(() => {
    if (!useAuthStore.getState().isAuthenticated) {
      setLoginPromptReason(t('modelDetail.shareModel'));
      setLoginPromptOpen(true);
      return;
    }
    setShareOpen(true);
  }, [t]);
  const detailLocationState = location.state as ModelDetailLocationState;
  const cachedModelTitle = useMemo(() => getCachedModelDetailTitle(id), [id]);
  const initialModelTitle = detailLocationState?.modelName?.trim() || cachedModelTitle;
  const returnPath = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const fromQuery = normalizeModelReturnPath(params.get('from'), currentPath);
    if (fromQuery) return fromQuery;

    const fromState = normalizeModelReturnPath(detailLocationState?.from, currentPath);
    if (fromState) return fromState;

    const storedPath = getModelReturnPath(currentPath);
    if (storedPath) return storedPath;

    if (typeof window === 'undefined' || !document.referrer) return null;
    try {
      const referrer = new URL(document.referrer);
      if (referrer.origin !== window.location.origin) return null;
      return normalizeModelReturnPath(`${referrer.pathname}${referrer.search}${referrer.hash}`, currentPath);
    } catch {
      return null;
    }
  }, [currentPath, detailLocationState?.from, location.search]);

  useEffect(() => {
    markHomeRestorePending(detailLocationState?.homeBrowseState, id);
  }, [detailLocationState?.homeBrowseState, id]);

  useEffect(() => {
    const handlePageHide = () => {
      markHomeRestorePending(detailLocationState?.homeBrowseState, id);
    };
    const handlePopState = () => {
      markHomeRestorePending(detailLocationState?.homeBrowseState, id);
    };
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [detailLocationState?.homeBrowseState, id]);

  const handleBack = useCallback(() => {
    if (returnPath) {
      markHomeRestorePending(detailLocationState?.homeBrowseState, id);
      navigate(
        returnPath,
        detailLocationState?.homeBrowseState
          ? { state: { homeBrowseState: detailLocationState.homeBrowseState } }
          : undefined,
      );
      return;
    }
    const historyIndex = typeof window !== 'undefined' ? window.history.state?.idx : 0;
    if (typeof historyIndex === 'number' && historyIndex > 0) {
      navigate(-1);
      return;
    }
    navigate('/');
  }, [detailLocationState?.homeBrowseState, id, navigate, returnPath]);

  const handleDownload = useCallback(
    async (modelId: string, format?: string) => {
      try {
        await downloadModelFile(modelId, format || 'original');
      } catch (error) {
        if (isDownloadAuthRequiredError(error)) {
          setLoginPromptReason(t('modelDetail.downloadModel'));
          setLoginPromptOpen(true);
          return;
        }
        toast(t('modelDetail.downloadFailed'), 'error');
      }
    },
    [t, toast],
  );

  const handleOpenDrawing = useCallback(
    async (modelId: string) => {
      try {
        await openModelDrawing(modelId);
      } catch (error) {
        if (isDownloadAuthRequiredError(error)) {
          setLoginPromptReason(t('modelDetail.viewDrawing'));
          setLoginPromptOpen(true);
          return;
        }
        toast(t('modelDetail.drawingOpenFailed'), 'error');
      }
    },
    [t, toast],
  );

  useEffect(() => {
    getCachedPublicSettings()
      .then((s) => {
        const nextTuning = viewerTuningFromSettings(s as Partial<ViewerTuning>);
        setViewerTuning(nextTuning);
        setSavedViewerTuning(nextTuning);
      })
      .catch(() => {});
  }, []);

  const handleSaveViewerTuning = useCallback(async () => {
    if (!isAdmin) return;
    setViewerTuningSaving(true);
    try {
      const saved = await updateSettings(viewerTuning);
      const nextTuning = viewerTuningFromSettings(saved as Partial<ViewerTuning>);
      setViewerTuning(nextTuning);
      setSavedViewerTuning(nextTuning);
      await refreshSiteConfig();
      toast(t('modelDetail.saveViewerTuningSuccess'), 'success');
    } catch {
      toast(t('modelDetail.saveViewerTuningFailed'), 'error');
    } finally {
      setViewerTuningSaving(false);
    }
  }, [isAdmin, t, toast, viewerTuning]);

  const handleResetViewerTuning = useCallback(() => {
    setViewerTuning(savedViewerTuning);
  }, [savedViewerTuning]);

  useEffect(() => {
    saveViewerDisplayPrefs({
      activeView,
      activeCamera: DEFAULT_VIEWER_DISPLAY_PREFS.activeCamera,
      showDimensions,
      materialPreset,
      showEdges,
      showAxis,
    });
  }, [activeView, showDimensions, materialPreset, showEdges, showAxis]);

  const handleResetViewerDisplay = useCallback(() => {
    setActiveView(DEFAULT_VIEWER_DISPLAY_PREFS.activeView);
    setActiveCamera(DEFAULT_VIEWER_DISPLAY_PREFS.activeCamera);
    setShowDimensions(DEFAULT_VIEWER_DISPLAY_PREFS.showDimensions);
    setMaterialPreset(DEFAULT_VIEWER_DISPLAY_PREFS.materialPreset);
    setShowEdges(DEFAULT_VIEWER_DISPLAY_PREFS.showEdges);
    setShowAxis(DEFAULT_VIEWER_DISPLAY_PREFS.showAxis);
    setClipEnabled(false);
    setClipDirection('x');
    setClipPosition(0);
    setClipInverted(false);
    window.setTimeout(dispatchFitModel, 0);
  }, []);

  const { isFavorite, toggleFavorite } = useFavoriteStore();

  const { data: serverModel, isLoading, error, mutate } = useModel(id);
  const { data: catTreeData } = useSWR('/categories', () => categoriesApi.tree());

  const categoryTree = catTreeData?.items;

  let modelData: ModelInfo | undefined;

  if (serverModel) {
    const format = serverModel.format?.toUpperCase() || 'UNKNOWN';
    const name = serverModel.name || serverModel.original_name?.replace(/\.[^.]+$/, '') || t('modelDetail.unnamed');
    const fileSize = formatFileSize(serverModel.original_size || 0);
    const createdAtLabel = serverModel.created_at
      ? new Date(serverModel.created_at).toLocaleString(i18n.language)
      : 'N/A';
    modelData = {
      id: serverModel.model_id,
      name,
      subtitle: t('modelDetail.formatModel', { format }),
      format,
      fileSize,
      createdAtLabel,
      category: serverModel.category || t('modelDetail.categoryFallback'),
      categoryId: serverModel.category_id || undefined,
      specs: [
        { label: t('modelDetail.specFormat'), value: format },
        { label: t('modelDetail.specFileSize'), value: fileSize },
        {
          label: t('modelDetail.specFileDate'),
          value: new Date(serverModel.file_modified_at || serverModel.created_at).toLocaleDateString(i18n.language),
        },
        { label: t('modelDetail.specUploadedAt'), value: createdAtLabel },
        ...(serverModel.description
          ? [{ label: t('modelDetail.specDescription'), value: serverModel.description }]
          : []),
      ],
      downloads: [
        {
          format,
          size: fileSize,
          fileName: serverModel.original_name || `${serverModel.name}.${format.toLowerCase()}`,
          downloadFormat: 'original',
        },
        ...(serverModel.drawing_url
          ? [
              {
                format: 'PDF',
                size: serverModel.drawing_size ? formatFileSize(serverModel.drawing_size) : 'PDF',
                fileName: serverModel.drawing_name || `${serverModel.name}.pdf`,
                downloadFormat: 'drawing' as const,
              },
            ]
          : []),
      ],
      dimensions: '-',
      modelUrl: serverModel.gltf_url || undefined,
      thumbnailUrl: serverModel.thumbnail_url || undefined,
      drawingUrl: serverModel.drawing_url || undefined,
      groupId: serverModel.group?.id,
      groupName: serverModel.group?.name,
      variants: serverModel.group?.variants,
      previewMeta: serverModel.preview_meta || null,
    };
  }

  const fav = modelData ? isFavorite(modelData.id) : false;

  useEffect(() => {
    cacheModelDetailTitle(id, modelData?.name);
  }, [id, modelData?.name]);

  const setSheetDragOffsetImmediate = useCallback((offset: number) => {
    if (sheetDragOffsetFrameRef.current != null) {
      window.cancelAnimationFrame(sheetDragOffsetFrameRef.current);
      sheetDragOffsetFrameRef.current = null;
    }
    pendingSheetDragOffsetRef.current = null;
    setSheetDragOffset(offset);
  }, []);

  const scheduleSheetDragOffset = useCallback((offset: number) => {
    pendingSheetDragOffsetRef.current = offset;
    if (sheetDragOffsetFrameRef.current != null) return;
    sheetDragOffsetFrameRef.current = window.requestAnimationFrame(() => {
      sheetDragOffsetFrameRef.current = null;
      const nextOffset = pendingSheetDragOffsetRef.current;
      pendingSheetDragOffsetRef.current = null;
      if (nextOffset == null) return;
      setSheetDragOffset(nextOffset);
    });
  }, []);

  const updateSheetExpanded = useCallback((expanded: boolean) => {
    setSheetExpanded(expanded);
  }, []);

  useEffect(() => {
    return () => {
      if (sheetDragOffsetFrameRef.current != null) window.cancelAnimationFrame(sheetDragOffsetFrameRef.current);
    };
  }, []);

  const beginSheetDrag = useCallback(
    (clientY: number) => {
      dragStartY.current = clientY;
      dragStartScrollTop.current = sheetContentRef.current?.scrollTop || 0;
      dragStartExpanded.current = sheetExpanded;
      setSheetDragOffsetImmediate(0);
    },
    [sheetExpanded, setSheetDragOffsetImmediate],
  );

  const moveSheetDrag = useCallback(
    (clientY: number) => {
      const dy = clientY - dragStartY.current;

      if (dragStartExpanded.current) {
        const canCloseFromTop = dragStartScrollTop.current <= 4 && (sheetContentRef.current?.scrollTop || 0) <= 4;
        if (dy > 0 && canCloseFromTop) {
          scheduleSheetDragOffset(Math.min(dy, 180));
          return true;
        }
        return false;
      }

      if (dy < 0) {
        scheduleSheetDragOffset(Math.max(dy, -90));
        return true;
      }

      return false;
    },
    [scheduleSheetDragOffset],
  );

  const endSheetDrag = useCallback(
    (clientY: number) => {
      const dy = clientY - dragStartY.current;
      const closeFromTop = dragStartScrollTop.current <= 4;

      if (dragStartExpanded.current && dy > 80 && closeFromTop) {
        updateSheetExpanded(false);
      } else if (!dragStartExpanded.current && dy < -50) {
        updateSheetExpanded(true);
      }

      setSheetDragOffsetImmediate(0);
    },
    [setSheetDragOffsetImmediate, updateSheetExpanded],
  );

  const handleSheetTouchStart = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      beginSheetDrag(e.touches[0].clientY);
    },
    [beginSheetDrag],
  );

  const handleSheetTouchEnd = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      endSheetDrag(e.changedTouches[0].clientY);
    },
    [endSheetDrag],
  );

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;

    const handleTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;

      if (moveSheetDrag(touch.clientY)) {
        event.preventDefault();
      }
    };

    sheet.addEventListener('touchmove', handleTouchMove, { passive: false });
    return () => {
      sheet.removeEventListener('touchmove', handleTouchMove);
    };
  }, [moveSheetDrag]);

  const handleSheetMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      isMouseDraggingSheet.current = true;
      beginSheetDrag(e.clientY);

      const handleWindowMouseMove = (event: MouseEvent) => {
        if (!isMouseDraggingSheet.current) return;
        if (moveSheetDrag(event.clientY)) {
          event.preventDefault();
        }
      };

      const handleWindowMouseUp = (event: MouseEvent) => {
        if (!isMouseDraggingSheet.current) return;
        isMouseDraggingSheet.current = false;
        endSheetDrag(event.clientY);
        window.removeEventListener('mousemove', handleWindowMouseMove);
        window.removeEventListener('mouseup', handleWindowMouseUp);
      };

      window.addEventListener('mousemove', handleWindowMouseMove);
      window.addEventListener('mouseup', handleWindowMouseUp);
    },
    [beginSheetDrag, endSheetDrag, moveSheetDrag],
  );

  const cancelSheetDrag = useCallback(() => {
    isMouseDraggingSheet.current = false;
    setSheetDragOffset(0);
  }, []);

  const handleToggleFav = useCallback(async () => {
    if (!modelData) return;
    const { isAuthenticated } = useAuthStore.getState();
    if (!isAuthenticated) {
      setLoginPromptReason(t('modelDetail.favoriteModel'));
      setLoginPromptOpen(true);
      return;
    }
    const wasFav = isFavorite(modelData.id);
    await toggleFavorite({
      id: modelData.id,
      name: modelData.name,
      subtitle: modelData.subtitle,
      category: modelData.category,
      dimensions: modelData.dimensions,
    });
    // toggleFavorite swallows errors and rolls back internally, so check the
    // actual post-action state to decide success vs failure messaging.
    const nowFav = useFavoriteStore.getState().favoriteIds.has(modelData.id);
    if (nowFav === wasFav) {
      toast(wasFav ? t('productCard.unfavoriteFail') : t('productCard.favoriteFail'), 'error');
      return;
    }
    toast(nowFav ? t('productCard.favoriteSuccess') : t('productCard.unfavoriteSuccess'), 'success');
  }, [modelData, isFavorite, toggleFavorite, t, toast]);

  // Resolve category breadcrumb path from tree
  const categoryBreadcrumb = useMemo(() => {
    if (!categoryTree || !modelData) return [];
    const result: { id: string; name: string }[] = [];
    for (const cat of categoryTree) {
      if (cat.id === modelData.categoryId) {
        result.push({ id: cat.id, name: cat.name });
        return result;
      }
      if (cat.children) {
        for (const child of cat.children) {
          if (child.id === modelData.categoryId) {
            result.push({ id: cat.id, name: cat.name });
            result.push({ id: child.id, name: child.name });
            return result;
          }
        }
      }
    }
    if (modelData.category) {
      result.push({ id: modelData.categoryId || '', name: modelData.category });
    }
    return result;
  }, [categoryTree, modelData]);

  if (error) {
    if (import.meta.env.DEV) console.error('Model load error:', error);
    return (
      <div className="flex flex-col items-center justify-center h-dvh bg-surface gap-4">
        <Icon name="error" size={64} className="text-error" />
        <h1 className="text-2xl font-headline font-bold text-on-surface">{t('modelDetail.loadFailed')}</h1>
        <p className="text-sm text-on-surface-variant">{error?.message || t('modelDetail.retryLater')}</p>
        <button onClick={handleBack} className="text-primary hover:underline">
          {t('modelDetail.back')}
        </button>
      </div>
    );
  }

  if (isLoading) {
    return <ModelDetailPageSkeleton modelTitle={initialModelTitle} isAdmin={isAdmin} />;
  }

  if (!modelData) {
    return (
      <div className="flex flex-col items-center justify-center h-dvh bg-surface gap-4">
        <Icon name="search_off" size={64} className="text-on-surface-variant" />
        <h1 className="text-2xl font-headline font-bold text-on-surface">{t('modelDetail.notFound')}</h1>
        <button onClick={handleBack} className="text-primary hover:underline">
          {t('modelDetail.back')}
        </button>
      </div>
    );
  }

  const viewerProps = {
    modelId: modelData.id,
    modelName: modelData.name,
    modelFormat: modelData.format,
    modelFileSize: modelData.fileSize,
    modelCreatedAt: modelData.createdAtLabel,
    isAdmin: useAuthStore.getState().user?.role === 'ADMIN',
    modelUrl: modelData.modelUrl,
    activeView,
    onViewChange: setActiveView,
    activeCamera,
    onCameraChange: setActiveCamera,
    dimensions: modelData.dimensions,
    showDimensions,
    onToggleDimensions: () => setShowDimensions(!showDimensions),
    materialPreset,
    onMaterialChange: setMaterialPreset,
    showEdges,
    onToggleEdges: () => setShowEdges(!showEdges),
    clipEnabled,
    onToggleClip: () => setClipEnabled((enabled) => !enabled),
    clipPosition,
    onClipPositionChange: setClipPosition,
    clipDirection,
    onClipDirectionChange: setClipDirection,
    clipInverted,
    onToggleClipInverted: () => setClipInverted((inverted) => !inverted),
    onResetClip: () => {
      setClipDirection('x');
      setClipPosition(0);
      setClipInverted(false);
    },
    showAxis,
    onToggleAxis: () => setShowAxis(!showAxis),
    onResetDisplay: handleResetViewerDisplay,
    tuningOpen: viewerTuningOpen,
    onToggleTuning: () => setViewerTuningOpen((prev) => !prev),
    viewerTuning,
    previewMeta: modelData.previewMeta,
    onViewerTuningChange: setViewerTuning,
    onApplyViewerPreset: setViewerTuning,
    onResetViewerTuning: handleResetViewerTuning,
    onSaveViewerTuning: handleSaveViewerTuning,
    viewerTuningSaving,
  };

  // Keep the collapsed sheet height tied to the same title hint used by the skeleton.
  // This avoids a visible jump when the loaded drawer replaces the loading drawer.
  const mobilePeekVariant = initialModelTitle
    ? getModelDetailMobilePeekVariant(initialModelTitle, { isAdmin })
    : getModelDetailMobilePeekVariant(null, { isAdmin, fallback: 'compact' });
  const peekHeight = getModelDetailMobilePeekHeight(mobilePeekVariant);
  const mobileTitleClassName =
    mobilePeekVariant === 'tall' ? 'line-clamp-2 min-h-[2.3rem]' : 'line-clamp-1 min-h-[1.15rem]';

  if (isDesktop) {
    return (
      <ModelDetailDesktopFrame
        layout="ready"
        overlays={
          <>
            <DetailEditDialog
              open={editOpen}
              modelId={modelData.id}
              modelName={modelData.name}
              thumbnailUrl={modelData.thumbnailUrl ?? null}
              drawingUrl={modelData.drawingUrl ?? null}
              categoryId={modelData.categoryId}
              categories={categoryTree || []}
              onClose={() => setEditOpen(false)}
              onSaved={() => {
                mutate();
                globalMutate((k: string) => typeof k === 'string' && k.startsWith('/models'));
              }}
              onDelete={async () => {
                await modelApi.delete(modelData.id);
                handleBack();
              }}
            />
            <ShareDialog
              open={shareOpen}
              onClose={() => setShareOpen(false)}
              modelId={modelData.id}
              modelName={modelData.name}
            />
            <LoginConfirmDialog
              open={loginPromptOpen}
              onClose={() => setLoginPromptOpen(false)}
              reason={loginPromptReason || t('modelDetail.downloadModel')}
              returnUrl={currentPath}
            />
          </>
        }
      >
        <CadViewerPanel
          variant="desktop"
          {...viewerProps}
          showBackButton
          onBack={handleBack}
          onThumbnailUpdated={() => {
            mutate();
            globalMutate((k: string) => typeof k === 'string' && k.startsWith('/models'));
          }}
        />
        <DesktopDetail
          modelData={modelData}
          isFav={fav}
          isAdmin={isAdmin}
          onToggleFav={handleToggleFav}
          onEdit={() => setEditOpen(true)}
          onShare={handleShare}
          categoryBreadcrumb={categoryBreadcrumb}
          onDownload={handleDownload}
          onOpenDrawing={handleOpenDrawing}
          onLoginDialog={(reason) => {
            setLoginPromptReason(reason);
            setLoginPromptOpen(true);
          }}
        />
      </ModelDetailDesktopFrame>
    );
  }

  return (
    <PublicPageShell mobileClassName="flex flex-col h-dvh bg-surface" keepMobileDrawerMounted>
      {/* Main area: 3D viewer + bottom sheet */}
      <div className="flex-1 min-h-0 relative" style={{ marginBottom: MODEL_DETAIL_MOBILE_BOTTOM_NAV_OFFSET }}>
        <CadViewerPanel
          variant="mobile"
          {...viewerProps}
          style={{ bottom: peekHeight }}
          onClick={() => {
            if (sheetExpanded) updateSheetExpanded(false);
          }}
          showBackButton={!sheetExpanded}
          onBack={handleBack}
          onPseudoFullscreenChange={setViewerFullscreen}
          onThumbnailUpdated={() => {
            mutate();
            globalMutate((k: string) => typeof k === 'string' && k.startsWith('/models'));
          }}
        />

        {/* Bottom sheet */}
        <div
          ref={sheetRef}
          className={`absolute bottom-0 left-0 right-0 ${viewerFullscreen ? 'z-[10000]' : 'z-30'} bg-surface-container-low rounded-t-2xl shadow-bottom-panel border-t border-outline-variant/10 flex flex-col overflow-hidden`}
          onTouchStart={handleSheetTouchStart}
          onTouchEnd={handleSheetTouchEnd}
          onTouchCancel={cancelSheetDrag}
          onMouseDown={handleSheetMouseDown}
          style={{
            height: sheetExpanded ? '94%' : peekHeight,
            transform: `translate3d(0, ${sheetDragOffset}px, 0)`,
            transition:
              sheetDragOffset === 0
                ? 'height 0.32s cubic-bezier(0.22, 1, 0.36, 1), transform 0.2s cubic-bezier(0.22, 1, 0.36, 1)'
                : 'none',
            willChange: 'height, transform',
            backfaceVisibility: 'hidden',
          }}
        >
          {/* Drag handle + back button (when expanded) */}
          <div className="flex items-center gap-2 pt-2.5 pb-1.5 px-3 shrink-0">
            {sheetExpanded && (
              <button
                onClick={handleBack}
                className="w-7 h-7 flex items-center justify-center rounded-full text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high active:scale-90 transition-all shrink-0"
              >
                <Icon name="arrow_back" size={18} />
              </button>
            )}
            <div
              onClick={() => updateSheetExpanded(!sheetExpanded)}
              className="flex-1 flex justify-center cursor-pointer"
            >
              <div className="w-9 h-1 rounded-full bg-on-surface-variant/25" />
            </div>
            {sheetExpanded && <div className="w-7 shrink-0" />}
          </div>

          {/* Peek bar — always visible */}
          <div className="shrink-0 px-4 pb-2.5">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <h2
                  className={`text-sm font-bold leading-[1.15rem] text-on-surface break-words ${mobileTitleClassName}`}
                >
                  {modelData.name}
                </h2>
                <p className="text-[11px] text-on-surface-variant truncate">{modelData.subtitle}</p>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                {isAdmin && (
                  <button
                    onClick={() => setEditOpen(true)}
                    aria-label={t('modelDetail.editModel')}
                    className="w-8 h-8 flex items-center justify-center rounded-full text-on-surface-variant hover:text-primary transition-colors"
                  >
                    <Icon name="settings" size={18} />
                  </button>
                )}
                {featureFlags.shares && (
                  <button
                    onClick={handleShare}
                    aria-label={t('common.share')}
                    className="w-8 h-8 flex items-center justify-center rounded-full text-on-surface-variant hover:text-primary transition-colors"
                  >
                    <Icon name="share" size={18} />
                  </button>
                )}
                {featureFlags.favorites && (
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    onClick={handleToggleFav}
                    aria-label={fav ? t('productCard.unfavorite') : t('productCard.favorite')}
                    className="w-8 h-8 flex items-center justify-center rounded-full text-on-surface-variant transition-colors"
                  >
                    <Icon name={fav ? 'star' : 'star_border'} size={18} className={fav ? 'text-primary' : ''} />
                  </motion.button>
                )}
              </div>
            </div>
            {featureFlags.downloads && (
              <button
                onClick={() => handleDownload(modelData.id, 'original')}
                className="mt-2.5 flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary-container text-sm font-medium text-on-primary transition-transform active:scale-[0.98]"
              >
                <Icon name="download" size={18} />
                {t('modelDetail.downloadModel')}
              </button>
            )}
          </div>

          {/* Expanded content — scrollable */}
          <div
            ref={sheetContentRef}
            className={`flex-1 min-h-0 overflow-y-auto scrollbar-hidden ${!sheetExpanded ? 'hidden' : ''}`}
            aria-hidden={!sheetExpanded}
          >
            <div className="px-4 pb-8 space-y-5">
              {/* Category breadcrumb */}
              <div className="flex items-center gap-1.5 text-[11px] text-on-surface-variant overflow-x-auto scrollbar-hidden">
                <Link to="/" className="hover:text-primary transition-colors">
                  {t('modelDetail.categoryFallback')}
                </Link>
                {categoryBreadcrumb.map((cat, i) => (
                  <span key={`${cat.id || cat.name || 'category'}-${i}`} className="flex items-center gap-1.5 shrink-0">
                    <Icon name="chevron_right" size={12} className="text-on-surface-variant/40" />
                    <Link
                      to="/"
                      state={{ homeBrowseState: { categoryId: cat.id, page: 1 } }}
                      className={`hover:text-primary transition-colors ${i === categoryBreadcrumb.length - 1 ? 'text-primary' : ''}`}
                    >
                      {cat.name}
                    </Link>
                  </span>
                ))}
              </div>

              {/* Specs — collapsible */}
              <div className="rounded-sm border border-outline-variant/10 overflow-hidden">
                <button
                  onClick={() => setExpandedSpecs(!expandedSpecs)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-surface-container-low"
                >
                  <span className="text-[11px] uppercase tracking-widest text-on-surface-variant font-medium">
                    {t('modelDetail.techSpecs')}
                  </span>
                  <motion.span animate={{ rotate: expandedSpecs ? 180 : 0 }} transition={{ duration: 0.2 }}>
                    <Icon name="expand_more" size={20} className="text-on-surface-variant" />
                  </motion.span>
                </button>
                <AnimatePresence>
                  {expandedSpecs && (
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: 'auto' }}
                      exit={{ height: 0 }}
                      className="overflow-hidden"
                    >
                      <SpecTable specs={modelData.specs} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Variants */}
              {modelData.variants && modelData.variants.length > 1 && (
                <div>
                  <div className="text-[11px] uppercase tracking-widest text-on-surface-variant font-medium mb-3">
                    {t('modelDetail.versions', { count: modelData.variants.length })}
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                    {modelData.variants.map((v, index) => {
                      const isCurrent = v.model_id === modelData.id;
                      const variantKey = `${v.model_id || v.original_name || 'variant'}-${index}`;
                      return isCurrent ? (
                        <div key={variantKey} className="shrink-0">
                          <div className="w-16 h-16 rounded-md border-2 border-primary bg-surface-container-lowest overflow-hidden relative">
                            <ModelThumbnail src={v.thumbnail_url} alt="" className="w-full h-full object-cover" />
                            <div className="absolute bottom-0 inset-x-0 bg-primary/90 text-on-primary text-[8px] text-center py-0.5">
                              {t('modelDetail.current')}
                            </div>
                            {v.is_primary && (
                              <div className="absolute top-0.5 left-0.5 bg-primary/80 text-on-primary text-[6px] px-0.5 rounded-sm">
                                {t('modelDetail.primaryShort')}
                              </div>
                            )}
                          </div>
                          <p
                            className="text-[9px] text-primary mt-0.5 text-center w-16 truncate"
                            title={v.original_name}
                          >
                            {v.original_name.replace(/\.[^.]+$/, '')}
                          </p>
                          {v.file_modified_at && (
                            <p className="text-[8px] text-on-surface-variant/40 text-center">
                              {new Date(v.file_modified_at).toLocaleDateString(i18n.language)}
                            </p>
                          )}
                        </div>
                      ) : (
                        <Link key={variantKey} to={`/model/${v.model_id}`} className="shrink-0">
                          <div className="w-16 h-16 rounded-md border border-outline-variant/30 bg-surface-container-lowest overflow-hidden relative">
                            <ModelThumbnail src={v.thumbnail_url} alt="" className="w-full h-full object-cover" />
                            {v.is_primary && (
                              <div className="absolute top-0.5 left-0.5 bg-primary/80 text-on-primary text-[6px] px-0.5 rounded-sm">
                                {t('modelDetail.primaryShort')}
                              </div>
                            )}
                          </div>
                          <p
                            className="text-[9px] text-on-surface-variant mt-0.5 text-center w-16 truncate"
                            title={v.original_name}
                          >
                            {v.original_name.replace(/\.[^.]+$/, '')}
                          </p>
                          {v.file_modified_at && (
                            <p className="text-[8px] text-on-surface-variant/40 text-center">
                              {new Date(v.file_modified_at).toLocaleDateString(i18n.language)}
                            </p>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Downloads */}
              {featureFlags.downloads && (
                <div>
                  <div className="text-[11px] uppercase tracking-widest text-on-surface-variant font-medium mb-2">
                    {t('modelDetail.fileDownloads')}
                  </div>
                  <div className="space-y-1.5">
                    {modelData.downloads.map((file, index) => {
                      const downloadKey = `${file.downloadFormat || file.format || file.fileName || 'download'}-${index}`;
                      return file.downloadFormat === 'drawing' ? (
                        <button
                          key={downloadKey}
                          type="button"
                          onClick={() => void handleOpenDrawing(modelData.id)}
                          className="flex w-full items-center justify-between gap-2.5 rounded-sm border border-outline-variant/10 bg-surface-container-low px-3 py-2 text-left transition-colors hover:bg-surface-container"
                        >
                          <div className="w-7 h-7 rounded bg-error/10 flex items-center justify-center shrink-0">
                            <span className="text-[8px] font-bold text-error">PDF</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="block truncate text-xs font-medium text-on-surface" title={file.fileName}>
                              {file.fileName}
                            </span>
                            <span className="text-[10px] text-on-surface-variant">
                              {file.format} · {file.size}
                            </span>
                          </div>
                          <div className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                            <Icon name="open_in_new" size={14} />
                          </div>
                        </button>
                      ) : (
                        <div
                          key={downloadKey}
                          className="flex items-center gap-2 px-3 py-2.5 rounded-sm bg-surface-container-low border border-outline-variant/10"
                        >
                          <div className="w-7 h-7 rounded bg-primary-container/15 flex items-center justify-center shrink-0">
                            <span className="text-[8px] font-bold text-primary-container">
                              {file.format.slice(0, 3)}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium text-on-surface flex min-w-0">
                              <span className="truncate">{file.fileName || file.format}</span>
                            </div>
                            <span className="text-[10px] text-on-surface-variant">
                              {file.format} · {file.size}
                            </span>
                          </div>
                          <button
                            onClick={() =>
                              handleDownload(modelData.id, file.downloadFormat === 'original' ? 'original' : undefined)
                            }
                            className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-primary/10 hover:bg-primary/20 text-primary active:scale-90 transition-all"
                          >
                            <Icon name="download" size={15} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Support */}
              <div className="pt-2 border-t border-outline-variant/20">
                {featureFlags.tickets && (
                  <Link
                    to="/support"
                    state={{
                      modelName: modelData.name,
                      modelNo: modelData.name,
                      specs: Object.fromEntries(modelData.specs.map((s) => [s.label, s.value])),
                      source: 'model',
                    }}
                    onClick={(e) => {
                      const result = checkProtectedAccess('/support');
                      if (result.action === 'dialog' || result.action === 'redirect') {
                        e.preventDefault();
                        setLoginPromptReason(
                          result.action === 'dialog' ? result.reason : t('modelDetail.supportReason'),
                        );
                        setLoginPromptOpen(true);
                      }
                    }}
                    className="flex items-center gap-3 p-3 rounded-sm bg-surface-container-high hover:bg-surface-container-highest transition-colors group"
                  >
                    <div className="w-8 h-8 rounded-full bg-primary-container/15 flex items-center justify-center shrink-0">
                      <Icon name="support_agent" size={16} className="text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-on-surface">{t('modelDetail.customSupportTitle')}</p>
                      <p className="text-[11px] text-on-surface-variant">{t('modelDetail.customSupportDescription')}</p>
                    </div>
                    <Icon name="chevron_right" size={16} className="text-on-surface-variant/40" />
                  </Link>
                )}
                <div className="pt-3 space-y-1">
                  <p className="text-[11px] text-on-surface-variant/50 leading-relaxed">{getModelDetailDisclaimer()}</p>
                  <p className="text-[11px] text-on-surface-variant/30">{getModelDetailCopyright()}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <DetailEditDialog
        open={editOpen}
        modelId={modelData.id}
        modelName={modelData.name}
        thumbnailUrl={modelData.thumbnailUrl ?? null}
        drawingUrl={modelData.drawingUrl ?? null}
        categoryId={modelData.categoryId}
        categories={categoryTree || []}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          mutate();
          globalMutate((k: string) => typeof k === 'string' && k.startsWith('/models'));
        }}
        onDelete={async () => {
          await modelApi.delete(modelData.id);
          globalMutate(
            (k: string) => typeof k === 'string' && k.includes('/models/infinite'),
            (pages: ServerModelListResponse[] | undefined) => {
              if (!pages) return pages;
              return pages.map((p) => ({
                ...p,
                items: p.items?.filter((m) => m.model_id !== modelData.id),
                total: Math.max(0, (p.total ?? 0) - (p.items?.some((m) => m.model_id === modelData.id) ? 1 : 0)),
              }));
            },
            false,
          );
          await Promise.all([
            globalMutate('/models/count'),
            globalMutate(
              (k: string) => typeof k === 'string' && (k.startsWith('/categories') || k.includes('/categories')),
            ),
          ]);
          handleBack();
        }}
      />
      <ShareDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        modelId={modelData.id}
        modelName={modelData.name}
      />
      <LoginConfirmDialog
        open={loginPromptOpen}
        onClose={() => setLoginPromptOpen(false)}
        reason={loginPromptReason || t('modelDetail.downloadModel')}
        returnUrl={currentPath}
      />
    </PublicPageShell>
  );
}
