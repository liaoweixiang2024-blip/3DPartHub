import client from "./client";
import type { ApiResponse, AuthTokens, LoginRequest, RegisterRequest, User } from "../types";

export const authApi = {
  login: async (req: LoginRequest) => {
    const { data } = await client.post<ApiResponse<{ user: User; tokens: AuthTokens }>>("/auth/login", req);
    return data.data?.data ?? data.data;
  },

  register: async (req: RegisterRequest) => {
    const { data } = await client.post<ApiResponse<{ user: User; tokens: AuthTokens }>>("/auth/register", req);
    return data.data?.data ?? data.data;
  },

  refreshToken: async (refreshToken: string) => {
    const { data } = await client.post<ApiResponse<AuthTokens>>("/auth/refresh", { refreshToken });
    return data.data?.data ?? data.data;
  },

  getProfile: async () => {
    const { data } = await client.get<ApiResponse<User>>("/auth/profile");
    return data.data?.data ?? data.data;
  },

  updateProfile: async (updates: Partial<Pick<User, 'username' | 'email' | 'company' | 'phone'>>) => {
    const { data } = await client.put<ApiResponse<User>>("/auth/profile", updates);
    return data.data?.data ?? data.data;
  },

  changePassword: async (oldPassword: string, newPassword: string) => {
    const { data } = await client.put<ApiResponse<{ message: string }>>("/auth/password", { oldPassword, newPassword });
    return data.data?.data ?? data.data;
  },

  setInitialPassword: async (newPassword: string) => {
    const { data } = await client.put<ApiResponse<{ message: string }>>("/auth/password", { newPassword });
    return data.data?.data ?? data.data;
  },

  getNotificationPrefs: async (): Promise<Record<string, boolean>> => {
    try {
      const { data } = await client.get("/auth/notification-prefs");
      const d = (data as any)?.data ?? data;
      return d as Record<string, boolean>;
    } catch {
      return { ticket: true, comment: true, favorite: true, model_conversion: true, download: false };
    }
  },

  updateNotificationPrefs: async (prefs: Record<string, boolean>): Promise<Record<string, boolean>> => {
    const { data } = await client.put("/auth/notification-prefs", prefs);
    const d = (data as any)?.data ?? data;
    return d as Record<string, boolean>;
  },
};
