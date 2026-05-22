import { UPLOAD_REQUEST_TIMEOUT_MS } from '../lib/uploadLimits';
import client from './client';
import type { ModelPreviewMeta } from './models';
import { unwrapResponse } from './response';

export type TempPreviewUploadProgress = {
  loaded: number;
  total?: number;
};

export type TempPreviewResult = {
  id: string;
  name: string;
  original_name: string;
  format: string;
  original_size: number;
  gltf_url: string;
  gltf_size: number;
  expires_at: string;
  preview_meta: ModelPreviewMeta | null;
};

export const tempPreviewApi = {
  async upload(file: File, onProgress?: (event: TempPreviewUploadProgress) => void): Promise<TempPreviewResult> {
    const formData = new FormData();
    formData.append('file', file);
    const response = await client.post('/temp-preview/upload', formData, {
      timeout: UPLOAD_REQUEST_TIMEOUT_MS,
      onUploadProgress: (event) => {
        onProgress?.({ loaded: event.loaded, total: event.total || file.size });
      },
    });
    return unwrapResponse<TempPreviewResult>(response);
  },

  async remove(id: string): Promise<void> {
    await client.delete(`/temp-preview/${encodeURIComponent(id)}`);
  },
};
