import { Navigate, Outlet } from 'react-router-dom';
import { Spin } from 'antd';
import { useAuth } from './useAuth';

interface AuthGuardProps {
  requireAdmin?: boolean;
}

export default function AuthGuard({ requireAdmin = false }: AuthGuardProps) {
  const { isAuthenticated, isLoading, user } = useAuth();

  // ⚠ 这里原来写的是 Tailwind 类名（flex / min-h-screen / text-gray-500），
  // 但本项目并没有装 tailwindcss，四个类全都不生效 —— 表现是硬刷新时左上角一行 16px 黑字。
  // 现在改用 design-system.css 里真实存在的 .app-boot。
  if (isLoading) {
    return (
      <div className="app-boot" role="status" aria-live="polite">
        <div className="app-boot__inner">
          <Spin size="small" />
          <span>加载中…</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (requireAdmin && user?.role !== 'ADMIN' && user?.role !== 'SUPER_ADMIN') {
    return <Navigate to="/home" replace />;
  }

  return <Outlet />;
}
