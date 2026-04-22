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

  /** Download file via direct link (no blob in memory) */
  downloadFile: async (modelId: string, format?: string) => {
    const token = getAccessToken();
    const params = new URLSearchParams({ format: format || "original", no_record: "1" });
    if (token) params.set("token", token);
    const a = document.createElement("a");
    a.href = `/api/models/${modelId}/download?${params.toString()}`;
    a.download = "";
    a.click();
  },
};
