export interface User {
  id: string;
  username: string;
  email: string;
  avatar?: string;
  role: string;
  company?: string;
  phone?: string;
  department?: string;
  address?: string;
  bio?: string;
  mustChangePassword?: boolean;
  createdAt?: string;
  canInvite?: boolean;
  /** 产品图库上传权限（profile 接口计算下发，设置变更后需重新拉取生效） */
  canUploadProductWall?: boolean;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
  rememberMe?: boolean;
}

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
  emailCode: string;
  phone?: string;
  company?: string;
  address?: string;
  inviteCode?: string;
}
