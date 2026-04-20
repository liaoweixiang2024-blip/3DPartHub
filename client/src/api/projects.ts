import client from "./client";
import type { ApiResponse } from "../types/api";

export interface ProjectMember {
  id: string;
  userId: string;
  role: string;
  joinedAt: string;
  user: { id: string; username: string; avatar: string | null };
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  coverImage: string | null;
  ownerId: string;
  owner: { id: string; username: string; avatar: string | null };
  members: ProjectMember[];
  _count: { models: number };
  createdAt: string;
  updatedAt: string;
}

export const projectApi = {
  list: async (): Promise<Project[]> => {
    const { data: resp } = await client.get<ApiResponse<Project[]>>("/projects");
    return resp.data?.data ?? resp.data ?? resp;
  },

  getById: async (id: string): Promise<Project> => {
    const { data: resp } = await client.get<ApiResponse<Project>>(`/projects/${id}`);
    return resp.data?.data ?? resp.data ?? resp;
  },

  create: async (data: { name: string; description?: string }): Promise<Project> => {
    const { data: resp } = await client.post<ApiResponse<Project>>("/projects", data);
    return resp.data?.data ?? resp.data ?? resp;
  },

  update: async (id: string, data: { name?: string; description?: string }): Promise<Project> => {
    const { data: resp } = await client.put<ApiResponse<Project>>(`/projects/${id}`, data);
    return resp.data?.data ?? resp.data ?? resp;
  },

  delete: async (id: string): Promise<void> => {
    await client.delete(`/projects/${id}`);
  },

  addMember: async (projectId: string, userId: string, role: string = "VIEWER"): Promise<ProjectMember> => {
    const { data: resp } = await client.post<ApiResponse<ProjectMember>>(`/projects/${projectId}/members`, { userId, role });
    return resp.data?.data ?? resp.data ?? resp;
  },

  updateMemberRole: async (projectId: string, userId: string, role: string): Promise<ProjectMember> => {
    const { data: resp } = await client.put<ApiResponse<ProjectMember>>(`/projects/${projectId}/members/${userId}`, { role });
    return resp.data?.data ?? resp.data ?? resp;
  },

  removeMember: async (projectId: string, userId: string): Promise<void> => {
    await client.delete(`/projects/${projectId}/members/${userId}`);
  },
};
