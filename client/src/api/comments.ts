import client from "./client";
import type { ApiResponse } from "../types/api";

export interface Comment {
  id: string;
  modelId: string;
  userId: string;
  content: string;
  position3d: { x: number; y: number; z: number } | null;
  createdAt: string;
  user: { id: string; username: string; avatar: string | null };
}

export const commentApi = {
  list: async (modelId: string): Promise<Comment[]> => {
    const { data: resp } = await client.get<ApiResponse<Comment[]>>(`/models/${modelId}/comments`);
    return resp.data?.data ?? resp.data ?? resp;
  },

  create: async (modelId: string, data: { content: string; position3d?: { x: number; y: number; z: number } }): Promise<Comment> => {
    const { data: resp } = await client.post<ApiResponse<Comment>>(`/models/${modelId}/comments`, data);
    return resp.data?.data ?? resp.data ?? resp;
  },

  delete: async (modelId: string, commentId: string): Promise<void> => {
    await client.delete(`/models/${modelId}/comments/${commentId}`);
  },
};
