import client from "./client";
import { unwrapResponse } from "./response";

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  relatedId: string | null;
  createdAt: string;
}

export async function getNotifications(page = 1, pageSize = 20) {
  const res = await client.get(`/notifications?page=${page}&page_size=${pageSize}`);
  return unwrapResponse<{ data: Notification[]; total: number }>(res);
}

export async function getUnreadCount() {
  try {
    const res = await client.get("/notifications/unread-count");
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
  const res = await client.put("/notifications/read-all");
  return unwrapResponse<{ success?: boolean }>(res);
}

export async function deleteNotification(id: string) {
  const res = await client.delete(`/notifications/${id}`);
  return unwrapResponse<{ success: boolean }>(res);
}

export async function clearReadNotifications() {
  const res = await client.delete("/notifications/read/clear");
  return unwrapResponse<{ count: number }>(res);
}
