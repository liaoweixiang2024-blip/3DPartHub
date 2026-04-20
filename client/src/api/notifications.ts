import client from "./client";

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  relatedId: string | null;
  createdAt: string;
}

function unwrap<T>(res: { data: unknown }): T {
  const d = res.data as any;
  if (d && typeof d === 'object' && 'data' in d) return d.data as T;
  return d as T;
}

export async function getNotifications(page = 1, pageSize = 20) {
  const res = await client.get(`/notifications?page=${page}&page_size=${pageSize}`);
  return unwrap<{ data: Notification[]; total: number }>(res);
}

export async function getUnreadCount() {
  try {
    const res = await client.get("/notifications/unread-count");
    const d = res.data as any;
    const inner = d?.data ?? d;
    return (inner?.count ?? 0) as number;
  } catch {
    return 0;
  }
}

export async function markAsRead(id: string) {
  const res = await client.put(`/notifications/${id}/read`);
  return unwrap<any>(res);
}

export async function markAllAsRead() {
  const res = await client.put("/notifications/read-all");
  return unwrap<any>(res);
}

export async function deleteNotification(id: string) {
  const res = await client.delete(`/notifications/${id}`);
  return unwrap<{ success: boolean }>(res);
}

export async function clearReadNotifications() {
  const res = await client.delete("/notifications/read/clear");
  return unwrap<{ count: number }>(res);
}
