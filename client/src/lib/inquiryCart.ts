import type { SelectionProduct } from '../api/selections';

export const INQUIRY_CART_LIMIT = 100;
export const INQUIRY_CART_CHANGED_EVENT = 'selection:inquiry-cart:changed';

const STORAGE_KEY = 'selection:inquiry-cart:v1';

export interface InquiryCartItem {
  id: string;
  productId: string;
  productName: string;
  modelNo?: string | null;
  specs?: Record<string, string> | null;
  unit?: string | null;
  image?: string | null;
  categoryId?: string | null;
  qty: number;
  remark: string;
  addedAt: string;
  updatedAt: string;
}

function stableJson(value: unknown): string {
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(',')}}`;
}

function hashString(value: string) {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function normalizeSpecs(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== null && item !== undefined)
    .map(([key, item]) => [key, String(item)] as const);
  return entries.length ? Object.fromEntries(entries) : null;
}

function normalizeItem(value: unknown): InquiryCartItem | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<InquiryCartItem>;
  const productId = String(raw.productId || '').trim();
  if (!productId) return null;

  const qty = Math.max(1, Math.floor(Number(raw.qty) || 1));
  const productName = String(raw.productName || raw.modelNo || '未知产品').trim();
  const now = new Date().toISOString();

  return {
    id: String(raw.id || productId),
    productId,
    productName,
    modelNo: raw.modelNo ? String(raw.modelNo) : null,
    specs: normalizeSpecs(raw.specs),
    unit: raw.unit ? String(raw.unit) : '个',
    image: raw.image ? String(raw.image) : null,
    categoryId: raw.categoryId ? String(raw.categoryId) : null,
    qty,
    remark: raw.remark ? String(raw.remark) : '',
    addedAt: raw.addedAt ? String(raw.addedAt) : now,
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : now,
  };
}

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function readInquiryCartItems(): InquiryCartItem[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeItem).filter(Boolean).slice(0, INQUIRY_CART_LIMIT) as InquiryCartItem[];
  } catch {
    return [];
  }
}

export function writeInquiryCartItems(items: InquiryCartItem[]): boolean {
  if (!canUseStorage()) return false;
  const normalized = items.map(normalizeItem).filter(Boolean).slice(0, INQUIRY_CART_LIMIT) as InquiryCartItem[];
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // QuotaExceededError — storage full, data not written
    return false;
  }
  window.dispatchEvent(new CustomEvent(INQUIRY_CART_CHANGED_EVENT, { detail: normalized }));
  return true;
}

export function productToInquiryCartItem(product: SelectionProduct): InquiryCartItem {
  const specs = normalizeSpecs(product.specs);
  const modelNo = product.modelNo?.trim() || null;
  const productName = product.name?.trim() || modelNo || '未知产品';
  const fingerprint = stableJson({
    productId: product.id,
    productName,
    modelNo,
    specs,
  });
  const now = new Date().toISOString();

  return {
    id: `${product.id}:${hashString(fingerprint)}`,
    productId: product.id,
    productName,
    modelNo,
    specs,
    unit: product.unit || '个',
    image: product.image || product.matchedModelThumbnail || null,
    categoryId: product.categoryId || null,
    qty: 1,
    remark: '',
    addedAt: now,
    updatedAt: now,
  };
}

export function cartItemToInquiryProduct(item: InquiryCartItem): SelectionProduct {
  return {
    id: item.productId,
    categoryId: item.categoryId || '',
    name: item.productName,
    modelNo: item.modelNo || null,
    specs: item.specs || {},
    image: item.image || null,
    unit: item.unit || '个',
    sortOrder: 0,
    isKit: false,
  };
}
