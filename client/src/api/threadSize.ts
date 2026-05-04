import client from './client';
import { unwrapResponse } from './response';

export type ThreadSizeKind = 'thread' | 'pipe' | 'hose' | 'fitting';

export interface ThreadSizeEntry {
  id: string;
  kind: ThreadSizeKind;
  family?: string | null;
  hoseKind?: string | null;
  primary: string;
  secondary: string;
  meta: string;
  note: string;
  data?: unknown;
  sortOrder: number;
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export type ThreadSizeEntryInput = Omit<ThreadSizeEntry, 'createdAt' | 'updatedAt'>;

interface ThreadSizeListResponse {
  items: ThreadSizeEntry[];
}

export const threadSizeApi = {
  async listPublic() {
    return unwrapResponse<ThreadSizeListResponse>(await client.get('/thread-size'));
  },

  async listAdmin() {
    return unwrapResponse<ThreadSizeListResponse>(await client.get('/admin/thread-size'));
  },

  async create(payload: Omit<ThreadSizeEntryInput, 'id'>) {
    return unwrapResponse<ThreadSizeEntry>(await client.post('/admin/thread-size', payload));
  },

  async update(id: string, payload: Omit<ThreadSizeEntryInput, 'id'>) {
    return unwrapResponse<ThreadSizeEntry>(await client.put(`/admin/thread-size/${id}`, payload));
  },

  async remove(id: string) {
    return unwrapResponse<{ ok: boolean }>(await client.delete(`/admin/thread-size/${id}`));
  },
};
