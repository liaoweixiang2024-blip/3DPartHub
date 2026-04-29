import client from "./client";
import { unwrapResponse } from "./response";

export interface InquiryItem {
  id: string;
  inquiryId: string;
  productId?: string | null;
  productName: string;
  modelNo?: string | null;
  specs?: Record<string, string> | null;
  qty: number;
  remark?: string | null;
}

export interface InquiryMessage {
  id: string;
  content: string;
  attachment?: string | null;
  isAdmin: boolean;
  userId: string;
  user?: { id: string; username: string; avatar?: string | null };
  createdAt: string;
}

export interface Inquiry {
  id: string;
  userId: string;
  status: string;
  remark?: string | null;
  company?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  adminRemark?: string | null;
  items: InquiryItem[];
  messages?: InquiryMessage[];
  user?: { id: string; username: string; email: string; avatar?: string | null; company?: string | null; phone?: string | null };
  createdAt: string;
  updatedAt: string;
}

export interface CreateInquiryParams {
  items: Array<{
    productId?: string;
    productName?: string;
    modelNo?: string;
    qty?: number;
    remark?: string;
  }>;
  remark?: string;
  company?: string;
  contactName?: string;
  contactPhone?: string;
}

// ========== User API ==========

export async function createInquiry(data: CreateInquiryParams): Promise<Inquiry> {
  const res = await client.post("/inquiries", data);
  return unwrapResponse(res);
}

export async function getMyInquiries(): Promise<Inquiry[]> {
  const res = await client.get("/inquiries");
  return unwrapResponse(res);
}

export async function getInquiry(id: string): Promise<Inquiry> {
  const res = await client.get(`/inquiries/${id}`);
  return unwrapResponse(res);
}

export async function cancelInquiry(id: string): Promise<Inquiry> {
  const res = await client.put(`/inquiries/${id}/cancel`);
  return unwrapResponse(res);
}

export async function sendInquiryMessage(id: string, content: string, attachment?: string): Promise<InquiryMessage> {
  const res = await client.post(`/inquiries/${id}/messages`, { content, attachment });
  return unwrapResponse(res);
}

// ========== Admin API ==========

export async function getAllInquiries(
  page = 1,
  pageSize = 20,
  status?: string
): Promise<{ total: number; page: number; pageSize: number; items: Inquiry[] }> {
  const res = await client.get("/admin/inquiries", {
    params: { page, page_size: pageSize, status },
  });
  return unwrapResponse(res);
}

export async function updateInquiryStatus(id: string, status: string): Promise<Inquiry> {
  const res = await client.put(`/admin/inquiries/${id}/status`, { status });
  return unwrapResponse(res);
}
