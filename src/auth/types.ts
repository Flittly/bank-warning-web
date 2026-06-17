export interface LoginRequest {
  username: string;
  password: string;
}

export interface RegisterRequest {
  username: string;
  password: string;
  phone: string;
  email?: string;
  realName?: string;
}

export interface UserResponse {
  id: number;
  username: string;
  phone: string;
  email: string;
  realName: string;
  avatar: string;
  role: string;
  status: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
}

export interface AuthState {
  user: UserResponse | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}
