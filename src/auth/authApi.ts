import type { LoginRequest, RegisterRequest, LoginResponse, UserResponse } from './types';

const API_BASE = '/v0';

export async function login(request: LoginRequest): Promise<LoginResponse> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `登录失败 (${res.status})`);
  }

  return res.json();
}

export async function register(request: RegisterRequest): Promise<UserResponse> {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `注册失败 (${res.status})`);
  }

  return res.json();
}

export async function getCurrentUser(token: string): Promise<UserResponse> {
  const res = await fetch(`${API_BASE}/auth/user/info`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error('获取用户信息失败');
  }

  return res.json();
}

export async function logout(_token?: string): Promise<void> {
  // Best-effort server-side logout; local state is cleared by the caller.
}
