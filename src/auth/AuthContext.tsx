import { createContext, useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { AuthState, UserResponse, LoginRequest, RegisterRequest } from './types';
import { login as apiLogin, register as apiRegister, getCurrentUser } from './authApi';
import { getAccessToken, setTokens, clearTokens } from './tokenManager';

export interface AuthContextType extends AuthState {
  login: (request: LoginRequest) => Promise<void>;
  register: (request: RegisterRequest) => Promise<void>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      setIsLoading(false);
      return;
    }

    getCurrentUser(token)
      .then(setUser)
      .catch(() => clearTokens())
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(async (request: LoginRequest) => {
    const { accessToken, refreshToken } = await apiLogin(request);
    setTokens(accessToken, refreshToken);
    const userInfo = await getCurrentUser(accessToken);
    setUser(userInfo);
  }, []);

  const register = useCallback(async (request: RegisterRequest) => {
    await apiRegister(request);
    const { accessToken, refreshToken } = await apiLogin({
      username: request.username,
      password: request.password,
    });
    setTokens(accessToken, refreshToken);
    const userInfo = await getCurrentUser(accessToken);
    setUser(userInfo);
  }, []);

  const logout = useCallback(() => {
    clearTokens();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
