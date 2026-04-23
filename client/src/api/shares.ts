import client from "./client";

export interface ShareLink {
  id: string;
  token: string;
  modelId?: string;
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

const unwrap = <T>(res: any): T => res.data?.data ?? res.data;

export async function createShare(params: CreateShareParams): Promise<ShareLink & { url: string }> {
  const res = await client.post("/shares", params);
  return unwrap(res);
}

export async function listShares(): Promise<ShareLink[]> {
  const res = await client.get("/shares");
  return unwrap(res);
}

export async function listModelShares(modelId: string): Promise<ShareLink[]> {
  const res = await client.get(`/models/${modelId}/shares`);
  return unwrap(res);
}

export async function deleteShare(id: string): Promise<void> {
  await client.delete(`/shares/${id}`);
}

export async function getShareInfo(token: string): Promise<ShareInfo> {
  const res = await client.get(`/shares/${token}/info`);
  return unwrap(res);
}

export async function verifySharePassword(token: string, password: string): Promise<void> {
  await client.post(`/shares/${token}/verify`, { password });
}

export function getShareDownloadUrl(token: string): string {
  return `/api/shares/${token}/download`;
}
