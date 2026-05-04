import client from './client';
import { unwrapResponse } from './response';
import type { ApiResponse } from '../types/api';

export interface ProjectMember {
  id: string;
  userId: string;
  role: string;
  joinedAt: string;
  user: { id: string; username: string; avatar: string | null };
}

export interface ProjectModel {
  id: string;
  name: string | null;
  originalName: string | null;
  thumbnailUrl: string | null;
  format: string | null;
  gltfSize: number | null;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  coverImage: string | null;
  ownerId: string;
  owner: { id: string; username: string; avatar: string | null };
  members: ProjectMember[];
  models?: ProjectModel[];
  _count: { models: number };
  createdAt: string;
  updatedAt: string;
}

export const projectApi = {
  list: async (): Promise<Project[]> => {
    const res = await client.get<ApiResponse<Project[]>>('/projects');
    return unwrapResponse<Project[]>(res);
  },

  getById: async (id: string): Promise<Project> => {
    const res = await client.get<ApiResponse<Project>>(`/projects/${id}`);
    return unwrapResponse<Project>(res);
  },

  create: async (data: { name: string; description?: string }): Promise<Project> => {
    const res = await client.post<ApiResponse<Project>>('/projects', data);
    return unwrapResponse<Project>(res);
  },

  update: async (id: string, data: { name?: string; description?: string }): Promise<Project> => {
    const res = await client.put<ApiResponse<Project>>(`/projects/${id}`, data);
    return unwrapResponse<Project>(res);
  },

  delete: async (id: string): Promise<void> => {
    await client.delete(`/projects/${id}`);
  },

  addMember: async (projectId: string, userId: string, role: string = 'VIEWER'): Promise<ProjectMember> => {
    const res = await client.post<ApiResponse<ProjectMember>>(`/projects/${projectId}/members`, { userId, role });
    return unwrapResponse<ProjectMember>(res);
  },

  updateMemberRole: async (projectId: string, userId: string, role: string): Promise<ProjectMember> => {
    const res = await client.put<ApiResponse<ProjectMember>>(`/projects/${projectId}/members/${userId}`, { role });
    return unwrapResponse<ProjectMember>(res);
  },

  removeMember: async (projectId: string, userId: string): Promise<void> => {
    await client.delete(`/projects/${projectId}/members/${userId}`);
  },
};
