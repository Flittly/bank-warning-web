import { Routes, Route, Outlet, useNavigate, useLocation, useParams, useSearchParams, Navigate } from 'react-router-dom';
import { useState, useEffect, useRef, useMemo } from 'react';
import { HelpCircle, Menu, Settings } from 'lucide-react';
import { Button, Space, Dropdown } from 'antd';
import { UserOutlined, LogoutOutlined, LoginOutlined, SettingOutlined, SafetyCertificateOutlined, ThunderboltOutlined, HistoryOutlined, TeamOutlined, HomeOutlined } from '@ant-design/icons';
import EditorPage from './pages/EditorPage';
import AiWorkspacePage from './pages/AiWorkspacePage';
import ResultPage from './pages/ResultPage';
import KnowledgePage from './pages/KnowledgePage';
import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';
import ReportsPage from './pages/ReportsPage';
import SkillsPage from './pages/SkillsPage';
import RegisterPage from './pages/RegisterPage';
import AdminUserPage from './pages/AdminUserPage';
import SkillApprovalsPage from './pages/SkillApprovalsPage';
import GlobalSearchBar from './components/GlobalSearchBar';
import { getCurrentTaskId } from './pages/editor/taskState';
import SkillSecurityPage from './pages/SkillSecurityPage';
import SkillVersionsPage from './pages/SkillVersionsPage';

const roleLabel = (role?: string) =>
  role === 'SUPER_ADMIN' ? '超级管理员' : role === 'ADMIN' ? '管理员' : '普通用户';
import AuthGuard from './auth/AuthGuard';
import { useAuth } from './auth/useAuth';
import TourGuide from './components/TourGuide';
import SettingsModal from './components/SettingsModal';
import './App.css';
import './styles/design-system.css';

