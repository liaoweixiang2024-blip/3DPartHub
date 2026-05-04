import type { User } from './user';

export interface Project {
  id: string;
  name: string;
  description: string;
  coverImage?: string;
  ownerId: string;
  members: ProjectMember[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMember {
  userId: string;
  user: User;
  role: 'admin' | 'editor' | 'viewer';
  joinedAt: string;
}
