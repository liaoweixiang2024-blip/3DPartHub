import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useCallback, useRef, memo, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { popoverMotion } from '../../lib/motion';
import { useFeatureFlags } from '../../lib/publicSettings';
import { preloadModelDetailPage } from '../../lib/routeLoaders';
import { useAuthStore, useFavoriteStore } from '../../stores';
import FormatTag from '../shared/FormatTag';
import Icon from '../shared/Icon';
import ModelThumbnail from '../shared/ModelThumbnail';
import { useToast } from '../shared/Toast';
import {
  HomeGridCardContent,
  HomeListCardContent,
  HOME_GRID_ACTION_BUTTON_CLASS,
  HOME_GRID_CARD_CLASS,
  HOME_LIST_ACTION_BUTTON_CLASS,
  HOME_LIST_CARD_CLASS,
} from './HomeDesktopShared';
import type { HomeBrowseState, Product } from './homeTypes';

const FAVORITE_BURST_PARTICLES = [
  { x: -18, y: -7, size: 3, className: 'bg-primary-container' },
  { x: -12, y: -18, size: 2.5, className: 'bg-primary' },
  { x: 0, y: -22, size: 3, className: 'bg-warning' },
  { x: 13, y: -16, size: 2.5, className: 'bg-primary-container' },
  { x: 18, y: -2, size: 3, className: 'bg-primary' },
  { x: 7, y: 12, size: 2.5, className: 'bg-warning' },
] as const;

