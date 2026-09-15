import client from './client';
import { unwrapResponse } from './response';

export type ProductWallKind = string;
export type ProductWallStatus = 'pending' | 'approved' | 'rejected';

export interface ProductWallCategory {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductWallItem {
  id: string;
  title: string;
  description?: string;
  kind: ProductWallKind;
  image: string;
  previewImage?: string;
  ratio: string;
  tags: string[];
  sortOrder: number;
  createdAt: string;
  status: ProductWallStatus;
  uploaderId?: string;
  reviewedAt?: string;
  reviewedBy?: string;
  rejectReason?: string;
}

export interface ProductWallListResponse {
  items: ProductWallItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface ProductWallCountsResponse {
  total: number;
  byKind: Record<string, number>;
}

export type ProductWallAdminStatusFilter = 'all' | ProductWallStatus | 'trash';

export interface ProductWallAdminListParams {
  page: number;
  pageSize: number;
  status: ProductWallAdminStatusFilter;
  kind?: ProductWallKind;
  q?: string;
}

export interface ProductWallAdminListResponse extends ProductWallListResponse {
  counts: { all: number; pending: number; approved: number; rejected: number; trash: number };
}

export interface ProductWallUpdateInput {
  title?: string;
  description?: string;
  kind?: ProductWallKind;
  tags?: string;
  sortOrder?: number;
}

export async function listProductWallItemsPage(
  page: number,
  pageSize: number,
  options: { kind?: ProductWallKind; q?: string } = {},
): Promise<ProductWallListResponse> {
  const res = await client.get('/product-wall', {
    params: {
      page,
      page_size: pageSize,
      _t: Date.now(), // 绕过浏览器 60s HTTP 缓存，保证变更后 revalidate 拿到新数据
      ...(options.kind ? { kind: options.kind } : {}),
      ...(options.q ? { q: options.q } : {}),
    },
  });
  const data = unwrapResponse<ProductWallItem[] | ProductWallListResponse>(res);
  if (Array.isArray(data)) {
    return { items: data, total: data.length, page, page_size: pageSize };
  }
  return data;
}

export async function listProductWallCounts(): Promise<ProductWallCountsResponse> {
  const res = await client.get('/product-wall/counts', { params: { _t: Date.now() } });
  return unwrapResponse<ProductWallCountsResponse>(res);
}

export async function listProductWallFavoriteItems(page: number, pageSize: number): Promise<ProductWallListResponse> {
  const res = await client.get('/product-wall/favorites/items', {
    params: { page, page_size: pageSize, _t: Date.now() },
  });
  return unwrapResponse<ProductWallListResponse>(res);
}

export async function listAdminProductWallItems(
  params: ProductWallAdminListParams,
): Promise<ProductWallAdminListResponse> {
  const res = await client.get('/admin/product-wall', {
    params: {
      page: params.page,
      page_size: params.pageSize,
      status: params.status,
      ...(params.kind ? { kind: params.kind } : {}),
      ...(params.q ? { q: params.q } : {}),
    },
  });
  return unwrapResponse<ProductWallAdminListResponse>(res);
}

export async function restoreProductWallItems(ids: string[]): Promise<{ ok: true; restored: number }> {
  const res = await client.post('/admin/product-wall/restore', { ids });
  return unwrapResponse<{ ok: true; restored: number }>(res);
}

export async function purgeProductWallItems(ids: string[]): Promise<{ ok: true; purged: number }> {
  const res = await client.post('/admin/product-wall/purge', { ids });
  return unwrapResponse<{ ok: true; purged: number }>(res);
}

export interface ProductWallUploadWhitelistUser {
  id: string;
  username: string;
  email: string;
  role: string;
  disabled: boolean;
}

export async function listProductWallUploadWhitelist(): Promise<{
  users: ProductWallUploadWhitelistUser[];
}> {
  const res = await client.get('/admin/product-wall/upload-whitelist');
  return unwrapResponse<{ users: ProductWallUploadWhitelistUser[] }>(res);
}

export async function listProductWallCategories(): Promise<ProductWallCategory[]> {
  const res = await client.get('/product-wall/categories');
  return unwrapResponse<ProductWallCategory[]>(res);
}

export async function listAdminProductWallCategories(): Promise<ProductWallCategory[]> {
  const res = await client.get('/admin/product-wall/categories');
  return unwrapResponse<ProductWallCategory[]>(res);
}

export async function createProductWallCategory(name: string): Promise<ProductWallCategory> {
  const res = await client.post('/admin/product-wall/categories', { name });
  return unwrapResponse<ProductWallCategory>(res);
}

export async function updateProductWallCategory(
  id: string,
  input: { name?: string; sortOrder?: number },
): Promise<ProductWallCategory> {
  const res = await client.put(`/admin/product-wall/categories/${id}`, input);
  return unwrapResponse<ProductWallCategory>(res);
}

export async function deleteProductWallCategory(id: string): Promise<{ ok: true }> {
  const res = await client.delete(`/admin/product-wall/categories/${id}`);
  return unwrapResponse<{ ok: true }>(res);
}

export async function uploadProductWallImages(
  files: File[],
  options: {
    title?: string;
    description?: string;
    kind?: ProductWallKind;
    tags?: string;
    admin?: boolean;
    onUploadProgress?: (event: { loaded: number; total?: number }) => void;
  } = {},
): Promise<{ items: ProductWallItem[] }> {
  const form = new FormData();
  files.forEach((file) => form.append('files', file));
  if (options.title) form.append('title', options.title);
  if (options.description) form.append('description', options.description);
  if (options.kind) form.append('kind', options.kind);
  if (options.tags) form.append('tags', options.tags);
  const res = await client.post(options.admin ? '/admin/product-wall/upload' : '/product-wall/upload', form, {
    onUploadProgress: options.onUploadProgress,
  });
  return unwrapResponse<{ items: ProductWallItem[] }>(res);
}

export async function uploadProductWallImageFromUrl(input: {
  url: string;
  title?: string;
  description?: string;
  kind?: ProductWallKind;
  tags?: string;
  admin?: boolean;
}): Promise<{ item: ProductWallItem }> {
  const { admin, ...body } = input;
  const res = await client.post(admin ? '/admin/product-wall/from-url' : '/product-wall/from-url', body);
  return unwrapResponse<{ item: ProductWallItem }>(res);
}

export async function reviewProductWallItem(
  id: string,
  input: { status: 'approved' | 'rejected'; rejectReason?: string },
): Promise<ProductWallItem> {
  const res = await client.patch(`/admin/product-wall/${id}/review`, input);
  return unwrapResponse<ProductWallItem>(res);
}

export async function updateProductWallItem(id: string, input: ProductWallUpdateInput): Promise<ProductWallItem> {
  const res = await client.put(`/admin/product-wall/${id}`, input);
  return unwrapResponse<ProductWallItem>(res);
}

export async function deleteProductWallItem(id: string): Promise<{ ok: true }> {
  const res = await client.delete(`/admin/product-wall/${id}`);
  return unwrapResponse<{ ok: true }>(res);
}

export async function deleteProductWallItems(ids: string[]): Promise<{ ok: true; deleted: number }> {
  const res = await client.post('/admin/product-wall/batch-delete', { ids });
  return unwrapResponse<{ ok: true; deleted: number }>(res);
}

export async function updateProductWallItemsKind(
  ids: string[],
  kind: ProductWallKind,
): Promise<{ ok: true; updated: number; kind: ProductWallKind }> {
  const res = await client.post('/admin/product-wall/batch-update-kind', { ids, kind });
  return unwrapResponse<{ ok: true; updated: number; kind: ProductWallKind }>(res);
}

export async function listProductWallFavorites(): Promise<string[]> {
  const res = await client.get('/product-wall/favorites');
  return unwrapResponse<string[]>(res);
}

export async function addProductWallFavorite(id: string): Promise<{ ok: true }> {
  const res = await client.post(`/product-wall/${id}/favorite`);
  return unwrapResponse<{ ok: true }>(res);
}

export async function removeProductWallFavorite(id: string): Promise<{ ok: true }> {
  const res = await client.delete(`/product-wall/${id}/favorite`);
  return unwrapResponse<{ ok: true }>(res);
}
