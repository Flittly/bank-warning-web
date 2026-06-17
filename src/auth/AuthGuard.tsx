import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './useAuth';

interface AuthGuardProps {
  requireAdmin?: boolean;
}

export default function AuthGuard({ requireAdmin = false }: AuthGuardProps) {
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (requireAdmin && user?.role !== 'ADMIN') {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
