import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ProductWallItem } from '../../api/productWall';
import Icon from '../shared/Icon';
import {
  PRODUCT_WALL_EAGER_IMAGE_COUNT,
  productWallPreviewImage,
  productWallRatioValue,
  type ProductWallCanvasMode,
} from './productWallAdminUtils';

type WallItem = ProductWallItem;

export function ProductWallThumbnail({
  item,
  canvasMode,
  imageIndex,
  children,
}: {
  item: WallItem;
  canvasMode: ProductWallCanvasMode;
  imageIndex: number;
  children?: ReactNode;
}) {
  const previewSrc = productWallPreviewImage(item);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const eager = imageIndex < PRODUCT_WALL_EAGER_IMAGE_COUNT;
  const [src, setSrc] = useState(previewSrc);
  const [shouldLoad, setShouldLoad] = useState(eager);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setSrc(previewSrc);
    setShouldLoad(eager);
    setLoaded(false);
    setFailed(false);
  }, [eager, previewSrc, item.id]);

  useEffect(() => {
    if (shouldLoad) return;
    const node = surfaceRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setShouldLoad(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setShouldLoad(true);
        observer.disconnect();
      },
      { rootMargin: '420px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [item.id, shouldLoad]);

  return (
    <div
      ref={surfaceRef}
      className={`product-wall-image-surface product-wall-canvas-${canvasMode} relative overflow-hidden rounded-xl`}
      style={{ aspectRatio: productWallRatioValue(item.ratio) }}
    >
      {!loaded && !failed && <div className="product-wall-image-placeholder" aria-hidden />}
      {failed ? (
        <div className="flex h-full w-full items-center justify-center text-on-surface-variant/35">
          <Icon name="image" size={22} />
        </div>
      ) : shouldLoad ? (
        <img
          src={src}
          alt={item.title}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={eager ? 'high' : 'low'}
          className={`product-wall-thumb relative z-10 block h-full w-full object-contain align-middle transition duration-200 group-hover:brightness-[0.96] ${
            loaded ? 'opacity-100' : 'opacity-0'
          }`}
          onLoad={() => {
            window.requestAnimationFrame(() => setLoaded(true));
          }}
          onError={() => {
            if (src !== item.image) {
              setLoaded(false);
              setSrc(item.image);
              return;
            }
            setFailed(true);
          }}
        />
      ) : null}
      {children}
    </div>
  );
}
