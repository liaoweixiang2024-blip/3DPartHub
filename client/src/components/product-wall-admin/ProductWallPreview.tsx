import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { ProductWallItem } from '../../api/productWall';
import { useFeatureFlags } from '../../lib/publicSettings';
import Icon from '../shared/Icon';
import SafeImage from '../shared/SafeImage';
import { productWallPreviewImage, type ProductWallCanvasMode } from './productWallAdminUtils';

type WallItem = ProductWallItem;

export function ProductWallPreview({
  active,
  canvasMode,
  activeFavorited,
  shareState,
  onClose,
  onToggleFavorite,
  onShare,
  onDownload,
}: {
  active: WallItem;
  canvasMode: ProductWallCanvasMode;
  activeFavorited: boolean;
  shareState: 'idle' | 'copied';
  onClose: () => void;
  onToggleFavorite: () => void;
  onShare: () => void;
  onDownload: (item: WallItem) => void;
}) {
  const { t } = useTranslation();
  const featureFlags = useFeatureFlags();
  const previewCloseRef = useRef<HTMLButtonElement | null>(null);
  const previewDragRef = useRef({ active: false, moved: false, startX: 0, startY: 0, panX: 0, panY: 0 });
  const previewPanRef = useRef({ x: 0, y: 0 });
  const pendingPreviewPanRef = useRef<{ x: number; y: number } | null>(null);
  const previewPanFrameRef = useRef<number | null>(null);
  const pinchRef = useRef({ active: false, startDist: 0, startZoom: 1, cx: 0, cy: 0 });
  const momentumRef = useRef({ vx: 0, vy: 0, raf: 0, lastTime: 0, lastX: 0, lastY: 0 });
  const doubleTapRef = useRef({ lastTap: 0, x: 0, y: 0 });
  const pinchJustEndedRef = useRef(false);
  const previewCanvasRef = useRef<HTMLDivElement | null>(null);
  const previewZoomRef = useRef(1);
  const originalImageSourceRef = useRef('');

  const activeId = active.id;
  const activeImage = active.image || '';
  const activePreviewImage = productWallPreviewImage(active);

  const [detailOriginalReady, setDetailOriginalReady] = useState(false);
  const [detailOriginalFailed, setDetailOriginalFailed] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [previewPan, setPreviewPan] = useState({ x: 0, y: 0 });
  const [previewDragging, setPreviewDragging] = useState(false);

  const activeDetailImage =
    activeImage && detailOriginalReady && !detailOriginalFailed ? activeImage : activePreviewImage;
  const previewZoomed = previewZoom > 1.01;

  const schedulePreviewPan = useCallback((nextPan: { x: number; y: number }) => {
    previewPanRef.current = nextPan;
    pendingPreviewPanRef.current = nextPan;
    if (previewPanFrameRef.current != null) return;
    previewPanFrameRef.current = window.requestAnimationFrame(() => {
      previewPanFrameRef.current = null;
      const pendingPan = pendingPreviewPanRef.current;
      if (!pendingPan) return;
      pendingPreviewPanRef.current = null;
      setPreviewPan(pendingPan);
    });
  }, []);

  const setPreviewPanImmediate = useCallback((nextPan: { x: number; y: number }) => {
    if (previewPanFrameRef.current != null) {
      window.cancelAnimationFrame(previewPanFrameRef.current);
      previewPanFrameRef.current = null;
    }
    pendingPreviewPanRef.current = null;
    previewPanRef.current = nextPan;
    setPreviewPan(nextPan);
  }, []);

  const setPreviewZoomLevel = useCallback(
    (value: number) => {
      const nextZoom = Math.min(5, Math.max(1, value));
      setPreviewZoom(nextZoom);
      if (nextZoom <= 1.01) setPreviewPanImmediate({ x: 0, y: 0 });
    },
    [setPreviewPanImmediate],
  );

  previewZoomRef.current = previewZoom;

  // Reset zoom/pan when active item changes
  useEffect(() => {
    setPreviewZoom(1);
    setPreviewPanImmediate({ x: 0, y: 0 });
    setPreviewDragging(false);
    previewDragRef.current = { active: false, moved: false, startX: 0, startY: 0, panX: 0, panY: 0 };
    pinchRef.current = { active: false, startDist: 0, startZoom: 1, cx: 0, cy: 0 };
    cancelAnimationFrame(momentumRef.current.raf);
    momentumRef.current = { vx: 0, vy: 0, raf: 0, lastTime: 0, lastX: 0, lastY: 0 };
  }, [activeId, setPreviewPanImmediate]);

  // Load original image
  useEffect(() => {
    const sourceKey = `${activeId}:${activeImage}:${activePreviewImage}`;
    const sourceChanged = originalImageSourceRef.current !== sourceKey;
    if (sourceChanged) {
      originalImageSourceRef.current = sourceKey;
      setDetailOriginalReady(false);
      setDetailOriginalFailed(false);
    }
    if (!activeImage || typeof window === 'undefined') return;

    if (activeImage === activePreviewImage) {
      setDetailOriginalReady(true);
      return;
    }

    const isCompactViewport = window.matchMedia?.('(max-width: 767px)').matches;
    if (isCompactViewport && !previewZoomed) return;
    if (!sourceChanged && (detailOriginalReady || detailOriginalFailed)) return;

    let cancelled = false;
    let image: HTMLImageElement | null = null;
    const timer = window.setTimeout(
      () => {
        if (cancelled) return;
        image = new window.Image();
        image.decoding = 'async';
        image.onload = () => {
          if (!cancelled) setDetailOriginalReady(true);
        };
        image.onerror = () => {
          if (!cancelled) setDetailOriginalFailed(true);
        };
        image.src = activeImage;
        const decodePromise = image.decode?.();
        void decodePromise?.then(
          () => {
            if (!cancelled) setDetailOriginalReady(true);
          },
          () => {
            if (!cancelled) setDetailOriginalFailed(true);
          },
        );
      },
      previewZoomed ? 80 : isCompactViewport ? 180 : 420,
    );

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (image) {
        image.onload = null;
        image.onerror = null;
      }
    };
  }, [activeId, activeImage, activePreviewImage, detailOriginalFailed, detailOriginalReady, previewZoomed]);

  // Cleanup raf on unmount
  useEffect(() => {
    return () => {
      if (previewPanFrameRef.current != null) window.cancelAnimationFrame(previewPanFrameRef.current);
      cancelAnimationFrame(momentumRef.current.raf);
    };
  }, []);

  // Wheel zoom
  useEffect(() => {
    const el = previewCanvasRef.current;
    if (!el) return;
    const handler = (e: globalThis.WheelEvent) => {
      e.preventDefault();
      cancelAnimationFrame(momentumRef.current.raf);
      setPreviewZoomLevel(previewZoomRef.current + (e.deltaY > 0 ? -0.18 : 0.18));
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [setPreviewZoomLevel]);

  // Touch gesture prevention
  useEffect(() => {
    const el = previewCanvasRef.current;
    if (!el) return;
    const preventNativeTouch = (event: TouchEvent) => {
      if (event.touches.length > 1 || previewZoomRef.current > 1.01 || pinchRef.current.active) {
        event.preventDefault();
      }
    };
    const preventNativeGesture = (event: Event) => {
      event.preventDefault();
    };
    el.addEventListener('touchstart', preventNativeTouch, { passive: false });
    el.addEventListener('touchmove', preventNativeTouch, { passive: false });
    el.addEventListener('gesturestart', preventNativeGesture, { passive: false });
    el.addEventListener('gesturechange', preventNativeGesture, { passive: false });
    el.addEventListener('gestureend', preventNativeGesture, { passive: false });
    return () => {
      el.removeEventListener('touchstart', preventNativeTouch);
      el.removeEventListener('touchmove', preventNativeTouch);
      el.removeEventListener('gesturestart', preventNativeGesture);
      el.removeEventListener('gesturechange', preventNativeGesture);
      el.removeEventListener('gestureend', preventNativeGesture);
    };
  }, []);

  // Sync previewPan ref
  useEffect(() => {
    if (!pendingPreviewPanRef.current) previewPanRef.current = previewPan;
  }, [previewPan]);

  const runMomentum = (vx: number, vy: number) => {
    cancelAnimationFrame(momentumRef.current.raf);
    setPreviewDragging(true);
    let velX = vx;
    let velY = vy;
    const friction = 0.92;
    const tick = () => {
      velX *= friction;
      velY *= friction;
      if (Math.abs(velX) < 0.3 && Math.abs(velY) < 0.3) {
        momentumRef.current.raf = 0;
        setPreviewDragging(false);
        return;
      }
      const currentPan = previewPanRef.current;
      schedulePreviewPan({ x: currentPan.x + velX, y: currentPan.y + velY });
      momentumRef.current.raf = requestAnimationFrame(tick);
    };
    momentumRef.current.raf = requestAnimationFrame(tick);
  };

  const togglePreviewZoom = () => {
    setPreviewZoomLevel(previewZoomed ? 1 : 2.15);
  };

  const handlePreviewPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!previewZoomed) return;
    event.preventDefault();
    cancelAnimationFrame(momentumRef.current.raf);
    event.currentTarget.setPointerCapture(event.pointerId);
    const now = performance.now();
    previewDragRef.current = {
      active: true,
      moved: false,
      startX: event.clientX,
      startY: event.clientY,
      panX: previewPanRef.current.x,
      panY: previewPanRef.current.y,
    };
    momentumRef.current.lastTime = now;
    momentumRef.current.lastX = event.clientX;
    momentumRef.current.lastY = event.clientY;
    momentumRef.current.vx = 0;
    momentumRef.current.vy = 0;
    setPreviewDragging(true);
  };

  const handlePreviewPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const dragState = previewDragRef.current;
    if (!dragState.active) return;
    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) dragState.moved = true;
    const now = performance.now();
    const dt = now - momentumRef.current.lastTime;
    if (dt > 0) {
      momentumRef.current.vx = ((event.clientX - momentumRef.current.lastX) / dt) * 16;
      momentumRef.current.vy = ((event.clientY - momentumRef.current.lastY) / dt) * 16;
      momentumRef.current.lastTime = now;
      momentumRef.current.lastX = event.clientX;
      momentumRef.current.lastY = event.clientY;
    }
    schedulePreviewPan({ x: dragState.panX + dx, y: dragState.panY + dy });
  };

  const handlePreviewPointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!previewDragRef.current.active) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const shouldRunMomentum = previewDragRef.current.moved && previewZoomRef.current > 1.01;
    previewDragRef.current.active = false;
    if (shouldRunMomentum) {
      runMomentum(momentumRef.current.vx, momentumRef.current.vy);
    } else {
      setPreviewDragging(false);
    }
  };

  const handlePreviewImageClick = () => {
    if (pinchJustEndedRef.current) {
      pinchJustEndedRef.current = false;
      return;
    }
    if (previewDragRef.current.moved) {
      previewDragRef.current.moved = false;
      return;
    }
    togglePreviewZoom();
  };

  const handleCanvasTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      cancelAnimationFrame(momentumRef.current.raf);
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      const dx = t1.clientX - t0.clientX;
      const dy = t1.clientY - t0.clientY;
      pinchRef.current = {
        active: true,
        startDist: Math.hypot(dx, dy),
        startZoom: previewZoomRef.current,
        cx: (t0.clientX + t1.clientX) / 2,
        cy: (t0.clientY + t1.clientY) / 2,
      };
      previewDragRef.current.active = false;
      setPreviewDragging(true);
    } else if (e.touches.length === 1) {
      const now = Date.now();
      const x = e.touches[0].clientX;
      const y = e.touches[0].clientY;
      const prev = doubleTapRef.current;
      if (now - prev.lastTap < 300 && Math.hypot(x - prev.x, y - prev.y) < 30) {
        e.preventDefault();
        setPreviewZoomLevel(previewZoomRef.current > 1.01 ? 1 : 2.5);
        doubleTapRef.current.lastTap = 0;
      } else {
        doubleTapRef.current = { lastTap: now, x, y };
      }
    }
  };

  const handleCanvasTouchMove = (e: React.TouchEvent) => {
    if (!pinchRef.current.active || e.touches.length < 2) return;
    e.preventDefault();
    const t0 = e.touches[0];
    const t1 = e.touches[1];
    const dx = t1.clientX - t0.clientX;
    const dy = t1.clientY - t0.clientY;
    const dist = Math.hypot(dx, dy);
    const scale = dist / pinchRef.current.startDist;
    setPreviewZoomLevel(pinchRef.current.startZoom * scale);
    const cx = (t0.clientX + t1.clientX) / 2;
    const cy = (t0.clientY + t1.clientY) / 2;
    const panDx = cx - pinchRef.current.cx;
    const panDy = cy - pinchRef.current.cy;
    if (Math.abs(panDx) > 1 || Math.abs(panDy) > 1) {
      const currentPan = previewPanRef.current;
      schedulePreviewPan({ x: currentPan.x + panDx * 0.5, y: currentPan.y + panDy * 0.5 });
      pinchRef.current.cx = cx;
      pinchRef.current.cy = cy;
    }
  };

  const handleCanvasTouchEnd = (e: React.TouchEvent) => {
    if (!pinchRef.current.active) return;
    if (e.touches.length < 2) {
      pinchRef.current.active = false;
      pinchJustEndedRef.current = true;
      setPreviewDragging(false);
      setTimeout(() => {
        pinchJustEndedRef.current = false;
      }, 400);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[10002] flex items-center justify-center p-0 md:p-6"
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {/* backdrop */}
      <div className="fixed inset-0 bg-black/68" aria-hidden="true" />
      <div
        className="product-wall-preview-panel relative flex h-dvh w-full flex-col overflow-hidden bg-surface shadow-none md:h-[94dvh] md:max-w-[1500px] md:rounded-xl md:border md:border-outline-variant/18 md:shadow-heavy-lg"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        {/* Close button — uses inline style for safe-area on iOS */}
        <button
          ref={previewCloseRef}
          type="button"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (event.detail === 0) onClose();
          }}
          style={{
            position: 'absolute',
            right: 12,
            top: 'max(12px, env(safe-area-inset-top))',
            zIndex: 50,
            touchAction: 'manipulation',
          }}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white shadow-lg transition-colors focus:outline-none focus-visible:outline-none active:bg-black/70 md:h-9 md:w-9 md:bg-white/78 md:text-neutral-800 md:shadow-float-dark"
          aria-label={t('productWall.preview.close')}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Canvas area */}
        <div
          className={`product-wall-canvas-${canvasMode} product-wall-preview-canvas relative flex min-h-0 flex-1 items-center justify-center overflow-hidden`}
          ref={previewCanvasRef}
          style={{ touchAction: 'none' }}
          onTouchStart={handleCanvasTouchStart}
          onTouchMove={handleCanvasTouchMove}
          onTouchEnd={handleCanvasTouchEnd}
          onTouchCancel={handleCanvasTouchEnd}
        >
          <div
            className="pointer-events-none absolute inset-0 hidden scale-125 bg-cover bg-center opacity-10 blur-3xl md:block"
            style={{ backgroundImage: `url(${activePreviewImage})` }}
          />
          <button
            type="button"
            onClick={handlePreviewImageClick}
            onPointerDown={handlePreviewPointerDown}
            onPointerMove={handlePreviewPointerMove}
            onPointerUp={handlePreviewPointerUp}
            onPointerCancel={handlePreviewPointerUp}
            className={`product-wall-preview-gesture-layer relative z-10 flex h-full w-full shrink-0 touch-none items-center justify-center border-none bg-transparent p-0 focus:outline-none ${
              previewZoomed ? (previewDragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in'
            }`}
            aria-label={previewZoomed ? t('productWall.preview.restoreImage') : t('productWall.preview.zoomInImage')}
          >
            <SafeImage
              src={activeDetailImage}
              alt={active.title}
              loading="eager"
              decoding="async"
              className={`product-wall-preview-image h-full w-full object-contain md:drop-shadow-[0_16px_42px_rgba(0,0,0,0.18)] ${previewDragging ? '' : 'transition-transform duration-200 ease-out md:duration-300'}`}
              fallbackClassName="h-full w-full"
              style={{
                transform: `translate3d(${previewPan.x}px, ${previewPan.y}px, 0) scale(${previewZoom})`,
                willChange: previewZoomed ? 'transform' : undefined,
              }}
            />
          </button>
        </div>

        {/* Bottom info bar with action buttons */}
        <div
          className="product-wall-preview-info-bar relative z-20 shrink-0 border-t border-outline-variant/12 bg-surface px-4 pt-3 text-on-surface md:flex md:items-center md:justify-between md:px-5 md:py-3"
          style={{
            paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
            touchAction: 'manipulation',
            transform: 'translateZ(0)',
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onTouchStart={(event) => event.stopPropagation()}
        >
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-[0.18em] text-primary-container">{active.kind}</p>
            <h2 className="mt-1 truncate text-base font-bold md:text-lg">{active.title}</h2>
            {active.description ? (
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-on-surface-variant">{active.description}</p>
            ) : null}
          </div>
          {/* Action buttons: grid on mobile, flex row on desktop */}
          <div className="product-wall-preview-actions mt-3 grid grid-cols-4 gap-2 md:mt-0 md:flex md:shrink-0 md:items-center md:gap-1.5">
            <button
              type="button"
              onClick={togglePreviewZoom}
              className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border text-sm font-medium transition-colors md:h-9 md:w-9 md:rounded-full md:text-xs ${
                previewZoomed
                  ? 'border-primary-container/25 bg-primary-container/10 text-primary-container'
                  : 'border-outline-variant/16 bg-surface-container-low text-on-surface-variant active:bg-surface-container-high'
              }`}
              aria-label={previewZoomed ? t('productWall.preview.restore') : t('productWall.preview.zoomIn')}
            >
              <Icon name={previewZoomed ? 'zoom_out' : 'zoom_in'} size={16} />
              <span className="md:hidden">
                {previewZoomed ? t('productWall.preview.restore') : t('productWall.preview.zoomIn')}
              </span>
            </button>
            {featureFlags.favorites && (
              <button
                type="button"
                onClick={onToggleFavorite}
                className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border text-sm font-medium transition-colors md:h-9 md:w-9 md:rounded-full md:text-xs ${
                  activeFavorited
                    ? 'border-primary-container/25 bg-primary-container/10 text-primary-container'
                    : 'border-outline-variant/16 bg-surface-container-low text-on-surface-variant active:bg-surface-container-high'
                }`}
                aria-label={activeFavorited ? t('productWall.preview.unfavorite') : t('productWall.preview.favorite')}
              >
                <Icon name={activeFavorited ? 'favorite' : 'star'} size={16} />
                <span className="md:hidden">
                  {activeFavorited ? t('productWall.preview.unfavorite') : t('productWall.preview.favorite')}
                </span>
              </button>
            )}
            {featureFlags.shares && (
              <button
                type="button"
                onClick={onShare}
                className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border text-sm font-medium transition-colors md:h-9 md:w-9 md:rounded-full md:text-xs ${
                  shareState === 'copied'
                    ? 'border-primary-container/25 bg-primary-container/10 text-primary-container'
                    : 'border-outline-variant/16 bg-surface-container-low text-on-surface-variant active:bg-surface-container-high'
                }`}
                aria-label={shareState === 'copied' ? t('productWall.preview.copied') : t('productWall.preview.share')}
              >
                <Icon name={shareState === 'copied' ? 'check' : 'share'} size={16} />
                <span className="md:hidden">
                  {shareState === 'copied' ? t('productWall.preview.copied') : t('productWall.preview.share')}
                </span>
              </button>
            )}
            {featureFlags.downloads && (
              <button
                type="button"
                onClick={() => onDownload(active)}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-outline-variant/16 bg-surface-container-low text-sm font-medium text-on-surface-variant transition-colors active:bg-surface-container-high md:h-9 md:w-9 md:rounded-full md:text-xs"
                aria-label={t('productWall.preview.download')}
              >
                <Icon name="download" size={16} />
                <span className="md:hidden">{t('productWall.preview.download')}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
