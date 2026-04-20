import client from "./client";
import { getAccessToken } from "../stores/useAuthStore";

export interface DownloadHistoryItem {
  id: string;
  modelId: string;
  format: string;
  fileSize: number;
  createdAt: string;
  model: {
    model_id: string;
    name: string;
    format: string;
    thumbnail_url: string | null;
    gltf_size: number;
  } | null;
}

export const downloadsApi = {
  list: async (): Promise<DownloadHistoryItem[]> => {
    const { data: resp } = await client.get("/downloads");
    const d = resp?.data;
    if (Array.isArray(d)) return d;
    if (d?.data && Array.isArray(d.data)) return d.data;
    if (Array.isArray(resp)) return resp;
    return [];
  },

  deleteOne: async (id: string) => {
    await client.delete(`/downloads/${id}`);
  },

  batchDelete: async (ids: string[]) => {
    await client.post("/downloads/batch-delete", { ids });
  },

  clearAll: async () => {
    await client.delete("/downloads/clear");
  },

  /** Download file with auth token */
  downloadFile: async (modelId: string, format?: string) => {
    const token = getAccessToken();
    const url = `/api/models/${modelId}/download?format=${format || "original"}&no_record=1`;
    const res = await fetch(url, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.message || body?.detail || "下载失败");
    }
    const blob = await res.blob();
    const cd = res.headers.get("content-disposition");
    const match = cd?.match(/filename"?(.+?)"?$/);
    const filename = match?.[1] || `${modelId}.step`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  },
};
