import { Routes, Route, Outlet, useNavigate, useLocation, useParams } from 'react-router-dom';
import { useState, useEffect, useRef, useMemo } from 'react';
import { Edit3, BarChart2, BookOpen, Cpu, HelpCircle, Menu } from 'lucide-react';
import { Button, Space, Dropdown } from 'antd';
import { UserOutlined, LogoutOutlined, LoginOutlined, SettingOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import HomePage from './pages/HomePage';
import EditorPage from './pages/EditorPage';
import ResultPage from './pages/ResultPage';
import KnowledgePage from './pages/KnowledgePage';
import SmartWorkbenchPage from './pages/SmartWorkbenchPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import AdminUserPage from './pages/AdminUserPage';
import SkillApprovalsPage from './pages/SkillApprovalsPage';

const roleLabel = (role?: string) =>
  role === 'SUPER_ADMIN' ? '超级管理员' : role === 'ADMIN' ? '管理员' : '普通用户';
import AuthGuard from './auth/AuthGuard';
import { useAuth } from './auth/useAuth';
import TourGuide from './components/TourGuide';
import './App.css';

function EditorPageWrapper() {
  const navigate = useNavigate();
  return <EditorPage setPage={(page, taskId) => {
    if (page === 'result') navigate(`/result/${taskId || ''}`);
    if (page === 'home') navigate('/');
    if (page === 'editor') navigate('/editor');
  }} />;
}

function ResultPageWrapper() {
  const { taskId } = useParams<{ taskId?: string }>();
  return <ResultPage initialTaskId={taskId} />;
}

function SmartWorkbenchPageWrapper() {
  const { taskId } = useParams<{ taskId?: string }>();
  return <SmartWorkbenchPage initialTaskId={taskId} />;
}

function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const currentPath = location.pathname;
  const { user, isAuthenticated, isLoading, logout } = useAuth();
  const [showTour, setShowTour] = useState(false);
  const tourCheckedRef = useRef(false);

  // 首次访问自动弹出新手引导
  useEffect(() => {
    if (tourCheckedRef.current) return;
    tourCheckedRef.current = true;
    if (!localStorage.getItem('tour-seen')) {
      setShowTour(true);
    }
  }, []);

  const handleTourClose = () => {
    localStorage.setItem('tour-seen', '1');
    setShowTour(false);
  };

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const dropdownItems = useMemo(() => {
    const items: any[] = [
      {
        key: 'tour',
        icon: <HelpCircle size={14} />,
        label: '新手引导',
        onClick: () => setShowTour(true),
      },
      {
        type: 'divider' as const,
      },
      {
        key: 'logout',
        icon: <LogoutOutlined />,
        label: '登出',
        danger: true,
        onClick: handleLogout,
      },
    ];
    if (user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN') {
      items.unshift({
        key: 'skillApproval',
        icon: <SafetyCertificateOutlined />,
        label: 'Skill 审批',
        onClick: () => navigate('/admin/skill-approvals'),
      });
      items.unshift({
        key: 'admin',
        icon: <SettingOutlined />,
        label: '用户管理',
        onClick: () => navigate('/admin/users'),
      });
    }
    return items;
  }, [user?.role, navigate]);

  return (
    <div className="app-container">
      <div className="main-nav">
        <div className="nav-logo" onClick={() => navigate('/')}>
          <img src="/logo.svg" alt="YRCW" width="36" height="42" style={{ flexShrink: 0 }} />
          <span>长江崩岸监测预警应用系统</span>
        </div>
        <div className="nav-tabs">
          <button
            type="button"
            className={`nav-tab ${currentPath.startsWith('/editor') ? 'active' : ''}`}
            onClick={() => navigate('/editor')}
          >
            <Edit3 size={18} />
            断面编辑器
          </button>
          <button
            type="button"
            className={`nav-tab ${currentPath.startsWith('/result') ? 'active' : ''}`}
            onClick={() => navigate('/result')}
          >
            <BarChart2 size={18} />
            结果查看器
          </button>
          <button
            type="button"
            className={`nav-tab ${currentPath.startsWith('/workbench') ? 'active' : ''}`}
            onClick={() => navigate('/workbench')}
          >
            <Cpu size={18} />
            智能工作台
          </button>
          <button
            type="button"
            className={`nav-tab ${currentPath.startsWith('/knowledge') ? 'active' : ''}`}
            onClick={() => navigate('/knowledge')}
          >
            <BookOpen size={18} />
            知识库
          </button>
        </div>
        <div className="nav-right">
              {!isLoading && (
            isAuthenticated ? (
              <div className="nav-user">
                <Space size="small">
                  <UserOutlined style={{ color: '#64748b' }} />
                  <span className="nav-username">{user?.username}</span>
                  <span
                    className="nav-role-badge"
                    style={{
                      background:
                        user?.role === 'SUPER_ADMIN'
                          ? 'rgba(245,158,11,0.12)'
                          : user?.role === 'ADMIN'
                            ? 'rgba(59,130,246,0.10)'
                            : 'rgba(100,116,139,0.08)',
                      color:
                        user?.role === 'SUPER_ADMIN'
                          ? '#d97706'
                          : user?.role === 'ADMIN'
                            ? '#3b82f6'
                            : '#64748b',
                      border:
                        user?.role === 'SUPER_ADMIN'
                          ? '1px solid rgba(245,158,11,0.25)'
                          : user?.role === 'ADMIN'
                            ? '1px solid rgba(59,130,246,0.18)'
                            : '1px solid rgba(100,116,139,0.12)',
                    }}
                  >
                    {roleLabel(user?.role)}
                  </span>
                  <Dropdown menu={{ items: dropdownItems }} placement="bottomRight" trigger={['click']}>
                    <Button
                      size="small"
                      type="text"
                      icon={<Menu size={16} />}
                    />
                  </Dropdown>
                </Space>
              </div>
            ) : (
              <div className="nav-auth">
                <Space size="small">
                  <Button
                    size="small"
                    onClick={() => navigate('/login')}
                    icon={<LoginOutlined />}
                  >
                    登录
                  </Button>
                  <Button
                    size="small"
                    type="primary"
                    onClick={() => navigate('/register')}
                  >
                    注册
                  </Button>
                </Space>
              </div>
            )
          )}
        </div>
      </div>
      <main className="app-main">
        <Outlet />
      </main>
      <TourGuide open={showTour} onClose={handleTourClose} />
    </div>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<AuthGuard />}>
        <Route index element={<HomePage />} />
        <Route element={<AppLayout />}>
          <Route path="/editor" element={<EditorPageWrapper />} />
          <Route path="/result" element={<ResultPageWrapper />} />
          <Route path="/result/:taskId" element={<ResultPageWrapper />} />
          <Route path="/workbench" element={<SmartWorkbenchPage />} />
          <Route path="/workbench/:taskId" element={<SmartWorkbenchPageWrapper />} />
          <Route path="/knowledge" element={<KnowledgePage />} />
        </Route>
        <Route element={<AuthGuard requireAdmin />}>
          <Route path="/admin/users" element={<AdminUserPage />} />
          <Route path="/admin/skill-approvals" element={<SkillApprovalsPage />} />
        </Route>
      </Route>
    </Routes>
  );
}

export default App;