function FavoriteBurst({ burstKey }: { burstKey: number }) {
  return (
    <AnimatePresence>
      {burstKey > 0 && (
        <span key={burstKey} className="pointer-events-none absolute inset-0 z-20">
          <motion.span
            className="absolute inset-[-2px] rounded-full border border-primary-container/35"
            initial={{ opacity: 0.34, scale: 0.45 }}
            animate={{ opacity: 0, scale: 1.8 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
          {FAVORITE_BURST_PARTICLES.map((particle, index) => (
            <motion.span
              key={`${particle.x}-${particle.y}-${index}`}
              className={`absolute left-1/2 top-1/2 rounded-full ${particle.className}`}
              style={{ width: particle.size, height: particle.size }}
              initial={{ x: -particle.size / 2, y: -particle.size / 2, opacity: 0, scale: 0.5 }}
              animate={{
                x: particle.x,
                y: particle.y,
                opacity: [0, 1, 0],
                scale: [0.5, 1, 0.85],
              }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.62, ease: 'easeOut', delay: index * 0.015 }}
            />
          ))}
        </span>
      )}
    </AnimatePresence>
  );
}

function ProductCardInner({
  product,
  onDownload,
  imageLoading = 'lazy',
  imageFetchPriority = 'auto',
  returnPath,
  homeBrowseState,
  onBeforeOpen,
  onContextMenu,
  manageOpen,
  onCloseManage,
  onOpenManageDetail,
  onShareModel,
  onRenameModel,
  onRequestDelete,
  showCategory = false,
  showVariantMeta = false,
  variant = 'grid',
}: {
  product: Product;
  onDownload: (id: string) => void;
  imageLoading?: 'eager' | 'lazy';
  imageFetchPriority?: 'high' | 'low' | 'auto';
  returnPath: string;
  homeBrowseState: HomeBrowseState;
  onBeforeOpen?: (modelId: string) => void;
  onContextMenu?: (event: MouseEvent, product: Product) => void;
  manageOpen?: boolean;
  onCloseManage?: () => void;
  onOpenManageDetail?: (product: Product) => void;
  onShareModel?: (product: Product) => void;
  onRenameModel?: (product: Product, name: string) => Promise<void>;
  onRequestDelete?: (product: Product) => void;
  showCategory?: boolean;
  showVariantMeta?: boolean;
  variant?: 'grid' | 'list';
}) {
  const detailPath = `/model/${product.id}`;
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(product.name);
  const [renameSaving, setRenameSaving] = useState(false);
  const [favLoading, setFavLoading] = useState(false);
  const [favoriteBurstKey, setFavoriteBurstKey] = useState(0);
  const ignoreNextOverlayClickRef = useRef(false);
  // 管理面板里的「编辑名称/删除模型」仅管理员可用；普通登录用户右键只有详情+分享
  const canManageModel = Boolean(onRenameModel && onRequestDelete);
  const { t } = useTranslation();
  const { toast } = useToast();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isFavorited = useFavoriteStore((state) => state.favoriteIds.has(product.id));
  const toggleFavoriteInStore = useFavoriteStore((state) => state.toggleFavorite);
  const featureFlags = useFeatureFlags();

  useEffect(() => {
    if (manageOpen) {
      setRenameValue(product.name);
      setRenaming(false);
      setRenameSaving(false);
    }
  }, [manageOpen, product.name]);

  const toggleFavorite = useCallback(
    async (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (favLoading || !isAuthenticated) return;
      const shouldCelebrate = !isFavorited;
      setFavLoading(true);
      try {
        await toggleFavoriteInStore({ id: product.id });
        const nextIsFavorited = useFavoriteStore.getState().favoriteIds.has(product.id);
        if (nextIsFavorited === isFavorited) {
          toast(shouldCelebrate ? t('productCard.favoriteFail') : t('productCard.unfavoriteFail'), 'error');
          return;
        }
        if (shouldCelebrate && nextIsFavorited) {
          setFavoriteBurstKey((key) => key + 1);
        }
        toast(nextIsFavorited ? t('productCard.favoriteSuccess') : t('productCard.unfavoriteSuccess'), 'success');
      } catch {
        toast(shouldCelebrate ? t('productCard.favoriteFail') : t('productCard.unfavoriteFail'), 'error');
      } finally {
        setFavLoading(false);
      }
    },
    [favLoading, isAuthenticated, isFavorited, product.id, t, toast, toggleFavoriteInStore],
  );

  const cancelRename = useCallback(() => {
    setRenameValue(product.name);
    setRenaming(false);
  }, [product.name]);

  const commitRename = useCallback(async () => {
    const nextName = renameValue.trim();
    if (renameSaving) return false;
    if (!nextName || nextName === product.name) {
      setRenameValue(product.name);
      setRenaming(false);
      return true;
    }
    setRenameSaving(true);
    try {
      await onRenameModel?.(product, nextName);
      setRenaming(false);
      return true;
    } catch {
      return false;
    } finally {
      setRenameSaving(false);
    }
  }, [onRenameModel, product, renameSaving, renameValue]);

  const finishRenameThen = useCallback(
    async (action: () => void) => {
      if (renaming) {
        const committed = await commitRename();
        if (!committed) return;
      }
      action();
    },
    [commitRename, renaming],
  );

  const handleCardClick = useCallback(
    (event: MouseEvent) => {
      if (manageOpen) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      onBeforeOpen?.(product.id);
    },
    [manageOpen, onBeforeOpen, product.id],
  );

  const manageOverlay = manageOpen ? (
    <motion.div
      variants={popoverMotion}
      initial="initial"
      animate="animate"
      exit="exit"
      className="absolute inset-0 z-20 bg-surface-container-high text-on-surface"
      draggable={false}
      onDragStartCapture={(event) => event.preventDefault()}
      onDragOverCapture={(event) => event.preventDefault()}
      onDropCapture={(event) => event.preventDefault()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (ignoreNextOverlayClickRef.current) {
          ignoreNextOverlayClickRef.current = false;
          return;
        }
        if (renaming && event.target instanceof Element && !event.target.closest('[data-rename-control]')) {
          void commitRename();
        }
      }}
      onContextMenu={(event) => {
        if (event.target instanceof Element && event.target.closest('[data-rename-control]')) {
          event.stopPropagation();
          return;
        }
        event.preventDefault();
      }}
    >
      <div className="flex h-full flex-col p-3">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-primary">
              {canManageModel ? t('productCard.adminLabel') : t('productCard.quickLabel')}
            </p>
            {renaming ? (
              <textarea
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                onClick={(event) => event.stopPropagation()}
                onMouseDown={(event) => {
                  ignoreNextOverlayClickRef.current = true;
                  event.stopPropagation();
                }}
                onMouseUp={(event) => event.stopPropagation()}
                onPointerDown={(event) => {
                  ignoreNextOverlayClickRef.current = true;
                  event.stopPropagation();
                }}
                onPointerUp={(event) => event.stopPropagation()}
                onDragStart={(event) => event.preventDefault()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => event.preventDefault()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    event.stopPropagation();
                    void commitRename();
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    cancelRename();
                  }
                }}
                data-rename-control
                draggable={false}
                rows={2}
                className="mt-1 h-20 max-h-36 min-h-16 w-full min-w-0 resize-y rounded-sm border border-primary/40 bg-surface-container-lowest px-2.5 py-1.5 text-sm font-semibold leading-5 text-on-surface outline-none selection:bg-primary/30 focus:border-primary"
                autoFocus
              />
            ) : canManageModel ? (
              <button
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setRenaming(true);
                }}
                className="mt-1 flex w-full min-w-0 items-start gap-1.5 rounded-sm text-left text-sm font-semibold leading-tight text-on-surface transition-colors hover:text-primary"
                title={t('productCard.editName')}
              >
                <span className="line-clamp-2 min-w-0">{product.name}</span>
              </button>
            ) : (
              <p className="mt-1 line-clamp-2 min-w-0 text-left text-sm font-semibold leading-tight text-on-surface">
                {product.name}
              </p>
            )}
            <p className="mt-1 text-[11px] text-on-surface-variant">{product.fileSize}</p>
            {renaming && <p className="mt-1 text-[10px] text-on-surface-variant/80">{t('productCard.renameHint')}</p>}
          </div>
          <button
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void finishRenameThen(() => onCloseManage?.());
            }}
            data-rename-control
            className="grid h-7 w-7 shrink-0 place-items-center rounded-sm text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface"
            title={t('common.close')}
          >
            <Icon name="close" size={15} />
          </button>
        </div>
        <div className="mt-auto grid gap-2">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void finishRenameThen(() => onOpenManageDetail?.(product));
              }}
              data-rename-control
              disabled={renameSaving}
              className="flex min-w-0 items-center justify-center gap-1.5 rounded-sm bg-primary-container px-2 py-2 text-xs font-medium text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Icon
                name={renameSaving ? 'progress_activity' : 'open_in_new'}
                size={13}
                className={renameSaving ? 'animate-spin' : ''}
              />
              <span className="truncate">{t('productCard.openDetail')}</span>
            </button>
            {featureFlags.shares && onShareModel && (
              <button
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void finishRenameThen(() => onShareModel?.(product));
                }}
                data-rename-control
                disabled={renameSaving}
                className="flex min-w-0 items-center justify-center gap-1.5 rounded-sm border border-outline-variant/30 px-2 py-2 text-xs text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface disabled:opacity-50"
              >
                <Icon name="share" size={13} />
                <span className="truncate">{t('productCard.shareLink')}</span>
              </button>
            )}
            {canManageModel && (
              <button
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void finishRenameThen(() => onRequestDelete?.(product));
                }}
                data-rename-control
                disabled={renameSaving}
                className="col-span-2 flex min-w-0 items-center justify-center gap-1.5 rounded-sm border border-error/30 px-2 py-2 text-xs font-semibold text-error transition-colors hover:bg-error-container/15 disabled:opacity-50"
              >
                <Icon name="delete" size={13} />
                <span className="truncate">{t('productCard.deleteModel')}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  ) : null;

  const listFavoriteAction =
    isAuthenticated && featureFlags.favorites ? (
      <button
        onClick={toggleFavorite}
        disabled={favLoading}
        className={`${HOME_LIST_ACTION_BUTTON_CLASS} home-model-list-favorite-button border transition-colors ${
          isFavorited
            ? 'border-primary-container/45 bg-primary-container/10 text-primary-container'
            : 'border-outline-variant/40 text-on-surface-variant hover:text-on-surface'
        } relative overflow-visible ${favLoading ? 'opacity-60' : ''}`}
        aria-label={isFavorited ? t('productCard.unfavorite') : t('productCard.favorite')}
        aria-pressed={isFavorited}
        data-tooltip-ignore
      >
        <FavoriteBurst burstKey={favoriteBurstKey} />
        <Icon name={isFavorited ? 'favorite' : 'star'} size={14} />
        {t('productCard.favorite')}
      </button>
    ) : null;

  if (variant === 'list') {
    const content = (
      <>
        <HomeListCardContent
          media={
            <>
              <ModelThumbnail
                src={product.thumbnailUrl}
                alt={product.name}
                loading={imageLoading}
                fetchPriority={imageFetchPriority}
                className="w-full h-full object-cover"
              />
              <div className="absolute top-1.5 left-1.5 flex gap-1">
                {product.formats.map((f, index) => (
                  <FormatTag key={`${f || 'format'}-${index}`} format={f} />
                ))}
              </div>
            </>
          }
          title={
            <h3 className="home-model-title mb-1 text-sm font-headline text-on-surface leading-tight line-clamp-1">
              {product.name}
            </h3>
          }
          meta={
            <>
              {showCategory ? <span>{product.category}</span> : null}
              <span>{product.fileSize}</span>
              {showVariantMeta && product.variantCount && product.variantCount > 1 && (
                <span className="bg-primary/20 text-primary px-1.5 py-0.5 rounded-sm text-[10px] font-medium">
                  {t('productCard.variantBadge', { count: product.variantCount })}
                </span>
              )}
            </>
          }
          actions={
            <>
              {featureFlags.downloads && (
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onDownload(product.id);
                  }}
                  className={`${HOME_LIST_ACTION_BUTTON_CLASS} home-model-download-button bg-primary-container font-medium text-on-primary hover:opacity-90`}
                >
                  <Icon name="download" size={14} fill />
                  {t('common.download')}
                </button>
              )}
              {listFavoriteAction}
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onOpenManageDetail?.(product);
                }}
                className={`${HOME_LIST_ACTION_BUTTON_CLASS} home-model-preview-button border border-outline-variant/40 text-on-surface-variant hover:text-on-surface`}
              >
                <Icon name="visibility" size={14} />
                {t('common.preview')}
              </button>
            </>
          }
        />
        {manageOverlay && <AnimatePresence>{manageOverlay}</AnimatePresence>}
      </>
    );
    const className = HOME_LIST_CARD_CLASS;
    if (manageOpen) {
      return (
        <div
          onContextMenu={(event) => onContextMenu?.(event, product)}
          data-home-model-id={product.id}
          data-home-model-layout="list"
          draggable={false}
          className={className}
        >
          {content}
        </div>
      );
    }
    return (
      <Link
        to={detailPath}
        state={{ from: returnPath, homeBrowseState }}
        onClick={handleCardClick}
        onPointerDown={preloadModelDetailPage}
        onFocus={preloadModelDetailPage}
        onContextMenu={(event) => onContextMenu?.(event, product)}
        data-home-model-id={product.id}
        data-home-model-layout="list"
        draggable={false}
        className={className}
      >
        {content}
      </Link>
    );
  }
  const content = (
    <>
      <HomeGridCardContent
        media={
          <>
            <ModelThumbnail
              src={product.thumbnailUrl}
              alt={product.name}
              loading={imageLoading}
              fetchPriority={imageFetchPriority}
              className="w-full h-full object-cover"
            />
            <div className="absolute top-2 left-2 flex gap-1">
              {product.formats.map((f, index) => (
                <FormatTag key={`${f || 'format'}-${index}`} format={f} />
              ))}
            </div>
            <span className="absolute top-2 right-2 bg-surface-container-highest/90 px-1.5 py-0.5 text-[9px] text-on-surface-variant font-mono rounded-sm border border-outline-variant/30">
              {product.fileSize}
            </span>
            {(isAuthenticated || (showVariantMeta && product.variantCount && product.variantCount > 1)) && (
              <div className="home-card-hover-actions absolute right-2 bottom-2 z-20 flex translate-y-1 scale-95 items-center gap-1.5 opacity-0 transition-all duration-150 ease-out group-hover:translate-y-0 group-hover:scale-100 group-hover:opacity-100">
                {isAuthenticated && featureFlags.favorites && (
                  <button
                    onClick={toggleFavorite}
                    disabled={favLoading}
                    className={`relative inline-flex h-7 w-7 items-center justify-center overflow-visible rounded-full border border-outline-variant/20 bg-surface-container-lowest/90 transition-colors ${
                      isFavorited
                        ? 'border-primary-container/35 text-primary-container'
                        : 'text-on-surface-variant/70 hover:text-on-surface-variant'
                    } ${favLoading ? 'opacity-60' : ''}`}
                    aria-label={isFavorited ? t('productCard.unfavorite') : t('productCard.favorite')}
                    aria-pressed={isFavorited}
                    data-tooltip-ignore
                  >
                    <FavoriteBurst burstKey={favoriteBurstKey} />
                    <Icon name={isFavorited ? 'favorite' : 'star'} size={14} />
                  </button>
                )}
                {showVariantMeta && product.variantCount && product.variantCount > 1 && (
                  <span className="rounded-sm bg-primary/90 px-1.5 py-0.5 text-[9px] font-bold text-on-primary">
                    ×{product.variantCount}
                  </span>
                )}
              </div>
            )}
          </>
        }
        title={
          <h3 className="home-model-title text-xs font-headline text-on-surface leading-tight line-clamp-2">
            {product.name}
          </h3>
        }
        meta={
          showCategory || (showVariantMeta && product.variantCount && product.variantCount > 1) ? (
            <>
              {showCategory ? <span>{product.category}</span> : null}
              {showVariantMeta && product.variantCount && product.variantCount > 1 ? (
                <span>{t('productCard.variantCount', { count: product.variantCount })}</span>
              ) : null}
            </>
          ) : null
        }
        actions={
          <>
            {featureFlags.downloads && (
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDownload(product.id);
                }}
                className={`${HOME_GRID_ACTION_BUTTON_CLASS} home-model-download-button bg-primary-container font-medium text-on-primary hover:opacity-90`}
              >
                <Icon name="download" size={14} fill />
                {t('common.download')}
              </button>
            )}
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onOpenManageDetail?.(product);
              }}
              className={`${HOME_GRID_ACTION_BUTTON_CLASS} home-model-preview-button border border-outline-variant/40 text-center text-on-surface-variant hover:text-on-surface`}
            >
              <Icon name="visibility" size={14} />
              {t('common.preview')}
            </button>
          </>
        }
      />
      {manageOverlay && <AnimatePresence>{manageOverlay}</AnimatePresence>}
    </>
  );
  const className = HOME_GRID_CARD_CLASS;
  if (manageOpen) {
    return (
      <div
        onContextMenu={(event) => onContextMenu?.(event, product)}
        data-home-model-id={product.id}
        data-home-model-layout="grid"
        draggable={false}
        className={className}
      >
        {content}
      </div>
    );
  }
  return (
    <Link
      to={detailPath}
      state={{ from: returnPath, homeBrowseState }}
      onClick={handleCardClick}
      onPointerDown={preloadModelDetailPage}
      onFocus={preloadModelDetailPage}
      onContextMenu={(event) => onContextMenu?.(event, product)}
      data-home-model-id={product.id}
      data-home-model-layout="grid"
      draggable={false}
      className={className}
    >
      {content}
    </Link>
  );
}

