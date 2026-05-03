import client from "./client";
import { unwrapResponse } from "./response";

export type ProductWallKind = string;
export type ProductWallStatus = "pending" | "approved" | "rejected";

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

interface ProductWallListResponse {
  items: ProductWallItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface ProductWallUpdateInput {
  title?: string;
  description?: string;
  kind?: ProductWallKind;
  tags?: string;
  sortOrder?: number;
}

export async function listProductWallItems(): Promise<ProductWallItem[]> {
  const res = await client.get("/product-wall", { params: { page: 1, page_size: 200 } });
  const data = unwrapResponse<ProductWallItem[] | ProductWallListResponse>(res);
  if (Array.isArray(data)) return data;

  const items = [...(data.items || [])];
  const total = Number(data.total) || items.length;
  const pageSize = Number(data.page_size) || 200;
  let page = Number(data.page) || 1;
  while (items.length < total) {
    page += 1;
    const nextRes = await client.get("/product-wall", { params: { page, page_size: pageSize } });
    const nextData = unwrapResponse<ProductWallItem[] | ProductWallListResponse>(nextRes);
    const nextItems = Array.isArray(nextData) ? nextData : nextData.items || [];
    if (!nextItems.length) break;
    items.push(...nextItems);
  }
  return items;
}

export async function listAdminProductWallItems(): Promise<ProductWallItem[]> {
  const res = await client.get("/admin/product-wall");
  return unwrapResponse<ProductWallItem[]>(res);
}

export async function listProductWallCategories(): Promise<ProductWallCategory[]> {
  const res = await client.get("/product-wall/categories");
  return unwrapResponse<ProductWallCategory[]>(res);
}

export async function listAdminProductWallCategories(): Promise<ProductWallCategory[]> {
  const res = await client.get("/admin/product-wall/categories");
  return unwrapResponse<ProductWallCategory[]>(res);
}

export async function createProductWallCategory(name: string): Promise<ProductWallCategory> {
  const res = await client.post("/admin/product-wall/categories", { name });
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
  options: { title?: string; description?: string; kind?: ProductWallKind; tags?: string; admin?: boolean } = {},
): Promise<{ items: ProductWallItem[] }> {
  const form = new FormData();
  files.forEach((file) => form.append("files", file));
  if (options.title) form.append("title", options.title);
  if (options.description) form.append("description", options.description);
  if (options.kind) form.append("kind", options.kind);
  if (options.tags) form.append("tags", options.tags);
  const res = await client.post(options.admin ? "/admin/product-wall/upload" : "/product-wall/upload", form);
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
  const res = await client.post(admin ? "/admin/product-wall/from-url" : "/product-wall/from-url", body);
  return unwrapResponse<{ item: ProductWallItem }>(res);
}

export async function reviewProductWallItem(
  id: string,
  input: { status: "approved" | "rejected"; rejectReason?: string },
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
  const res = await client.post("/admin/product-wall/batch-delete", { ids });
  return unwrapResponse<{ ok: true; deleted: number }>(res);
}

export async function listProductWallFavorites(): Promise<string[]> {
  const res = await client.get("/product-wall/favorites");
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
