import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SelectionProduct } from '../api/selections';
import {
  INQUIRY_CART_CHANGED_EVENT,
  INQUIRY_CART_LIMIT,
  type InquiryCartItem,
  productToInquiryCartItem,
  readInquiryCartItems,
  writeInquiryCartItems,
} from '../lib/inquiryCart';

export function useInquiryCart() {
  const [items, setItems] = useState<InquiryCartItem[]>(() => readInquiryCartItems());

  useEffect(() => {
    const sync = () => setItems(readInquiryCartItems());
    window.addEventListener(INQUIRY_CART_CHANGED_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(INQUIRY_CART_CHANGED_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const productIds = useMemo(() => new Set(items.map((item) => item.productId)), [items]);

  const commit = useCallback((next: InquiryCartItem[]) => {
    writeInquiryCartItems(next);
    setItems(readInquiryCartItems());
  }, []);

  const addProduct = useCallback(
    (product: SelectionProduct) => {
      const current = readInquiryCartItems();
      const existingIndex = current.findIndex((item) => item.productId === product.id);
      if (existingIndex >= 0) {
        const item = productToInquiryCartItem(product);
        const next = [...current];
        next[existingIndex] = {
          ...item,
          id: current[existingIndex].id,
          qty: current[existingIndex].qty,
          remark: current[existingIndex].remark,
          addedAt: current[existingIndex].addedAt,
          updatedAt: new Date().toISOString(),
        };
        commit(next);
        return { added: false, updated: true, limitReached: false };
      }
      if (current.length >= INQUIRY_CART_LIMIT) {
        return { added: false, updated: false, limitReached: true };
      }
      commit([productToInquiryCartItem(product), ...current]);
      return { added: true, updated: false, limitReached: false };
    },
    [commit],
  );

  const removeProduct = useCallback(
    (productId: string) => {
      commit(readInquiryCartItems().filter((item) => item.productId !== productId));
    },
    [commit],
  );

  const toggleProduct = useCallback(
    (product: SelectionProduct) => {
      if (readInquiryCartItems().some((item) => item.productId === product.id)) {
        removeProduct(product.id);
        return { added: false, removed: true, updated: false, limitReached: false };
      }
      const result = addProduct(product);
      return { ...result, removed: false };
    },
    [addProduct, removeProduct],
  );

  const updateItem = useCallback(
    (id: string, patch: Partial<Pick<InquiryCartItem, 'qty' | 'remark'>>) => {
      const next = readInquiryCartItems().map((item) =>
        item.id === id
          ? {
              ...item,
              ...patch,
              qty: Math.max(1, Math.floor(Number(patch.qty ?? item.qty) || 1)),
              updatedAt: new Date().toISOString(),
            }
          : item,
      );
      commit(next);
    },
    [commit],
  );

  const removeItem = useCallback(
    (id: string) => {
      commit(readInquiryCartItems().filter((item) => item.id !== id));
    },
    [commit],
  );

  const clear = useCallback(() => commit([]), [commit]);

  return {
    items,
    productIds,
    addProduct,
    removeProduct,
    toggleProduct,
    updateItem,
    removeItem,
    clear,
    limit: INQUIRY_CART_LIMIT,
  };
}
