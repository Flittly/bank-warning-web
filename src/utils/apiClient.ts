import { getAccessToken } from '../auth/tokenManager';

const PUBLIC_PATHS = ['/v0/auth/login', '/v0/auth/register'];

export function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function setupAuthInterceptor(): void {
  const originalFetch = window.fetch;

  window.fetch = function (input: RequestInfo, init?: RequestInit): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();

    if (!url.startsWith('/v0/')) {
      return originalFetch(input, init);
    }

    const isPublic = PUBLIC_PATHS.some((path) => url.includes(path));
    if (isPublic) {
      return originalFetch(input, init);
    }

    const token = getAccessToken();
    if (!token) {
      return originalFetch(input, init);
    }

    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${token}`);

    return originalFetch(input, { ...init, headers });
  };

  console.log('[apiClient] 全局 fetch 鉴权拦截器已安装');
}
