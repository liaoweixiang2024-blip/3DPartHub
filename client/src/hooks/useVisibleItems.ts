import { useCallback, useEffect, useMemo, useState } from 'react';

export function useVisibleItems<T>(items: T[], batchSize = 60, resetKey?: string) {
  const [visibleCount, setVisibleCount] = useState(batchSize);

  useEffect(() => {
    setVisibleCount(batchSize);
  }, [batchSize, resetKey]);

  const visibleItems = useMemo(() => items.slice(0, visibleCount), [items, visibleCount]);
  const hasMore = visibleItems.length < items.length;
  const loadMore = useCallback(() => {
    setVisibleCount((count) => Math.min(count + batchSize, items.length));
  }, [batchSize, items.length]);

  return { visibleItems, hasMore, loadMore };
}
