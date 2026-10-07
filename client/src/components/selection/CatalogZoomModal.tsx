import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { openDocumentUrl } from '../../lib/browserDownload';
import Icon from '../shared/Icon';

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const WHEEL_FACTOR = 1.2;
const DOUBLE_TAP_SCALE = 2.5;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

interface Offset {
  x: number;
  y: number;
}

/**
 * 画册放大弹窗：图片支持滚轮缩放（朝光标位置）/ 拖拽平移 / 双指捏合 / 双击复位，
 * 头部按钮组（缩小/百分比/放大/适应窗口）；PDF 直接内嵌渲染（浏览器自带查看器有自己的缩放）。
 * 必须 portal 到 body：选型页结果卡片在 phase 内容 motion.div（transform-gpu 常驻 translateZ(0)）内，
 * 该 transform 祖先会让 fixed 以内容框为包含块——弹窗会被钉在页面里、受滚动容器裁剪遮挡。
 */
export function CatalogZoomModal({
  productTitle,
  src,
  isImage,
  onClose,
}: {
  productTitle: string;
  src: string;
  isImage: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  // 图片缩放/平移状态（每次打开弹窗重新挂载，自动回到适应窗口）
  const [scale, setScale] = useState(MIN_SCALE);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const scaleRef = useRef(scale);
  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  /** 适应窗口基准尺寸（图片原始尺寸与容器的 contain 缩放，不超过原生像素）。
   *  缩放用「布局尺寸」驱动（width/height = fit × scale）而不是 transform:scale——
   *  transform 方案会把「压到适应窗口的小图」光栅化后位图拉伸，原生 2000px 的图
   *  在 fit(约565px)×3 倍时糊成 565px 位图；布局尺寸让浏览器按最终显示尺寸
   *  重新光栅化，原生像素内始终清晰。 */
  const [fit, setFit] = useState<{ w: number; h: number } | null>(null);

  // 图片加载完成 / 容器尺寸变化时重算基准尺寸
  const computeFit = useCallback(() => {
    const el = containerRef.current;
    const img = imgRef.current;
    if (!el || !img || !img.naturalWidth || !img.naturalHeight) return;
    const ratio = Math.min(el.clientWidth / img.naturalWidth, el.clientHeight / img.naturalHeight, 1);
    setFit({ w: Math.round(img.naturalWidth * ratio), h: Math.round(img.naturalHeight * ratio) });
  }, []);

  useEffect(() => {
    if (!isImage) return;
    const el = containerRef.current;
    if (!el) return;
    computeFit();
    const ro = new ResizeObserver(computeFit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isImage, computeFit]);

  /** 把偏移限制在「缩放后图片不脱离容器」的范围内（缩放回 1 时归零复位）。
   *  布局尺寸方案下 img.offsetWidth 已是缩放后的显示尺寸，无需再乘 scale。 */
  const clampOffset = useCallback((next: Offset, nextScale: number): Offset => {
    if (nextScale <= MIN_SCALE + 1e-9) return { x: 0, y: 0 };
    const container = containerRef.current;
    const img = imgRef.current;
    if (!container || !img) return next;
    const maxX = Math.max(0, (img.offsetWidth - container.clientWidth) / 2);
    const maxY = Math.max(0, (img.offsetHeight - container.clientHeight) / 2);
    return { x: clamp(next.x, -maxX, maxX), y: clamp(next.y, -maxY, maxY) };
  }, []);

  /** 以 (clientX, clientY) 为锚点缩放到 nextScale：光标/手指下的那一点视觉上不动 */
  const zoomAt = useCallback(
    (clientX: number, clientY: number, nextScale: number) => {
      const clamped = clamp(nextScale, MIN_SCALE, MAX_SCALE);
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      // 锚点相对容器中心
      const vx = clientX - (rect.left + rect.width / 2);
      const vy = clientY - (rect.top + rect.height / 2);
      setOffset((prevOffset) => {
        const prevScale = scaleRef.current;
        const factor = clamped / prevScale;
        // 变换前图片上的点 p = (v - offset) / scale 缩放后仍落在 v 处 → offset' = v - (v - offset) * factor
        const raw: Offset = {
          x: vx - (vx - prevOffset.x) * factor,
          y: vy - (vy - prevOffset.y) * factor,
        };
        return clampOffset(raw, clamped);
      });
      setScale(clamped);
    },
    [clampOffset],
  );

  const zoomByCenter = useCallback(
    (factor: number) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, scaleRef.current * factor);
    },
    [zoomAt],
  );

  const resetZoom = useCallback(() => {
    setScale(MIN_SCALE);
    setOffset({ x: 0, y: 0 });
  }, []);

  // 滚轮缩放：React 根节点上的 wheel 监听是 passive 的（preventDefault 无效，页面会跟着滚），
  // 必须在容器上原生绑定 non-passive 监听
  useEffect(() => {
    if (!isImage) return;
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? WHEEL_FACTOR : 1 / WHEEL_FACTOR;
      const next = clamp(scaleRef.current * factor, MIN_SCALE, MAX_SCALE);
      if (next === scaleRef.current) return;
      zoomAt(event.clientX, event.clientY, next);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [isImage, zoomAt]);

  // Esc 关闭；+/- 缩放、0 复位（键盘快捷键）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      } else if (isImage && (event.key === '+' || event.key === '=')) {
        zoomByCenter(WHEEL_FACTOR);
      } else if (isImage && (event.key === '-' || event.key === '_')) {
        zoomByCenter(1 / WHEEL_FACTOR);
      } else if (isImage && event.key === '0') {
        resetZoom();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isImage, onClose, zoomByCenter, resetZoom]);

  // 指针交互：单指（scale>1 时）拖拽平移；双指捏合缩放
  const pointers = useRef(new Map<number, Offset>());
  const panStart = useRef<{ p: Offset; o: Offset } | null>(null);
  const pinchPrevDist = useRef<number | null>(null);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isImage) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      // 进入捏合：取消平移，记下初始指距
      panStart.current = null;
      setDragging(false);
      const [a, b] = [...pointers.current.values()];
      pinchPrevDist.current = Math.hypot(a.x - b.x, a.y - b.y);
    } else if (pointers.current.size === 1 && scaleRef.current > MIN_SCALE) {
      event.currentTarget.setPointerCapture(event.pointerId);
      panStart.current = { p: { x: event.clientX, y: event.clientY }, o: offset };
      setDragging(true);
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size >= 2 && pinchPrevDist.current != null) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const ratio = dist / pinchPrevDist.current;
      pinchPrevDist.current = dist;
      const next = clamp(scaleRef.current * ratio, MIN_SCALE, MAX_SCALE);
      if (next !== scaleRef.current) {
        zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, next);
      }
    } else if (panStart.current) {
      const start = panStart.current;
      setOffset(
        clampOffset(
          { x: start.o.x + (event.clientX - start.p.x), y: start.o.y + (event.clientY - start.p.y) },
          scaleRef.current,
        ),
      );
    }
  };

  const onPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchPrevDist.current = null;
    if (pointers.current.size === 1) {
      // 捏合结束回到单指：以剩余手指当前位置重开平移起点
      const [rest] = [...pointers.current.values()];
      panStart.current = { p: rest, o: offset };
    } else {
      panStart.current = null;
    }
    setDragging(false);
  };

  const onDoubleClick = (event: React.MouseEvent<HTMLImageElement>) => {
    if (scaleRef.current > MIN_SCALE) {
      resetZoom();
    } else {
      zoomAt(event.clientX, event.clientY, DOUBLE_TAP_SCALE);
    }
  };

  const zoomControl = (
    <div className="flex shrink-0 items-center gap-0.5">
      <button
        onClick={() => zoomByCenter(1 / WHEEL_FACTOR)}
        disabled={scale <= MIN_SCALE}
        aria-label={t('selectionResult.zoomOut')}
        className="grid h-8 w-8 place-items-center rounded-full text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface disabled:opacity-35 disabled:hover:bg-transparent"
      >
        <Icon name="zoom_out" size={17} />
      </button>
      <span className="w-11 text-center text-xs font-medium tabular-nums text-on-surface-variant">
        {Math.round(scale * 100)}%
      </span>
      <button
        onClick={() => zoomByCenter(WHEEL_FACTOR)}
        disabled={scale >= MAX_SCALE}
        aria-label={t('selectionResult.zoomIn')}
        className="grid h-8 w-8 place-items-center rounded-full text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface disabled:opacity-35 disabled:hover:bg-transparent"
      >
        <Icon name="zoom_in" size={17} />
      </button>
      <button
        onClick={resetZoom}
        disabled={scale <= MIN_SCALE}
        aria-label={t('selectionResult.resetZoom')}
        className="grid h-8 w-8 place-items-center rounded-full text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface disabled:opacity-35 disabled:hover:bg-transparent"
      >
        <Icon name="fit_screen" size={17} />
      </button>
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 z-[320] flex items-center justify-center bg-black/70 p-3 sm:p-6" onClick={onClose}>
      {/* 近全屏：宽度上限 1280（max-w-7xl），高度贴满视口（扣除遮罩内边距）——
          图片/PDF 的可视面积都明显大于原先的 max-w-5xl + 内容自适应高 */}
      <div
        className="flex h-[calc(100dvh-1.5rem)] min-h-0 w-full max-w-7xl flex-1 flex-col overflow-hidden rounded-2xl border border-outline-variant/20 bg-surface-container-low shadow-2xl sm:h-[calc(100dvh-3rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-outline-variant/10 px-4 py-3">
          <div className="flex min-w-0 items-center gap-1.5 text-sm font-bold text-on-surface">
            <Icon name="menu_book" size={16} className="shrink-0 text-primary-container" />
            <span className="truncate">
              {productTitle} · {t('selectionResult.catalogMaterials')}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {isImage ? zoomControl : null}
            <button
              onClick={() => openDocumentUrl(src, { title: t('selectionResult.productCatalog') })}
              aria-label={t('selectionResult.productCatalog')}
              className="grid h-8 w-8 place-items-center rounded-full text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
            >
              <Icon name="open_in_new" size={16} />
            </button>
            <button
              onClick={onClose}
              aria-label={t('common.close')}
              className="grid h-8 w-8 place-items-center rounded-full text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
            >
              <Icon name="close" size={18} />
            </button>
          </div>
        </div>
        {isImage ? (
          <div
            ref={containerRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            // touch-none：捏合/拖拽自己接管手势，不让浏览器抢去滚动/页面缩放
            className={`flex min-h-0 flex-1 touch-none select-none items-center justify-center overflow-hidden bg-surface-container-lowest ${
              dragging ? 'cursor-grabbing' : scale > MIN_SCALE ? 'cursor-grab' : 'cursor-zoom-in'
            }`}
          >
            <img
              ref={imgRef}
              src={src}
              alt={t('selectionResult.catalog')}
              draggable={false}
              onDoubleClick={onDoubleClick}
              onLoad={computeFit}
              style={
                fit
                  ? {
                      width: fit.w * scale,
                      height: fit.h * scale,
                      // 掀掉 Tailwind preflight 的全局 img{max-width:100%;height:auto}：
                      // 布局尺寸放大后必然超过容器，被它钳回容器宽 = 移动端捏合缩放失效
                      maxWidth: 'none',
                      maxHeight: 'none',
                      // transform 只做平移（平移不改变光栅化尺寸），缩放交给布局尺寸
                      transform: `translate3d(${offset.x}px, ${offset.y}px, 0)`,
                      willChange: 'transform',
                    }
                  : undefined
              }
              /* fit 模式必须 shrink-0：图片是 flex 子项，放大后宽超过容器时会被默认
                 flex-shrink 压回容器宽——style.width 设了也无效（computed 不变），
                 移动端窄容器一捏合就「缩放失效」（桌面容器宽从未超出所以没暴露） */
              className={`rounded object-contain ${fit ? 'shrink-0' : 'max-h-full max-w-full'}`}
            />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-surface-container-lowest p-2 sm:p-4">
            <iframe src={src} className="h-full min-h-[60dvh] w-full rounded" title={t('selectionResult.catalogPdf')} />
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
