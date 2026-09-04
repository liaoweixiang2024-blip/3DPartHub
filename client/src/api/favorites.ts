import { batchZipName } from '../lib/zipDownloadName';
import type { ApiResponse } from '../types/api';
import { downloadBatchZip, type BatchZipDownloadResult } from './batchZipDownload';
import client from './client';
import type { ServerModelListItem } from './models';
import { unwrapResponse } from './response';

export interface FavoriteItem {
  id: string;
  modelId: string;
  createdAt: string;
  model: ServerModelListItem;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

function apiUrl(path: string): string {
  return `${API_BASE_URL.replace(/\/$/, '')}${path}`;
}

export const favoriteApi = {
  list: async (): Promise<FavoriteItem[]> => {
    const res = await client.get<ApiResponse<FavoriteItem[]>>('/favorites');
    return unwrapResponse<FavoriteItem[]>(res);
  },

  add: async (modelId: string): Promise<void> => {
    await client.post(`/models/${modelId}/favorite`);
  },

  remove: async (modelId: string): Promise<void> => {
    await client.delete(`/models/${modelId}/favorite`);
  },

  batchRemove: async (modelIds: string[]): Promise<{ removed: number }> => {
    const res = await client.post('/favorites/batch-remove', { modelIds });
    return unwrapResponse<{ removed: number }>(res);
  },

  batchDownloadUrl: `${import.meta.env.VITE_API_BASE_URL || '/api'}/favorites/batch-download`,

  batchDownload: async (modelIds: string[], format: string = 'original'): Promise<BatchZipDownloadResult> => {
    return downloadBatchZip({
      url: apiUrl('/batch-download'),
      fields: { source: 'favorites', ids: modelIds, format },
      legacyUrl: favoriteApi.batchDownloadUrl,
      legacyFields: { modelIds, format },
      fallbackFileCount: modelIds.length,
      fallbackFileName: batchZipName('favorites', modelIds.length),
    });
  },
};
