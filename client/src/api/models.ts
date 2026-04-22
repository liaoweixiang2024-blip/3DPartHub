import client from "./client";
import type { PaginatedResponse, PaginationParams } from "../types";
import type { ApiResponse } from "../types/api";

export interface ServerModelListItem {
  model_id: string;
  name: string;
  format: string;
  thumbnail_url: string | null;
  gltf_url: string | null;
  file_size: number;
  original_size: number;
  category?: string;
  category_id?: string | null;
  download_count?: number;
  created_at: string;
  drawing_url?: string | null;
  group?: {
    id: string;
    name: string;
    is_primary: boolean;
    variant_count: number;
  } | null;
}

export interface ModelVariant {
  model_id: string;
  name: string;
  thumbnail_url: string | null;
  original_name: string;
  original_size: number;
  is_primary: boolean;
  created_at: string;
}

export interface ServerModelDetail {
  model_id: string;
  name?: string;
  original_name: string;
  gltf_url: string | null;
  thumbnail_url: string | null;
  gltf_size: number;
  original_size: number;
  format: string;
  status: string;
  description?: string;
  category?: string;
  category_id?: string | null;
  created_at: string;
  file_modified_at?: string | null;
  drawing_url?: string | null;
  group?: {
    id: string;
    name: string;
    variants: ModelVariant[];
  } | null;
}

export interface ServerModelListResponse {
  total: number;
  items: ServerModelListItem[];
  page: number;
  page_size: number;
}

function mapListResponse(data: ServerModelListResponse): PaginatedResponse<ServerModelListItem> {
  return {
    items: data.items,
    total: data.total,
    page: data.page,
    pageSize: data.page_size,
    totalPages: Math.ceil(data.total / (data.page_size || 20)),
  };
}

export const modelApi = {
  list: async (params?: PaginationParams & { category?: string; categoryId?: string; search?: string; format?: string; grouped?: boolean; sort?: string }): Promise<PaginatedResponse<ServerModelListItem>> => {
    const { data: resp } = await client.get("/models", {
      params: {
        page: params?.page || 1,
        page_size: params?.pageSize || 50,
        search: params?.search || undefined,
        format: params?.format || undefined,
        category: params?.category || undefined,
        category_id: params?.categoryId || undefined,
        grouped: params?.grouped ?? true,
        sort: params?.sort || undefined,
      },
    });
    const inner = resp.data?.data ?? resp.data ?? resp;
    return mapListResponse(inner);
  },

  getById: async (id: string): Promise<ServerModelDetail> => {
    const { data: resp } = await client.get(`/models/${id}`);
    return resp.data?.data ?? resp.data ?? resp;
  },

  delete: async (id: string): Promise<void> => {
    await client.delete(`/models/${id}`);
  },

  update: async (id: string, data: { name?: string; description?: string; categoryId?: string | null }): Promise<ServerModelDetail> => {
    const { data: resp } = await client.put(`/models/${id}`, data);
    return resp.data?.data ?? resp.data ?? resp;
  },

  upload: async (file: File, options?: { categoryId?: string }): Promise<{ model_id: string; status: string }> => {
    const form = new FormData();
    form.append("file", file);
    if (options?.categoryId) form.append("categoryId", options.categoryId);
    const { data: resp } = await client.post("/models/upload", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return resp.data?.data ?? resp.data ?? resp;
  },

  reconvert: async (id: string): Promise<{ model_id: string; gltf_size: number; thumbnail_url: string }> => {
    const { data: resp } = await client.post(`/models/${id}/reconvert`);
    return resp.data?.data ?? resp.data ?? resp;
  },

  replaceFile: async (id: string, file: File): Promise<{ model_id: string; status: string }> => {
    const form = new FormData();
    form.append("file", file);
    const { data: resp } = await client.post(`/models/${id}/replace-file`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return resp.data?.data ?? resp.data ?? resp;
  },

  reconvertAll: async (): Promise<{ total: number; success: number; failed: number }> => {
    const { data: resp } = await client.post("/models/reconvert-all");
    return resp.data?.data ?? resp.data ?? resp;
  },

  uploadThumbnail: async (id: string, file: File): Promise<{ model_id: string; thumbnail_url: string }> => {
    const form = new FormData();
    form.append("file", file);
    const { data: resp } = await client.post(`/models/${id}/thumbnail`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return resp.data?.data ?? resp.data ?? resp;
  },

  uploadDrawing: async (id: string, file: File): Promise<{ model_id: string; drawing_url: string }> => {
    const form = new FormData();
    form.append("file", file);
    const { data: resp } = await client.post(`/models/${id}/drawing`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return resp.data?.data ?? resp.data ?? resp;
  },

  deleteDrawing: async (id: string): Promise<void> => {
    await client.delete(`/models/${id}/drawing`);
  },

  getMergeSuggestions: async (params?: { page?: number; pageSize?: number }): Promise<{ data: { name: string; count: number; models: { id: string; name: string; thumbnailUrl: string | null; originalName: string; originalSize: number; createdAt: string }[] }[]; total: number }> => {
    const { data: resp } = await client.get("/model-groups/suggestions", {
      params: { page: params?.page || 1, page_size: params?.pageSize || 20 },
    });
    const inner = resp.data?.data ?? resp.data;
    return { data: Array.isArray(inner) ? inner : [], total: resp.data?.total ?? resp.total ?? 0 };
  },

  batchMerge: async (items: { name: string; modelIds: string[] }[]): Promise<{ merged: number }> => {
    const { data: resp } = await client.post("/model-groups/batch-merge", { items });
    const inner = resp.data?.data ?? resp.data ?? resp;
    return inner;
  },
};
