import client from "./client";

export interface Ticket {
  id: string;
  userId: string;
  basePart: string | null;
  classification: string;
  description: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  user: { username: string; email: string } | null;
}

export interface TicketMessage {
  id: string;
  ticketId: string;
  userId: string;
  content: string;
  attachment: string | null;
  isAdmin: boolean;
  createdAt: string;
  user: { id: string; username: string; avatar: string | null };
}

function unwrap<T>(res: { data: unknown }): T {
  const d = res.data as any;
  if (d && typeof d === 'object' && 'data' in d) return d.data as T;
  return d as T;
}

export async function getTickets() {
  const res = await client.get("/tickets");
  return unwrap<Ticket[]>(res);
}

export async function updateTicketStatus(id: string, status: string) {
  const res = await client.put(`/tickets/${id}`, { status });
  return unwrap<any>(res);
}

export async function getTicketMessages(ticketId: string) {
  const res = await client.get(`/tickets/${ticketId}/messages`);
  return unwrap<TicketMessage[]>(res);
}

export async function sendTicketMessage(ticketId: string, content: string, attachment?: string) {
  const res = await client.post(`/tickets/${ticketId}/messages`, { content, attachment });
  return unwrap<TicketMessage>(res);
}

export async function uploadTicketAttachment(ticketId: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  const res = await client.post(`/tickets/${ticketId}/messages/upload`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return unwrap<{ url: string }>(res);
}
