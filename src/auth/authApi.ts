import type { LoginRequest, RegisterRequest, LoginResponse, UserResponse } from './types';

const API_BASE = '/v0';

/**
 * 后端有两种错误报文形状，取消息时要都兜：
 * - 嵌套 `{ error: { code, message, details } }`：ApiExceptionHandler（校验失败、401、403、405…）
 * - 扁平 `{ code, message }`：security 模块的 GlobalExceptionHandler（用户不存在 / 凭证错 / 无权）
 * 只读扁平那份时，登录密码错会显示「登录失败 (500)」——原因被丢掉。
 */
type ApiErrorBody = {
  message?: unknown;
  error?: { code?: unknown; message?: unknown };
};

function errorMessage(body: unknown, fallback: string): string {
  const shaped = body as ApiErrorBody | null | undefined;
  const candidates = [shaped?.error?.message, shaped?.message];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate;
    }
  }
  return fallback;
}

export async function login(request: LoginRequest): Promise<LoginResponse> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(errorMessage(body, `登录失败 (${res.status})`));
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
    throw new Error(errorMessage(body, `注册失败 (${res.status})`));
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
