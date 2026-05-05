import { getPublicSettingsSnapshot } from '../lib/publicSettings';
import { getAccessToken, useAuthStore } from '../stores/useAuthStore';
import client from './client';
import { unwrapApiData } from './response';

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

export interface DownloadAdminStats {
  summary: {
    totalModelDownloads: number;
    historyRecords: number;
    todayDownloads: number;
    weekDownloads: number;
    activeDownloaders: number;
  };
  topModels: Array<{
    model_id: string;
    name: string;
    format: string;
    thumbnail_url: string | null;
    category: string | null;
    download_count: number;
  }>;
  recentDownloads: Array<{
    id: string;
    model_id: string;
    model_name: string;
    model_format: string;
    thumbnail_url: string | null;
    user_id: string;
    username: string;
    format: string;
    file_size: number;
    created_at: string;
  }>;
  formatStats: Array<{
    format: string;
    downloads: number;
    bytes: number;
  }>;
  dailyStats: Array<{
    date: string;
    downloads: number;
    bytes: number;
  }>;
}

type DownloadHistoryResponse = DownloadHistoryItem[] | { data?: DownloadHistoryItem[] };

export class DownloadAuthRequiredError extends Error {
  constructor() {
    super('请先登录');
    this.name = 'DownloadAuthRequiredError';
  }
}

export function isDownloadAuthRequiredError(error: unknown): error is DownloadAuthRequiredError {
  return error instanceof DownloadAuthRequiredError;
}

async function requireDownloadAuth() {
  const settings = getPublicSettingsSnapshot();
  const requireLogin = settings.require_login_download;
  if (!requireLogin) return;
  const { isAuthenticated } = useAuthStore.getState();
  if (!isAuthenticated) throw new DownloadAuthRequiredError();
  if (getAccessToken()) return;
  await useAuthStore.getState().checkAndRefreshToken();
}

export async function createModelDownloadUrl(
  modelId: string,
  format = 'original',
  options: { noRecord?: boolean } = {},
): Promise<string> {
  await requireDownloadAuth();

  const { data } = await client.post('/downloads/model-token', { modelId, format });
  const created = unwrapApiData<{ token: string }>(data);
  if (!created?.token) throw new Error('创建下载令牌失败');

  const params = new URLSearchParams({
    format,
    download_token: created.token,
  });
  if (options.noRecord) params.set('no_record', '1');
  return `/api/models/${encodeURIComponent(modelId)}/download?${params.toString()}`;
}

export async function downloadModelFile(
  modelId: string,
  format = 'original',
  options: { noRecord?: boolean } = {},
): Promise<void> {
  const href = await createModelDownloadUrl(modelId, format, options);
  const a = document.createElement('a');
  a.href = href;
  a.download = '';
  a.click();
}

export async function createModelDrawingUrl(modelId: string): Promise<string> {
  await requireDownloadAuth();

  const { data } = await client.post('/downloads/drawing-token', { modelId });
  const created = unwrapApiData<{ url: string }>(data);
  if (!created?.url) throw new Error('创建图纸访问令牌失败');
  return created.url;
}

export async function openModelDrawing(modelId: string): Promise<void> {
  const opened = window.open('', '_blank', 'noopener,noreferrer');
  try {
    const url = await createModelDrawingUrl(modelId);
    if (!url.startsWith('/api/') && !url.startsWith(window.location.origin)) {
      throw new Error('Invalid download URL');
    }
    if (opened) {
      opened.location.href = url;
    } else {
      window.location.href = url;
    }
  } catch (error) {
    opened?.close();
    throw error;
  }
}

export const downloadsApi = {
  list: async (): Promise<DownloadHistoryItem[]> => {
    const { data: resp } = await client.get('/downloads');
    const data = unwrapApiData<DownloadHistoryResponse>(resp);
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.data)) return data.data;
    return [];
  },

  deleteOne: async (id: string) => {
    await client.delete(`/downloads/${id}`);
  },

  batchDelete: async (ids: string[]) => {
    await client.post('/downloads/batch-delete', { ids });
  },

  clearAll: async () => {
    await client.delete('/downloads/clear');
  },

  adminStats: async (): Promise<DownloadAdminStats> => {
    const { data: resp } = await client.get('/admin/downloads/stats');
    return unwrapApiData<DownloadAdminStats>(resp);
  },

  /** Download file via direct link (no blob in memory) */
  downloadFile: async (modelId: string, format?: string) => {
    await downloadModelFile(modelId, format || 'original', { noRecord: true });
  },
};
