import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef, useEffect, useState, type ReactNode } from 'react';

interface VirtualProductGridProps<TProduct> {
  products: TProduct[];
  columns: number;
  rowHeight: number;
  gap?: number;
  renderCard: (product: TProduct, index: number) => ReactNode;
  scrollRef: React.RefObject<HTMLElement | null>;
  gridClassName?: string;
}

const VIRTUALIZE_THRESHOLD = 80;

export default function VirtualProductGrid<TProduct>({
  products,
  columns,
  rowHeight,
  gap = 12,
  renderCard,
  scrollRef,
  gridClassName,
}: VirtualProductGridProps<TProduct>) {
  const rowCount = Math.ceil(products.length / columns);
  const totalRowHeight = rowHeight + gap;
  const parentRef = useRef<HTMLDivElement>(null);

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual useVirtualizer is safe to use un-memoized
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => totalRowHeight,
    overscan: 3,
  });

  if (products.length < VIRTUALIZE_THRESHOLD) {
    return <div className={gridClassName}>{products.map(renderCard)}</div>;
  }

  return (
    <div ref={parentRef} style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative', width: '100%' }}>
      {virtualizer.getVirtualItems().map((virtualRow) => {
        const startIdx = virtualRow.index * columns;
        const rowProducts = products.slice(startIdx, startIdx + columns);
        return (
          <div
            key={virtualRow.index}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: `${virtualRow.size}px`,
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            <div className={gridClassName} style={{ height: `${rowHeight}px` }}>
              {rowProducts.map((product, i) => renderCard(product, startIdx + i))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function useGridColumnCount(): number {
  const [cols, setCols] = useState(() => {
    if (typeof window === 'undefined') return 4;
    const w = window.innerWidth;
    if (w >= 1280) return 5;
    if (w >= 1024) return 4;
    if (w >= 768) return 3;
    return 2;
  });

  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      if (w >= 1280) setCols(5);
      else if (w >= 1024) setCols(4);
      else if (w >= 768) setCols(3);
      else setCols(2);
    };
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return cols;
}
