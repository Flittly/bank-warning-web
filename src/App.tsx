import { Routes, Route, Outlet, useNavigate, useLocation, useParams, useSearchParams, Navigate } from 'react-router-dom';
import { useState, useEffect, useRef, useMemo } from 'react';
import { HelpCircle, Menu } from 'lucide-react';
import { Button, Space, Dropdown } from 'antd';
import { UserOutlined, LogoutOutlined, LoginOutlined, SettingOutlined, SafetyCertificateOutlined, ThunderboltOutlined, HistoryOutlined, TeamOutlined } from '@ant-design/icons';
import EditorPage from './pages/EditorPage';
import ResultPage from './pages/ResultPage';
import KnowledgePage from './pages/KnowledgePage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import AdminUserPage from './pages/AdminUserPage';
import SkillApprovalsPage from './pages/SkillApprovalsPage';
import SkillSecurityPage from './pages/SkillSecurityPage';
import SkillVersionsPage from './pages/SkillVersionsPage';

const roleLabel = (role?: string) =>
  role === 'SUPER_ADMIN' ? '超级管理员' : role === 'ADMIN' ? '管理员' : '普通用户';
import AuthGuard from './auth/AuthGuard';
import { useAuth } from './auth/useAuth';
import TourGuide from './components/TourGuide';
import SettingsModal from './components/SettingsModal';
import './App.css';

function EditorPageWrapper() {
  const navigate = useNavigate();
  return <EditorPage setPage={(page, taskId) => {
    if (page === 'result') navigate(`/result/${taskId || ''}`);
    if (page === 'editor') navigate('/editor');
  }} />;
}

function ResultPageWrapper() {
  const { taskId } = useParams<{ taskId?: string }>();
  return <ResultPage initialTaskId={taskId} />;
}

// 活动栏图标（内联 SVG path，避免依赖图标库）
// ⚠ key 必须与下面 items 里的 key 一一对应：任何一个对不上，d 就是 undefined，
//   React 会渲染出一个没有 d 的 <path>，那个图标会静默变成空白（不报错、不警告）。
const ACTIVITY_ICONS: Record<string, string> = {
  editor: 'M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z',
  tasks: 'M3 5h.01M3 12h.01M3 19h.01M8 5h13M8 12h13M8 19h13',
  reports: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8',
  // 注意：合并成一条 path 后，Z 之后的点会回到子路径起点，所以原来那句相对坐标
  // `m3.3 7 8.7 5 8.7-5` 会被算到 (24.3,15) 去（越出 24x24 视口被裁掉），必须是绝对坐标 `M3.3 7`
  skills: 'M7.5 4.27l9 5.15 M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z M3.3 7l8.7 5 8.7-5 M12 22V12',
  progress: 'M3 3v18h18 M18 17V9 M13 17V5 M8 17v-3',
  knowledge: 'M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20',
};

function ActivityBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const path = location.pathname;
  const panel = searchParams.get('panel') || 'tasks';
  const isEditor = path.startsWith('/editor');
  const isKnowledge = path.startsWith('/knowledge');
  const isResult = path.startsWith('/result');

  const items = [
    { key: 'editor', label: '断面编辑器', active: isEditor, onClick: () => navigate('/editor') },
    { key: 'tasks', label: '任务列表', active: isResult && panel === 'tasks', onClick: () => navigate('/result?panel=tasks') },
    { key: 'reports', label: '报告查看', active: isResult && panel === 'reports', onClick: () => navigate('/result?panel=reports') },
    { key: 'skills', label: 'Skills', active: isResult && panel === 'skills', onClick: () => navigate('/result?panel=skills') },
    { key: 'progress', label: '计算进度', active: isResult && panel === 'progress', onClick: () => navigate('/result?panel=progress') },
    { key: 'knowledge', label: '知识库', active: isKnowledge, onClick: () => navigate('/knowledge') },
  ];

  return (
    <div className="activity-bar" data-tour="activity-bar">
      {items.map((it) => (
        <button key={it.key} type="button" className={`activity-btn ${it.active ? 'active' : ''}`} onClick={it.onClick} title={it.label} data-tour={`activity-${it.key}`}>
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={it.active ? '#2563eb' : '#334155'} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d={ACTIVITY_ICONS[it.key]} />
          </svg>
        </button>
      ))}
    </div>
  );
}

function AppLayout() {
  const navigate = useNavigate();
  const { user, isAuthenticated, isLoading, logout } = useAuth();
  const [showTour, setShowTour] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
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
    navigate('/login');
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
        key: 'settings',
        icon: <SettingOutlined />,
        label: '设置',
        onClick: () => setShowSettings(true),
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
        key: 'skillSecurity',
        icon: <ThunderboltOutlined />,
        label: 'Skill 安全档位',
        onClick: () => navigate('/admin/skill-security'),
      });
      items.unshift({
        key: 'skillVersions',
        icon: <HistoryOutlined />,
        label: 'Skill 版本与隔离',
        onClick: () => navigate('/admin/skill-versions'),
      });
      items.unshift({
        key: 'admin',
        icon: <TeamOutlined />,
        label: '用户管理',
        onClick: () => navigate('/admin/users'),
      });
    }
    return items;
  }, [user?.role, navigate]);

  return (
    <div className="app-container">
      <div className="main-nav">
        <div className="nav-logo" onClick={() => navigate('/editor')}>
          <img src="/logo.png" alt="YRBC-IRAP" width="48" height="40" style={{ flexShrink: 0, objectFit: 'contain' }} />
          <div className="nav-titles">
            <span className="nav-title">长江崩岸重点险工段智能风险评估应用平台</span>
            <span className="nav-title-en">Yangtze River Bank Collapse Key Hazard Section Intelligent Risk Assessment Platform</span>
          </div>
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
                      data-tour="nav-menu"
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
      <div className="app-body">
        <ActivityBar />
        <main className="app-main">
          <Outlet />
        </main>
      </div>
      {showSettings && (
        <SettingsModal
          username={user?.username}
          roleLabel={roleLabel(user?.role)}
          onClose={() => setShowSettings(false)}
          onReplayTour={() => {
            setShowSettings(false);
            localStorage.removeItem('tour-seen');
            setShowTour(true);
          }}
        />
      )}
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
        <Route index element={<Navigate to="/editor" replace />} />
        <Route element={<AppLayout />}>
          <Route path="/editor" element={<EditorPageWrapper />} />
          <Route path="/result" element={<ResultPageWrapper />} />
          <Route path="/result/:taskId" element={<ResultPageWrapper />} />
          <Route path="/knowledge" element={<KnowledgePage />} />
        </Route>
        <Route element={<AuthGuard requireAdmin />}>
          <Route path="/admin/users" element={<AdminUserPage />} />
          <Route path="/admin/skill-approvals" element={<SkillApprovalsPage />} />
          <Route path="/admin/skill-security" element={<SkillSecurityPage />} />
          <Route path="/admin/skill-versions" element={<SkillVersionsPage />} />
        </Route>
      </Route>
    </Routes>
  );
}

export default App;
