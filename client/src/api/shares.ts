import client from "./client";
import type { ApiResponse } from "../types/api";

export interface ShareLink {
  id: string;
  token: string;
  url: string;
  expiresAt: string | null;
  hasPassword: boolean;
}

export const shareApi = {
  create: async (modelId: string, options?: { password?: string; expiresInHours?: number }): Promise<ShareLink> => {
    const { data: resp } = await client.post<ApiResponse<ShareLink>>(`/models/${modelId}/share`, options || {});
    return resp.data?.data ?? resp.data ?? resp;
  },

  getByToken: async (token: string, password?: string): Promise<any> => {
    const { data: resp } = await client.get<ApiResponse<any>>(`/share/${token}`, {
      params: password ? { password } : undefined,
    });
    return resp.data?.data ?? resp.data ?? resp;
  },

  list: async (modelId: string): Promise<ShareLink[]> => {
    const { data: resp } = await client.get<ApiResponse<ShareLink[]>>(`/models/${modelId}/shares`);
    return resp.data?.data ?? resp.data ?? resp;
  },

  revoke: async (shareId: string): Promise<void> => {
    await client.delete(`/shares/${shareId}`);
  },
};
