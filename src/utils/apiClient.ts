import { getAccessToken } from '../auth/tokenManager';

const PUBLIC_PATHS = ['/v0/auth/login', '/v0/auth/register'];

export function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function setupAuthInterceptor(): void {
  const originalFetch = window.fetch;

  // 参数必须写成 `RequestInfo | URL`：`window.fetch` 的原生签名允许传 URL 对象，
  // 只写 RequestInfo（= string | Request）会导致函数赋值不兼容（TS2322），
  // 且下面第三个分支的 input 会被 TS 收窄成 never（TS2339）。
  window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
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
