import client from "./client";

export interface ColumnDef {
  key: string;
  label: string;
  unit: string;
  sortType?: "thread" | "numeric" | "default";
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
  optionOrder?: Record<string, string[]> | null;
  groupId?: string | null;
  groupName?: string | null;
  groupIcon?: string | null;
  kind?: string | null;
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
  sortOrder: number;
  isKit: boolean;
  components?: SelectionComponent[] | null;
  matchedModelId?: string | null;
  matchedModelThumbnail?: string | null;
}

const unwrap = <T>(res: any): T => res.data?.data ?? res.data;

// ========== Public API ==========

export async function getSelectionCategories(): Promise<SelectionCategory[]> {
  const res = await client.get("/selections/categories");
  return unwrap(res);
}

export async function getSelectionCategory(slug: string): Promise<SelectionCategory> {
  const res = await client.get(`/selections/categories/${slug}`);
  return unwrap(res);
}

export async function getSelectionProducts(
  slug: string,
  page = 1,
  pageSize = 100,
  search = ""
): Promise<{ total: number; page: number; pageSize: number; items: SelectionProduct[] }> {
  const res = await client.get(`/selections/categories/${slug}/products`, {
    params: { page, page_size: pageSize, search: search || undefined },
  });
  return unwrap(res);
}

// ========== Admin API ==========

export async function createCategory(data: {
  name: string; slug: string; description?: string; icon?: string;
  sortOrder?: number; columns: ColumnDef[]; image?: string;
}): Promise<SelectionCategory> {
  const res = await client.post("/admin/selections/categories", data);
  return unwrap(res);
}

export async function updateCategory(id: string, data: Partial<{
  name: string; slug: string; description: string; icon: string;
  sortOrder: number; columns: ColumnDef[]; image: string;
  optionImages: Record<string, Record<string, string>>;
  optionOrder: Record<string, string[]>;
}>): Promise<SelectionCategory> {
  const res = await client.put(`/admin/selections/categories/${id}`, data);
  return unwrap(res);
}

export async function deleteCategory(id: string): Promise<void> {
  await client.delete(`/admin/selections/categories/${id}`);
}

export async function sortCategories(items: { id: string; sortOrder: number }[]): Promise<void> {
  await client.put("/admin/selections/categories-sort", { items });
}

export async function createProduct(data: {
  categoryId: string; name: string; modelNo?: string;
  specs?: Record<string, string>; image?: string; pdfUrl?: string; sortOrder?: number;
  isKit?: boolean; components?: SelectionComponent[];
}): Promise<SelectionProduct> {
  const res = await client.post("/admin/selections/products", data);
  return unwrap(res);
}

export async function updateProduct(id: string, data: Partial<{
  name: string; modelNo: string; specs: Record<string, string>;
  image: string; pdfUrl: string; sortOrder: number;
  isKit: boolean; components: SelectionComponent[];
}>): Promise<SelectionProduct> {
  const res = await client.put(`/admin/selections/products/${id}`, data);
  return unwrap(res);
}

export async function deleteProduct(id: string): Promise<void> {
  await client.delete(`/admin/selections/products/${id}`);
}

export async function batchImportProducts(
  categoryId: string,
  products: Array<{
    name: string; modelNo?: string; specs?: Record<string, string>;
    image?: string; pdfUrl?: string; isKit?: boolean; components?: SelectionComponent[];
  }>
): Promise<{ created: number }> {
  const res = await client.post("/admin/selections/products/batch", { categoryId, products });
  return unwrap(res);
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
  groupId?: string | null;
}

export async function createSelectionShare(data: {
  categorySlug: string;
  specs: Record<string, string>;
  productIds: string[];
}): Promise<SelectionShareResult> {
  const res = await client.post("/selection-shares", data);
  return unwrap(res);
}

export async function getSelectionShare(token: string): Promise<SelectionShareInfo> {
  const res = await client.get(`/selection-shares/${token}`);
  return unwrap(res);
}

export async function uploadOptionImage(file: File): Promise<{ url: string }> {
  const form = new FormData();
  form.append("file", file);
  const res = await client.post("/admin/selections/option-image", form);
  return unwrap(res);
}

export async function renameOptionValue(
  categoryId: string,
  field: string,
  oldValue: string,
  newValue: string
): Promise<{ updated: number }> {
  const res = await client.put(`/admin/selections/categories/${categoryId}/rename-option`, {
    field,
    oldValue,
    newValue,
  });
  return unwrap(res);
}
