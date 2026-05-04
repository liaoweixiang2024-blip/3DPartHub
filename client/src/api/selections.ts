import client from './client';
import { unwrapResponse } from './response';

export interface ColumnDef {
  key: string;
  label: string;
  unit: string;
  sortType?: 'thread' | 'numeric' | 'default';
  inputType?: 'select' | 'manual';
  optionDisplay?: 'auto' | 'text' | 'image';
  showCount?: boolean;
  /** undefined/true = auto confirm the only available option; false = require manual confirmation */
  autoSelectSingle?: boolean;
  skipWhenNoOptions?: boolean;
  required?: boolean;
  hideInResults?: boolean;
  legacyPlaceholder?: string;
  placeholder?: string;
  suffix?: string;
  displayOnly?: boolean;
}

export interface SelectionCategory {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  icon?: string | null;
  sortOrder: number;
  columns: ColumnDef[];
  image?: string | null;
  optionImages?: Record<string, Record<string, string>> | null;
  optionOrder?: Record<string, string[] | string> | null;
  groupId?: string | null;
  groupName?: string | null;
  groupIcon?: string | null;
  groupImage?: string | null;
  groupImageFit?: 'cover' | 'contain' | null;
  kind?: string | null;
  catalogPdf?: string | null;
  catalogShared?: boolean;
  optionCatalogs?: Record<string, Record<string, string>> | null;
  productCount?: number;
}

export interface SelectionComponent {
  name: string;
  modelNo?: string;
  qty: number;
  specs?: Record<string, string>;
}

export interface SelectionProduct {
  id: string;
  categoryId: string;
  name: string;
  modelNo?: string | null;
  specs: Record<string, string>;
  image?: string | null;
  pdfUrl?: string | null;
  unit?: string | null;
  sortOrder: number;
  isKit: boolean;
  components?: SelectionComponent[] | null;
  matchedModelId?: string | null;
  matchedModelThumbnail?: string | null;
  categoryCatalogPdf?: string | null;
}

export interface SelectionModelMatch {
  id: string;
  thumbnailUrl: string | null;
}

export interface SelectionFilterResult {
  total: number;
  page: number;
  pageSize: number;
  options: Array<{ val: string; count: number }>;
  items: SelectionProduct[];
  resolvedSpecs?: Record<string, string>;
  resolvedSkipped?: string[];
  autoAdvanced?: Array<{ field: string; value?: string; reason: 'single' | 'empty' }>;
}

// ========== Public API ==========

export async function getSelectionCategories(): Promise<SelectionCategory[]> {
  const res = await client.get('/selections/categories');
  return unwrapResponse(res);
}

export interface SelectionSearchResult {
  total: number;
  page: number;
  pageSize: number;
  items: Array<
    SelectionProduct & {
      category: {
        id: string;
        name: string;
        slug: string;
        icon: string | null;
        groupId: string | null;
        groupName: string | null;
        groupIcon: string | null;
      };
    }
  >;
}

export async function searchSelectionProducts(query: string, page = 1, pageSize = 20): Promise<SelectionSearchResult> {
  if (!query.trim()) return { total: 0, page: 1, pageSize, items: [] };
  const res = await client.get('/selections/search', {
    params: { q: query.trim(), page, page_size: pageSize },
  });
  return unwrapResponse(res);
}

export async function getSelectionCategory(slug: string): Promise<SelectionCategory> {
  const res = await client.get(`/selections/categories/${slug}`);
  return unwrapResponse(res);
}

export async function getSelectionProducts(
  slug: string,
  page = 1,
  pageSize = 100,
  search = '',
  options: { includeMatch?: boolean } = {},
): Promise<{ total: number; page: number; pageSize: number; items: SelectionProduct[] }> {
  const res = await client.get(`/selections/categories/${slug}/products`, {
    params: {
      page,
      page_size: pageSize,
      search: search || undefined,
      include_match: options.includeMatch === false ? '0' : undefined,
    },
  });
  return unwrapResponse(res);
}

export async function getSelectionModelMatches(modelNos: string[]): Promise<Record<string, SelectionModelMatch>> {
  const uniqueModelNos = Array.from(new Set(modelNos.map((item) => item.trim()).filter(Boolean))).slice(0, 500);
  if (!uniqueModelNos.length) return {};
  const res = await client.post('/selections/model-matches', { modelNos: uniqueModelNos });
  return unwrapResponse(res);
}

export async function filterSelectionProducts(
  slug: string,
  data: {
    specs?: Record<string, string>;
    field?: string | null;
    search?: string;
    skipped?: string[];
    autoAdvance?: boolean;
    page?: number;
    pageSize?: number;
    includeItems?: boolean;
  },
): Promise<SelectionFilterResult> {
  const res = await client.post(`/selections/categories/${slug}/filter`, data);
  return unwrapResponse(res);
}

