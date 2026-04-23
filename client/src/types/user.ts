export interface User {
  id: string;
  username: string;
  email: string;
  avatar?: string;
  role: string;
  company?: string;
  phone?: string;
  mustChangePassword?: boolean;
  createdAt?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
  emailCode: string;
  phone?: string;
  company?: string;
}
