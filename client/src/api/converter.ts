import client from "./client";
import type { ApiResponse } from "../types/api";

export interface ConversionResponse {
  model_id: string;
  original_name: string;
  gltf_url: string;
  thumbnail_url: string;
  gltf_size: number;
  original_size: number;
  format: string;
  status: string;
  created_at: string;
}

export interface UploadOptions {
  onUploadProgress?: (event: { loaded: number; total?: number }) => void;
  categoryId?: string;
}

export const converterApi = {
  uploadAndConvert: async (file: File, options?: UploadOptions): Promise<ConversionResponse> => {
    const formData = new FormData();
    formData.append("file", file);
    if (options?.categoryId) formData.append("categoryId", options.categoryId);
    const { data: resp } = await client.post<ApiResponse<ConversionResponse>>(
      "/models/upload",
      formData,
      {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: options?.onUploadProgress,
      }
    );
    return resp.data?.data ?? resp.data ?? resp;
  },

  /** Create model from a file already on the server (after chunked upload) */
  uploadLocal: async (filePath: string, fileName: string, categoryId?: string): Promise<ConversionResponse> => {
    const { data: resp } = await client.post<ApiResponse<ConversionResponse>>(
      "/models/upload-local",
      { filePath, fileName, categoryId: categoryId || undefined },
    );
    return resp.data?.data ?? resp.data ?? resp;
  },

  deleteModel: async (modelId: string): Promise<void> => {
    await client.delete(`/models/${modelId}`);
  },
};
