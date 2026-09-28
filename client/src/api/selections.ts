import client from './client';
import { unwrapResponse } from './response';

export interface ColumnDef {
  key: string;
  label: string;
  unit: string;
  sortType?: 'thread' | 'numeric' | 'default';
  inputType?: 'select' | 'manual' | 'preset';
  /** manual 列的填写校验：'number' = 仅数字（可小数）；缺省 = 任意文字 */
  valueType?: 'number';
  presetOptions?: string[];
  dependsOn?: { field: string; minIndex: number };
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
  /** 隐藏的分类不显示在公开选型页、不参与选型（仅管理端可见） */
  hidden?: boolean;
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
  /** 隐藏的产品不显示在公开选型页、不参与选型（仅管理端可见） */
  hidden?: boolean;
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

export async function getSelectionCategories(options: { includeHidden?: boolean } = {}): Promise<SelectionCategory[]> {
  const res = await client.get('/selections/categories', {
    params: { include_hidden: options.includeHidden ? '1' : undefined },
  });
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
  options: { includeMatch?: boolean; includeHidden?: boolean; includeComponents?: boolean } = {},
): Promise<{ total: number; page: number; pageSize: number; items: SelectionProduct[] }> {
  const res = await client.get(`/selections/categories/${slug}/products`, {
    params: {
      page,
      page_size: pageSize,
      search: search || undefined,
      include_match: options.includeMatch === false ? '0' : undefined,
      include_hidden: options.includeHidden ? '1' : undefined,
      include_components: options.includeComponents ? '1' : undefined,
    },
  });
  return unwrapResponse(res);
}

/** 管理端单产品详情：列表接口已剔除 components，编辑弹窗按需拉全量 */
export async function getSelectionProductById(id: string): Promise<SelectionProduct> {
  const res = await client.get(`/admin/selections/products/${id}`);
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
    hidden: boolean;
  }>,
): Promise<SelectionCategory> {
  const res = await client.put(`/admin/selections/categories/${id}`, data);
  return unwrapResponse(res);
}

export async function updateSelectionGroup(
  groupId: string,
  data: Partial<{
    groupName: string | null;
    groupIcon: string | null;
    groupImage: string | null;
    groupImageFit: 'cover' | 'contain' | null;
  }>,
): Promise<{ updated: number }> {
  const res = await client.put(`/admin/selections/groups/${encodeURIComponent(groupId)}`, data);
  return unwrapResponse(res);
}

export async function deleteCategory(id: string, opts?: { force?: boolean }): Promise<void> {
  const force = opts?.force ? '?force=true' : '';
  await client.delete(`/admin/selections/categories/${id}${force}`);
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
    hidden: boolean;
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

/** 批量删除产品（单次上限 1000，不可恢复） */
export async function batchDeleteSelectionProducts(ids: string[]): Promise<{ deleted: number }> {
  const res = await client.post('/admin/selections/products/batch-delete', { ids });
  return unwrapResponse(res);
}

/** 批量设置产品隐藏/显示（hidden=true 不参与选型、仅管理端可见） */
export async function batchUpdateSelectionProductsHidden(ids: string[], hidden: boolean): Promise<{ updated: number }> {
  const res = await client.post('/admin/selections/products/batch-update-hidden', { ids, hidden });
  return unwrapResponse(res);
}

// ========== 选型分类数据包搬运（本地站 ↔ 服务器站） ==========

/** 数据包导出：勾选分类（含设置 + 产品 + 图片/PDF 资产），流式 zip 下载 */
export async function exportSelectionCategories(categoryIds: string[]): Promise<Blob> {
  const res = await client.post('/admin/selections/export', { categoryIds }, { responseType: 'blob' });
  return res.data as Blob;
}

/** 数据包导入第一步：上传 zip 解析清单（暂存，返回 importId + 分类对比） */
export async function analyzeSelectionTransfer(file: File): Promise<{
  import_id: string;
  categories: Array<{
    slug: string;
    name: string;
    product_count: number;
    exists: boolean;
    current_product_count: number;
  }>;
  assets: { total: number; missing: number };
}> {
  const form = new FormData();
  form.append('file', file);
  const res = await client.post('/admin/selections/transfer-analyze', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return unwrapResponse(res);
}

/** 数据包导入第二步：资产落盘 + 分类按 slug 覆盖更新/新建 + 产品按 modelNo 合并（不删包外产品） */
export async function commitSelectionTransfer(importId: string): Promise<{
  categories: { created: number; updated: number };
  products: { created: number; updated: number };
  assets: { restored: number; persistFailed: number };
  failed: Array<{ slug: string; reason: string }>;
}> {
  const res = await client.post('/admin/selections/transfer-commit', { importId });
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
  /** 提交工单时自动创建的快照标记，不在用户分享列表中展示 */
  autoCreated?: boolean;
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
