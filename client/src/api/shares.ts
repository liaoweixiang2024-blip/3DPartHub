import client from './client';
import { unwrapResponse } from './response';

export interface ShareLink {
  id: string;
  rawId?: string;
  type?: 'model' | 'selection';
  token: string;
  modelId?: string | null;
  modelName?: string;
  allowPreview: boolean;
  allowDownload: boolean;
  downloadLimit: number;
  downloadCount: number;
  viewCount: number;
  hasPassword: boolean;
  expiresAt: string | null;
  createdAt: string;
  url?: string;
}

export interface ShareInfo {
  id: string;
  modelName: string;
  format: string;
  fileSize: number;
  description?: string | null;
  thumbnailUrl?: string | null;
  allowPreview: boolean;
  allowDownload: boolean;
  downloadLimit: number;
  downloadCount: number;
  remainingDownloads: number;
  hasPassword: boolean;
  expiresAt: string | null;
  siteTitle: string;
  gltfUrl?: string;
}

export interface CreateShareParams {
  modelId: string;
  password?: string;
  allowPreview?: boolean;
  allowDownload?: boolean;
  downloadLimit?: number;
  expiresAt?: string;
}

export async function createShare(params: CreateShareParams): Promise<ShareLink & { url: string }> {
  const res = await client.post('/shares', params);
  return unwrapResponse(res);
}

export async function listShares(): Promise<ShareLink[]> {
  const res = await client.get('/shares');
  return unwrapResponse(res);
}

export async function listModelShares(modelId: string): Promise<ShareLink[]> {
  const res = await client.get(`/models/${modelId}/shares`);
  return unwrapResponse(res);
}

export async function deleteShare(id: string): Promise<void> {
  await client.delete(`/shares/${id}`);
}

export async function getShareInfo(token: string, accessToken?: string): Promise<ShareInfo> {
  const res = await client.get(`/shares/${token}/info`, {
    params: accessToken ? { share_access_token: accessToken } : undefined,
  });
  return unwrapResponse(res);
}

export async function verifySharePassword(
  token: string,
  password: string,
): Promise<{ accessToken?: string; expiresAt?: number }> {
  const res = await client.post(`/shares/${token}/verify`, { password });
  return unwrapResponse(res);
}

export function getShareDownloadUrl(token: string, accessToken?: string): string {
  const query = accessToken ? `?share_access_token=${encodeURIComponent(accessToken)}` : '';
  return `/api/shares/${token}/download${query}`;
}
