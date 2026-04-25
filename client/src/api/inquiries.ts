import client from "./client";

export interface InquiryItem {
  id: string;
  inquiryId: string;
  productId?: string | null;
  productName: string;
  modelNo?: string | null;
  specs?: Record<string, string> | null;
  qty: number;
  unitPrice?: number | null;
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
  totalAmount?: number | null;
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

const unwrap = <T>(res: any): T => res.data?.data ?? res.data;

// ========== User API ==========

export async function createInquiry(data: CreateInquiryParams): Promise<Inquiry> {
  const res = await client.post("/inquiries", data);
  return unwrap(res);
}

export async function getMyInquiries(): Promise<Inquiry[]> {
  const res = await client.get("/inquiries");
  return unwrap(res);
}

export async function getInquiry(id: string): Promise<Inquiry> {
  const res = await client.get(`/inquiries/${id}`);
  return unwrap(res);
}

export async function cancelInquiry(id: string): Promise<Inquiry> {
  const res = await client.put(`/inquiries/${id}/cancel`);
  return unwrap(res);
}

export async function sendInquiryMessage(id: string, content: string, attachment?: string): Promise<InquiryMessage> {
  const res = await client.post(`/inquiries/${id}/messages`, { content, attachment });
  return unwrap(res);
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
  return unwrap(res);
}

export async function quoteInquiry(
  id: string,
  data: {
    items: Array<{ id: string; unitPrice: number }>;
    totalAmount?: number;
    adminRemark?: string;
  }
): Promise<Inquiry> {
  const res = await client.put(`/admin/inquiries/${id}/quote`, data);
  return unwrap(res);
}

export async function updateInquiryStatus(id: string, status: string): Promise<Inquiry> {
  const res = await client.put(`/admin/inquiries/${id}/status`, { status });
  return unwrap(res);
}