function EditorPageWrapper() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  return <EditorPage initialTaskId={searchParams.get('task') || undefined} setPage={(page, taskId) => {
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
  home: 'm3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z M9 22V12h6v10',
  editor: 'M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z',
  tasks: 'M3 5h.01M3 12h.01M3 19h.01M8 5h13M8 12h13M8 19h13',
  reports: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8',
  // 注意：合并成一条 path 后，Z 之后的点会回到子路径起点，所以原来那句相对坐标
  // `m3.3 7 8.7 5 8.7-5` 会被算到 (24.3,15) 去（越出 24x24 视口被裁掉），必须是绝对坐标 `M3.3 7`
  skills: 'M7.5 4.27l9 5.15 M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z M3.3 7l8.7 5 8.7-5 M12 22V12',
  progress: 'M3 3v18h18 M18 17V9 M13 17V5 M8 17v-3',
  knowledge: 'M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20',
  // AI 助手用「机器人头」而不是星芒（Sparkles）：
  // 这一排全是块面状闭合轮廓（铅笔/列表/文件/立方体/书本），笔触在 2px 下均匀厚重；
  // 而单颗四角星中心内凹只剩 ~4px、尖角又顶到视口边缘，18px 下会显得又细又锐，
  // 摆在一起像另一个图标集里借来的。用 rect+r 圆角的机器人头，笔触语言与其余保持一致。
  // AI 页左栏的标题行（`AiWorkspacePage`）用的是同一个 lucide `Bot`（14px 线性），
  // 两处同形 —— 条带上认出是它，点进去标题还是它。
  ai: 'M12 8V4H8 M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z M2 14h2 M20 14h2 M9 13v2 M15 13v2',
};

type ActivityVariant = 'home' | 'work';

// 「中心」页：与首页同级，从首页点进去后条带必须保留（否则页面没有回到其它中心的入口）。
const CENTER_PATHS = ['/reports', '/skills', '/knowledge'];

function ActivityBar({
  variant,
  menuItems,
  onOpenSettings,
}: {
  variant: ActivityVariant;
  menuItems: any[];
  onOpenSettings: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const path = location.pathname;
  const isHome = path.startsWith('/home');
  // `/editor/ai` 是独立整页，不是编辑器的一种状态：否则条带上「断面编辑器」和「AI 助手」
  // 会同时高亮，用户判断不出自己在哪一层。
  const isAiWorkspace = path === '/editor/ai' || path.startsWith('/editor/ai/');
  const isEditor = path.startsWith('/editor') && !isAiWorkspace;
  const isResult = path.startsWith('/result');
  const isResultPanel = (key: string) => isResult && (searchParams.get('panel') || 'tasks') === key;
  // 编辑器左栏放资源还是知识库 —— 唯一真源是 URL 的 `?left=knowledge`，不进 store。
  // 存 store 会活得比 EditorPage 久：点过知识库 → 去任务列表 → 回编辑器，左栏还停在知识库。
  const editorOnKnowledge = isEditor && searchParams.get('left') === 'knowledge';

  // 工作区（编辑器 / 结果 / 知识库）恢复原来的窄图标条：条目与顺序保持基线一致，
  // 只有 title 提示，不显示文字标签，也不再挂设置与账户（这两项工作区走顶部导航的用户菜单）。
  // 注意：这里**没有**「计算进度」—— 进度已经就地显示在编辑器「执行风险分析」按钮下方，
  // 单独开一页看进度既要多跳一次、又和任务列表重复；要看结论请走「任务列表」。
  if (variant === 'work') {
    const workItems = [
      {
        key: 'editor',
        label: '断面编辑器',
        active: isEditor && !editorOnKnowledge,
        // 去掉 ?left= 即可回到资源树。已在 /editor 时只是 query 变化，不会重挂载。
        onClick: () => navigate('/editor'),
      },
      {
        key: 'ai',
        label: 'AI 助手',
        active: isAiWorkspace,
        // 带上编辑器里的当前任务作为对话上下文（`taskState` 是模块变量，读一次即可）。
        // 没有任务时不带：页面照样能进，只是工具层没有现成任务可查。
        onClick: () => {
          const taskId = getCurrentTaskId();
          navigate(`/editor/ai${taskId ? `?taskId=${encodeURIComponent(taskId)}` : ''}`);
        },
      },
      { key: 'tasks', label: '任务列表', active: isResultPanel('tasks'), onClick: () => navigate('/result?panel=tasks') },
      { key: 'reports', label: '报告查看', active: isResultPanel('reports'), onClick: () => navigate('/result?panel=reports') },
      { key: 'skills', label: 'Skills', active: isResultPanel('skills'), onClick: () => navigate('/result?panel=skills') },
      {
        key: 'knowledge',
        label: '知识库',
        active: editorOnKnowledge,
        // 以前这里 navigate('/knowledge') ⇒ 落到"中心页"、左栏整条换成 66px 悬浮卡，
        // 视觉上等于退回首页外壳，编辑器整页重挂载。现在改为编辑器左栏内的一种视图，
        // 用 ?left=knowledge 表达，刷新/分享都能还原到同一个界面。
        onClick: () => navigate('/editor?left=knowledge'),
      },
    ];

    return (
      <nav className="activity-bar" data-tour="activity-bar" aria-label="主导航">
        {workItems.map((it) => (
          <button key={it.key} type="button" className={`activity-btn ${it.active ? 'active' : ''}`} onClick={it.onClick} title={it.label} data-tour={`activity-${it.key}`}>
            <svg
              width={18}
              height={18}
              viewBox="0 0 24 24"
              fill="none"
              stroke={it.active ? '#2563eb' : '#334155'}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d={ACTIVITY_ICONS[it.key]} />
            </svg>
          </button>
        ))}
      </nav>
    );
  }

  // 起始工作台：只保留 首页 / 报告 / 技能 / 知识库 四个入口 + 底部设置与账户。
  // 标签用 2~3 个字：条带只有 66px 宽，长标签会换行把整条撑高。
  // ⚠ 这三个入口各自是独立路由（/reports、/skills、/knowledge），
  //   不能再指到 /result?panel=… —— 那样会落到结果页（地图工作区），看起来就像进了编辑器。
  const homeItems = [
    { key: 'home', label: '首页', active: isHome, onClick: () => navigate('/home') },
    { key: 'reports', label: '报告', active: path.startsWith('/reports'), onClick: () => navigate('/reports') },
    { key: 'skills', label: '技能', active: path.startsWith('/skills'), onClick: () => navigate('/skills') },
    { key: 'knowledge', label: '知识库', active: path.startsWith('/knowledge'), onClick: () => navigate('/knowledge') },
  ];

  const initial = (user?.realName || user?.username || 'U').trim().slice(0, 1).toUpperCase();

  return (
    <nav className="activity-bar activity-bar--home" data-tour="activity-bar" aria-label="主导航">
      <div className="activity-group">
        {homeItems.map((it) => (
          <button key={it.key} type="button" className={`activity-btn ${it.active ? 'active' : ''}`} onClick={it.onClick} title={it.label} data-tour={`activity-${it.key}`}>
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d={ACTIVITY_ICONS[it.key]} />
            </svg>
            <span className="activity-label">{it.label}</span>
          </button>
        ))}
      </div>
      <div className="activity-foot">
        <button type="button" className="activity-btn" onClick={onOpenSettings} title="设置" data-tour="activity-settings">
          <Settings size={18} strokeWidth={2} />
          <span className="activity-label">设置</span>
        </button>
        <Dropdown menu={{ items: menuItems }} placement="topRight" trigger={['click']}>
          <button type="button" className="activity-btn" title={user?.username || '账户'} data-tour="activity-account">
            <span className="activity-avatar">{initial}</span>
            <span className="activity-label">账户</span>
          </button>
        </Dropdown>
      </div>
    </nav>
  );
}

function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAuthenticated, isLoading, logout } = useAuth();
  const [showTour, setShowTour] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const tourCheckedRef = useRef(false);

  // 起始工作台用极简顶栏（仅 LOGO）+ 左侧条带导航；其它页面仍用完整导航栏（搜索 + 用户菜单）。
  // 用 pathname 判断而不是路由嵌套，是为了让 /home 与其它页面共用同一套导航与鉴权，
  // 避免多一个 Layout 组件走两套逻辑。
  const isHome = location.pathname.startsWith('/home');

  /**
   * 左侧栏的出现规则（三种，互斥）：
   * - `/home`、`/reports`、`/skills`、`/knowledge`
   *     → `home`：简版条带（首页/报告/技能/知识库 + 设置/账户）。
   *       这四个页面是同一层级的「中心」，从首页点进去侧栏必须留着，
   *       否则一进报告/技能/知识库就"断头"，只能靠浏览器后退回首页。
   *       KnowledgePage 自己的文档列表是页面内的第二级栏，与全局条带并存（条带 → 列表 → 正文）。
   * - `/editor`、`/result…`          → `work`：完整窄图标条，只在任务工作区里出现
   * - 其它（/admin/… 等）            → `none`：不挂任何侧栏
   */
  const isCenterPage = CENTER_PATHS.some((p) => location.pathname.startsWith(p));
  const railMode: ActivityVariant | 'none' = isHome || isCenterPage
    ? 'home'
    : location.pathname.startsWith('/editor') || location.pathname.startsWith('/result')
      ? 'work'
      : 'none';

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
        key: 'home',
        icon: <HomeOutlined />,
        label: '起始工作台',
        onClick: () => navigate('/home'),
      },
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
      {/* 起始工作台只留左上角一个 LOGO：全局搜索与用户菜单收起，
          设置与账户入口移入左侧条带（ActivityBar 底部）。 */}
      {isHome ? (
        <header className="home-topbar">
          <button type="button" className="home-brand" onClick={() => navigate('/home')} title="长江崩岸重点险工段智能风险评估应用平台">
            <img src="/logo.png" alt="长江崩岸风险评估平台" width="46" height="38" />
          </button>
        </header>
      ) : (
      <div className="main-nav">
        <div className="nav-logo" onClick={() => navigate('/home')}>
          <img src="/logo.png" alt="YRBC-IRAP" width="48" height="40" style={{ flexShrink: 0, objectFit: 'contain' }} />
          <div className="nav-titles">
            <span className="nav-title">长江崩岸重点险工段智能风险评估应用平台</span>
            <span className="nav-title-en">Yangtze River Bank Collapse Key Hazard Section Intelligent Risk Assessment Platform</span>
          </div>
        </div>
        {/* 全局搜索：登录后才挂载（接口按 /v0 鉴权，未登录调用只会拿到 401） */}
        {!isLoading && isAuthenticated && <GlobalSearchBar />}
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
      )}
      <div className={`app-body${isHome ? ' app-body--home' : ''}`}>
        {railMode !== 'none' && (
          <ActivityBar variant={railMode} menuItems={dropdownItems} onOpenSettings={() => setShowSettings(true)} />
        )}
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
        <Route index element={<Navigate to="/home" replace />} />
          <Route element={<AppLayout />}>
            <Route path="/home" element={<HomePage />} />
            <Route path="/editor" element={<EditorPageWrapper />} />
            {/* AI 分析助手是**整页**而不是弹窗：左会话记录 / 右对话区，占满 app-main。
                放在 /editor 之下，railMode 会命中 'work'，左侧图标条保持不断头。 */}
            <Route path="/editor/ai" element={<AiWorkspacePage />} />
            <Route path="/result" element={<ResultPageWrapper />} />
            <Route path="/result/:taskId" element={<ResultPageWrapper />} />
            {/* 三条独立路径：报告中心 / 技能中心 / 知识库，各自取数、各自渲染，不经过编辑器 */}
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/skills" element={<SkillsPage />} />
            <Route path="/knowledge" element={<KnowledgePage />} />
            {/* 后台四页也挂在 AppLayout 里：此前它们在壳外面，进来之后既没有顶栏的
                账号菜单、也没有登出入口，唯一的"返回"还是跳到 /editor —— 后台成了孤岛。
                侧栏由 AppLayout 的 railMode 判定（/admin/* → 'none'），不会多出活动条。 */}
            <Route element={<AuthGuard requireAdmin />}>
              <Route path="/admin/users" element={<AdminUserPage />} />
              <Route path="/admin/skill-approvals" element={<SkillApprovalsPage />} />
              <Route path="/admin/skill-security" element={<SkillSecurityPage />} />
              <Route path="/admin/skill-versions" element={<SkillVersionsPage />} />
            </Route>
          </Route>
      </Route>
    </Routes>
  );
}

export default App;
