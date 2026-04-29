import client from "./client";
import { unwrapResponse } from "./response";
import type { ApiResponse } from "../types/api";
import type { ServerModelListItem } from "./models";
import { getAccessToken } from "../stores";

export interface FavoriteItem {
  id: string;
  modelId: string;
  createdAt: string;
  model: ServerModelListItem;
}

export const favoriteApi = {
  list: async (): Promise<FavoriteItem[]> => {
    const res = await client.get<ApiResponse<FavoriteItem[]>>("/favorites");
    return unwrapResponse<FavoriteItem[]>(res);
  },

  add: async (modelId: string): Promise<void> => {
    await client.post(`/models/${modelId}/favorite`);
  },

  remove: async (modelId: string): Promise<void> => {
    await client.delete(`/models/${modelId}/favorite`);
  },

  batchRemove: async (modelIds: string[]): Promise<{ removed: number }> => {
    const res = await client.post("/favorites/batch-remove", { modelIds });
    return unwrapResponse<{ removed: number }>(res);
  },

  batchDownloadUrl: "/api/favorites/batch-download",

  batchDownload: async (modelIds: string[], format: string = "gltf"): Promise<void> => {
    const token = getAccessToken();
    const resp = await fetch(favoriteApi.batchDownloadUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ modelIds, format }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: "下载失败" }));
      throw new Error(err.detail || "下载失败");
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const disposition = resp.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="?([^";\n]+)"?/);
    a.download = match ? match[1] : `favorites_${Date.now()}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  },
};
