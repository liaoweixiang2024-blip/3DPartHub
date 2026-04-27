import client from "./client";

export interface CategoryItem {
  id: string;
  name: string;
  icon: string;
  parentId: string | null;
  sortOrder: number;
  children: CategoryItem[];
}

export const categoriesApi = {
  tree: async (): Promise<{ items: CategoryItem[]; total: number }> => {
    const { data: resp } = await client.get("/categories");
    const raw = resp.data?.data ?? resp.data ?? resp;
    // Backend returns { data: [...], total: N } wrapped by responseHandler
    if (typeof raw === "object" && !Array.isArray(raw) && "data" in raw) {
      return { items: (raw as any).data ?? [], total: (raw as any).total ?? 0 };
    }
    if (Array.isArray(raw)) return { items: raw, total: 0 };
    return { items: [], total: 0 };
  },

  flat: async (): Promise<CategoryItem[]> => {
    const { data: resp } = await client.get("/categories/flat");
    return resp.data?.data ?? resp.data ?? resp;
  },

  create: async (payload: { name: string; icon?: string; parentId?: string | null; sortOrder?: number }): Promise<CategoryItem> => {
    const { data: resp } = await client.post("/categories", payload);
    return resp.data?.data ?? resp.data ?? resp;
  },

  update: async (id: string, payload: { name?: string; icon?: string; parentId?: string | null; sortOrder?: number }): Promise<CategoryItem> => {
    const { data: resp } = await client.put(`/categories/${id}`, payload);
    return resp.data?.data ?? resp.data ?? resp;
  },

  delete: async (id: string): Promise<void> => {
    await client.delete(`/categories/${id}`);
  },

  reorder: async (items: { id: string; sortOrder: number }[]): Promise<void> => {
    await client.put("/categories/reorder", { items });
  },
};
