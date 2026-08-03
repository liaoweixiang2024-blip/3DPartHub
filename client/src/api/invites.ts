import type { ApiResponse } from '../types/api';
import client from './client';
import { unwrapResponse } from './response';

export interface InviteItem {
  id: string;
  code: string;
  note: string | null;
  status: string;
  expiresAt: string | null;
  createdAt: string;
  usedAt: string | null;
  usedBy: { id: string; username: string } | null;
}

export interface AdminInviteItem extends InviteItem {
  createdBy: { id: string; username: string } | null;
}

export interface CreateInviteInput {
  note?: string;
  expiresAt?: string;
}

export const invitesApi = {
  list: async (): Promise<InviteItem[]> => {
    const res = await client.get<ApiResponse<InviteItem[]>>('/invites');
    return unwrapResponse<InviteItem[]>(res);
  },
  create: async (input: CreateInviteInput = {}): Promise<InviteItem> => {
    const res = await client.post<ApiResponse<InviteItem>>('/invites', input);
    return unwrapResponse<InviteItem>(res);
  },
  revoke: async (id: string): Promise<void> => {
    await client.delete(`/invites/${id}`);
  },
  adminList: async (): Promise<AdminInviteItem[]> => {
    const res = await client.get<ApiResponse<AdminInviteItem[]>>('/admin/invites');
    return unwrapResponse<AdminInviteItem[]>(res);
  },
};
