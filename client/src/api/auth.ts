import type { ApiResponse, AuthTokens, LoginRequest, RegisterRequest, User } from '../types';
import client from './client';
import { unwrapApiData, unwrapResponse } from './response';

type PasswordChangeResult = {
  message: string;
  user?: User;
  tokens?: AuthTokens;
};

export const authApi = {
  login: async (req: LoginRequest) => {
    const res = await client.post<ApiResponse<{ user: User; tokens: AuthTokens }>>('/auth/login', req);
    return unwrapResponse<{ user: User; tokens: AuthTokens }>(res);
  },

  register: async (req: RegisterRequest) => {
    const res = await client.post<ApiResponse<{ user: User; tokens: AuthTokens }>>('/auth/register', req);
    return unwrapResponse<{ user: User; tokens: AuthTokens }>(res);
  },

  refreshToken: async (refreshToken: string) => {
    const res = await client.post<ApiResponse<AuthTokens>>('/auth/refresh', { refreshToken });
    return unwrapResponse<AuthTokens>(res);
  },

  getProfile: async () => {
    const res = await client.get<ApiResponse<User>>('/auth/profile');
    return unwrapResponse<User>(res);
  },

  updateProfile: async (
    updates: Partial<
      Pick<User, 'username' | 'email' | 'avatar' | 'company' | 'phone' | 'department' | 'address' | 'bio'>
    >,
  ) => {
    const res = await client.put<ApiResponse<User>>('/auth/profile', updates);
    return unwrapResponse<User>(res);
  },

  changePassword: async (oldPassword: string, newPassword: string) => {
    const res = await client.put<ApiResponse<PasswordChangeResult>>('/auth/password', { oldPassword, newPassword });
    return unwrapResponse<PasswordChangeResult>(res);
  },

  setInitialPassword: async (newPassword: string) => {
    const res = await client.put<ApiResponse<PasswordChangeResult>>('/auth/password', { newPassword });
    return unwrapResponse<PasswordChangeResult>(res);
  },

  requestPasswordReset: async (email: string, captchaId: string, captchaText: string) => {
    const res = await client.post<ApiResponse<{ message: string }>>('/auth/forgot-password', {
      email,
      captchaId,
      captchaText,
    });
    return unwrapResponse<{ message: string }>(res);
  },

  resetPassword: async (token: string, newPassword: string) => {
    const res = await client.post<ApiResponse<{ message: string }>>('/auth/reset-password', { token, newPassword });
    return unwrapResponse<{ message: string }>(res);
  },

  getNotificationPrefs: async (): Promise<Record<string, boolean>> => {
    try {
      const { data } = await client.get('/auth/notification-prefs');
      return unwrapApiData<Record<string, boolean>>(data);
    } catch {
      return {
        ticket: true,
        inquiry: true,
        favorite: true,
        model_conversion: true,
        backup: true,
        download: false,
        email_ticket: true,
        email_inquiry: true,
        email_favorite: false,
        email_model_conversion: true,
        email_backup: true,
        email_download: false,
      };
    }
  },

  updateNotificationPrefs: async (prefs: Record<string, boolean>): Promise<Record<string, boolean>> => {
    const { data } = await client.put('/auth/notification-prefs', prefs);
    return unwrapApiData<Record<string, boolean>>(data);
  },
};