// ========== Admin API ==========

export async function createCategory(data: {
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  sortOrder?: number;
  columns: ColumnDef[];
  image?: string;
  optionOrder?: Record<string, string[] | string>;
  groupId?: string | null;
  groupName?: string | null;
  groupIcon?: string | null;
  groupImage?: string | null;
  groupImageFit?: 'cover' | 'contain' | null;
}): Promise<SelectionCategory> {
  const res = await client.post('/admin/selections/categories', data);
  return unwrapResponse(res);
}

export async function updateCategory(
  id: string,
  data: Partial<{
    name: string;
    slug: string;
    description: string;
    icon: string;
    sortOrder: number;
    columns: ColumnDef[];
    image: string;
    optionImages: Record<string, Record<string, string>>;
    optionOrder: Record<string, string[] | string>;
    catalogPdf: string | null;
    catalogShared: boolean;
    optionCatalogs: Record<string, Record<string, string>>;
    groupId: string | null;
    groupName: string | null;
    groupIcon: string | null;
    groupImage: string | null;
    groupImageFit: 'cover' | 'contain' | null;
  }>,
): Promise<SelectionCategory> {
  const res = await client.put(`/admin/selections/categories/${id}`, data);
  return unwrapResponse(res);
}

export async function deleteCategory(id: string): Promise<void> {
  await client.delete(`/admin/selections/categories/${id}`);
}

export async function sortCategories(items: { id: string; sortOrder: number }[]): Promise<void> {
  await client.put('/admin/selections/categories-sort', { items });
}

export async function createProduct(data: {
  categoryId: string;
  name: string;
  modelNo?: string;
  specs?: Record<string, string>;
  image?: string;
  pdfUrl?: string;
  sortOrder?: number;
  isKit?: boolean;
  components?: SelectionComponent[];
}): Promise<SelectionProduct> {
  const res = await client.post('/admin/selections/products', data);
  return unwrapResponse(res);
}

export async function updateProduct(
  id: string,
  data: Partial<{
    name: string;
    modelNo: string;
    specs: Record<string, string>;
    image: string;
    pdfUrl: string;
    sortOrder: number;
    isKit: boolean;
    components: SelectionComponent[];
  }>,
): Promise<SelectionProduct> {
  const res = await client.put(`/admin/selections/products/${id}`, data);
  return unwrapResponse(res);
}

export async function deleteProduct(id: string): Promise<void> {
  await client.delete(`/admin/selections/products/${id}`);
}

export async function batchImportProducts(
  categoryId: string,
  products: Array<{
    name: string;
    modelNo?: string;
    specs?: Record<string, string>;
    image?: string;
    pdfUrl?: string;
    isKit?: boolean;
    components?: SelectionComponent[];
  }>,
): Promise<{ created: number; updated: number }> {
  const res = await client.post('/admin/selections/products/batch', { categoryId, products });
  return unwrapResponse(res);
}

// ========== Selection Share API ==========

export interface SelectionShareResult {
  id: string;
  token: string;
}

export interface SelectionShareInfo {
  categorySlug: string;
  categoryName: string;
  specs: Record<string, string>;
  columns: ColumnDef[];
  products: SelectionProduct[];
  optionOrder?: Record<string, string[] | string> | null;
  groupId?: string | null;
}

export async function createSelectionShare(data: {
  categorySlug: string;
  specs: Record<string, string>;
  productIds: string[];
}): Promise<SelectionShareResult> {
  const res = await client.post('/selection-shares', data);
  return unwrapResponse(res);
}

export async function getSelectionShare(token: string): Promise<SelectionShareInfo> {
  const res = await client.get(`/selection-shares/${token}`);
  return unwrapResponse(res);
}

export async function uploadOptionImage(file: File): Promise<{ url: string }> {
  const form = new FormData();
  form.append('file', file);
  const res = await client.post('/admin/selections/option-image', form);
  return unwrapResponse(res);
}

export async function uploadSelectionProductAsset(file: File): Promise<{ url: string; type: 'image' | 'pdf' }> {
  const form = new FormData();
  form.append('file', file);
  const res = await client.post('/admin/selections/product-asset', form);
  return unwrapResponse(res);
}

export async function uploadOptionImageFromUrl(url: string): Promise<{ url: string }> {
  const res = await client.post('/admin/selections/option-image-from-url', { url });
  return unwrapResponse(res);
}

export async function renameOptionValue(
  categoryId: string,
  field: string,
  oldValue: string,
  newValue: string,
): Promise<{ updated: number }> {
  const res = await client.put(`/admin/selections/categories/${categoryId}/rename-option`, {
    field,
    oldValue,
    newValue,
  });
  return unwrapResponse(res);
}