export const ProductCard = memo(ProductCardInner, (prev, next) => {
  if (prev.product.id !== next.product.id) return false;
  if (prev.product.name !== next.product.name) return false;
  if (prev.product.thumbnailUrl !== next.product.thumbnailUrl) return false;
  if (prev.imageLoading !== next.imageLoading) return false;
  if (prev.imageFetchPriority !== next.imageFetchPriority) return false;
  if (prev.product.fileSize !== next.product.fileSize) return false;
  if (prev.product.variantCount !== next.product.variantCount) return false;
  if (prev.product.formats !== next.product.formats) return false;
  if (prev.manageOpen !== next.manageOpen) return false;
  if (prev.showCategory !== next.showCategory) return false;
  if (prev.showVariantMeta !== next.showVariantMeta) return false;
  if (prev.variant !== next.variant) return false;
  if (prev.onDownload !== next.onDownload) return false;
  if (prev.onBeforeOpen !== next.onBeforeOpen) return false;
  if (prev.onContextMenu !== next.onContextMenu) return false;
  if (prev.onShareModel !== next.onShareModel) return false;
  if (prev.onRenameModel !== next.onRenameModel) return false;
  if (prev.onRequestDelete !== next.onRequestDelete) return false;
  if (prev.onCloseManage !== next.onCloseManage) return false;
  if (prev.onOpenManageDetail !== next.onOpenManageDetail) return false;
  return true;
});
