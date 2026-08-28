import client from './client';
import { unwrapResponse } from './response';

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  relatedId: string | null;
  actionPath?: string | null;
  createdAt: string;
}

export type NotificationReadFilter = 'all' | 'unread' | 'read';

export async function getNotifications(
  page = 1,
  pageSize = 20,
  options?: { read?: NotificationReadFilter; type?: string },
) {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (options?.read && options.read !== 'all') params.set('read', options.read);
  if (options?.type) params.set('type', options.type);
  const res = await client.get(`/notifications?${params.toString()}`);
  // ResponseHandler wraps as { success: true, data: { data: [...], total } }
  // Extract just the first data layer to preserve inner structure
  return (res.data as { data: unknown }).data as {
    data: Notification[];
    total: number;
    page: number;
    page_size: number;
  };
}

export async function getUnreadCount() {
  try {
    const res = await client.get('/notifications/unread-count');
    const inner = unwrapResponse<{ count?: number }>(res);
    return (inner?.count ?? 0) as number;
  } catch {
    return 0;
  }
}

export async function markAsRead(id: string) {
  const res = await client.put(`/notifications/${id}/read`);
  return unwrapResponse<{ success?: boolean }>(res);
}

export async function markAllAsRead() {
  const res = await client.put('/notifications/read-all');
  return unwrapResponse<{ success?: boolean }>(res);
}

export async function deleteNotification(id: string) {
  const res = await client.delete(`/notifications/${id}`);
  return unwrapResponse<{ success: boolean }>(res);
}

/** 批量删除指定通知（服务端单次上限 1000 条，返回实际删除数） */
export async function batchDeleteNotifications(ids: string[]) {
  const res = await client.delete('/notifications/batch', { data: { ids } });
  return unwrapResponse<{ count: number }>(res);
}

export async function clearReadNotifications() {
  const res = await client.delete('/notifications/read/clear');
  return unwrapResponse<{ count: number }>(res);
}
