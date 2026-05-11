import client from './client';
import { unwrapResponse } from './response';

export interface InquiryItem {
  id: string;
  inquiryId: string;
  productId?: string | null;
  productName: string;
  modelNo?: string | null;
  specs?: Record<string, string> | null;
  qty: number;
  unit?: string | null;
  remark?: string | null;
}

export interface InquiryMessage {
  id: string;
  inquiryId: string;
  content: string;
  attachment?: string | null;
  isAdmin: boolean;
  userId: string;
  user?: { id: string; username: string; avatar?: string | null };
  createdAt: string;
}

export interface InquirySalesPerson {
  id: string;
  username: string;
  email?: string | null;
  avatar?: string | null;
  company?: string | null;
  phone?: string | null;
  address?: string | null;
  department?: string | null;
  role?: string | null;
}

export interface InquirySalesAssignmentParams {
  assigneeId?: string | null;
  mode: 'manual' | 'default' | 'auto' | 'region' | 'channel';
  channel?: 'online' | 'offline' | '';
  region?: string;
  handoffNote?: string;
}

export interface Inquiry {
  id: string;
  userId: string;
  status: string;
  remark?: string | null;
  company?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactAddress?: string | null;
  adminRemark?: string | null;
  salesAssigneeId?: string | null;
  salesAssignee?: InquirySalesPerson | null;
  salesAssignedById?: string | null;
  salesAssignedBy?: InquirySalesPerson | null;
  salesAssignedAt?: string | null;
  salesMode?: string | null;
  salesChannel?: string | null;
  salesRegion?: string | null;
  salesHandoffNote?: string | null;
  items: InquiryItem[];
  messages?: InquiryMessage[];
  user?: {
    id: string;
    username: string;
    email: string;
    avatar?: string | null;
    company?: string | null;
    phone?: string | null;
    address?: string | null;
  };
  createdAt: string;
  updatedAt: string;
}

export interface CreateInquiryParams {
  items: Array<{
    productId?: string;
    productName?: string;
    modelNo?: string;
    specs?: Record<string, string>;
    unit?: string;
    qty?: number;
    remark?: string;
  }>;
  remark?: string;
  company?: string;
  contactName?: string;
  contactPhone?: string;
  contactAddress?: string;
}

export interface UpdateInquiryItemsParams {
  items: Array<{
    id: string;
    qty: number;
    remark?: string;
  }>;
}

// ========== User API ==========

export async function createInquiry(data: CreateInquiryParams): Promise<Inquiry> {
  const res = await client.post('/inquiries', data);
  return unwrapResponse(res);
}

export async function getMyInquiries(): Promise<Inquiry[]> {
  const res = await client.get('/inquiries');
  const data = unwrapResponse<{ items?: Inquiry[] } | Inquiry[]>(res);
  return Array.isArray(data) ? data : data?.items || [];
}

export async function getInquiry(id: string): Promise<Inquiry> {
  const res = await client.get(`/inquiries/${id}`);
  return unwrapResponse(res);
}

export async function cancelInquiry(id: string): Promise<Inquiry> {
  const res = await client.put(`/inquiries/${id}/cancel`);
  return unwrapResponse(res);
}

export async function updateInquiryItems(id: string, data: UpdateInquiryItemsParams): Promise<Inquiry> {
  const res = await client.put(`/inquiries/${id}/items`, data);
  return unwrapResponse(res);
}

export async function sendInquiryMessage(id: string, content: string, attachment?: string): Promise<InquiryMessage> {
  const res = await client.post(`/inquiries/${id}/messages`, { content, attachment });
  return unwrapResponse(res);
}

export async function uploadInquiryAttachment(id: string, file: File): Promise<{ url: string }> {
  const form = new FormData();
  form.append('file', file);
  const res = await client.post(`/inquiries/${id}/messages/upload`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return unwrapResponse(res);
}

// ========== Admin API ==========

export async function getAllInquiries(
  page = 1,
  pageSize = 20,
  status?: string,
  search?: string,
): Promise<{ total: number; page: number; pageSize: number; items: Inquiry[] }> {
  const res = await client.get('/admin/inquiries', {
    params: { page, page_size: pageSize, status, search: search || undefined },
  });
  return unwrapResponse(res);
}

export async function updateInquiryStatus(id: string, status: string): Promise<Inquiry> {
  const res = await client.put(`/admin/inquiries/${id}/status`, { status });
  return unwrapResponse(res);
}

export async function getInquirySalesCandidates(): Promise<InquirySalesPerson[]> {
  const res = await client.get('/admin/inquiries/sales-candidates');
  const data = unwrapResponse<{ items?: InquirySalesPerson[] } | InquirySalesPerson[]>(res);
  return Array.isArray(data) ? data : data?.items || [];
}

export async function assignInquirySales(id: string, data: InquirySalesAssignmentParams): Promise<Inquiry> {
  const res = await client.put(`/admin/inquiries/${id}/sales-assignment`, data);
  return unwrapResponse(res);
}

export async function deleteInquiry(id: string): Promise<{ ok: boolean }> {
  const res = await client.delete(`/admin/inquiries/${id}`);
  return unwrapResponse(res);
}
