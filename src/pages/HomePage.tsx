import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  BarChart3,
  BookOpen,
  ChevronRight,
  Clock3,
  Layers3,
  Map,
  Plus,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react';
import { useAuth } from '../auth/useAuth';
import {
  DASHBOARD_STATUS_META,
  dashboardStatusOf,
  fetchDashboardTasks,
  type DashboardTask,
} from '../services/taskDashboardService';
import './HomePage.css';

const RECENT_TASK_LIMIT = 7;

const ENTRIES = [
  { key: 'editor', title: '断面编辑', caption: '选岸段 · 布断面', Icon: Map },
  { key: 'calc', title: '风险评估', caption: '参数 · 计算', Icon: SlidersHorizontal },
  { key: 'report', title: '成果报告', caption: '图表 · 导出', Icon: BarChart3 },
  { key: 'knowledge', title: '知识库', caption: '指标 · 规则', Icon: BookOpen },
] as const;

const STEPS = ['打开工作台', '选择岸段', '配置参数', '运行评估', '查看成果'];

type TaskTab = 'all' | 'running' | 'completed' | 'pending';

const TABS: Array<{ key: TaskTab; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'running', label: '计算中' },
  { key: 'completed', label: '已完成' },
  { key: 'pending', label: '待计算' },
];

const FAQS: Array<{ q: string; a: string }> = [
  { q: '如何创建第一个评估任务？', a: '进入断面编辑器，选择岸段后点击底部中央圆形按钮。' },
  { q: '任务一直显示「计算中」？', a: '在计算进度面板查看断面状态，必要时取消后重新运行。' },
  { q: '灰色「无数据」断面代表什么？', a: '该断面未参与计算或结果缺失，补齐参数后重算即可。' },
  { q: '风险等级颜色如何区分？', a: '绿为低风险、蓝为中风险、橙为较高风险、红为高风险。' },
  { q: '报告与图件在哪里导出？', a: '结果页「报告与成果」中可直接导出图表与文档。' },
  { q: '修改岸段几何后需要重算吗？', a: '需要。几何变更会使原有结果作废，需重新计算。' },
];

function formatTaskTime(task: DashboardTask): string {
  const value = task.run_started_at || task.created_at;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

export default function HomePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [tasks, setTasks] = useState<DashboardTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState<TaskTab>('all');
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchDashboardTasks(controller.signal)
      .then(setTasks)
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setError(reason instanceof Error ? reason.message : '任务列表加载失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reloadKey]);

  const counts = useMemo<Record<TaskTab, number>>(() => ({
    all: tasks.length,
    running: tasks.filter((task) => dashboardStatusOf(task.status) === 'running').length,
    completed: tasks.filter((task) => dashboardStatusOf(task.status) === 'completed').length,
    pending: tasks.filter((task) => dashboardStatusOf(task.status) === 'pending').length,
  }), [tasks]);

  const visibleTasks = useMemo(
    () => (tab === 'all' ? tasks : tasks.filter((task) => dashboardStatusOf(task.status) === tab)).slice(0, RECENT_TASK_LIMIT),
    [tasks, tab],
  );

  const displayName = user?.realName || user?.username || '';
  const openTaskInEditor = (taskId: string) => navigate(`/editor?task=${encodeURIComponent(taskId)}`);
  const openTaskResult = (taskId: string) => navigate(`/result/${encodeURIComponent(taskId)}`);
  const goEntry = (key: (typeof ENTRIES)[number]['key']) => {
    // 报告有独立页面（/reports）：不能再用 /result?panel=reports —— 那会落到地图结果页，看起来像进了编辑器。
    if (key === 'editor' || key === 'calc') navigate('/editor');
    else if (key === 'report') navigate('/reports');
    else navigate('/knowledge');
  };

  return (
    <div className="home-page">
      <div className="home-shell">
        <header className="home-hero">
          <h1>{displayName ? `${displayName}，欢迎回来` : '欢迎使用长江岸段风险预警平台'}</h1>
          <p>岸段 · 断面 · 崩岸风险，一处完成</p>
        </header>

        <section className="home-entries" aria-label="功能入口">
          {ENTRIES.map(({ key, title, caption, Icon }) => (
            <button type="button" key={key} className={`home-entry is-${key}`} onClick={() => goEntry(key)}>
              <span className="home-entry-copy">
                <strong>{title}</strong>
                <small>{caption}</small>
                <span className="home-entry-go">进入 <ArrowRight size={12} /></span>
              </span>
              <span className="home-entry-art" aria-hidden="true"><Icon size={46} strokeWidth={1.4} /></span>
            </button>
          ))}
        </section>

        <ol className="home-steps" aria-label="评估流程">
          {STEPS.map((step, index) => (
            <li key={step}>
              <span className="home-step-index">{index + 1}</span>
              <span className="home-step-label">{step}</span>
              {index < STEPS.length - 1 && <ChevronRight size={13} className="home-step-arrow" aria-hidden="true" />}
            </li>
          ))}
        </ol>

        <div className="home-columns">
          <section className="home-panel" aria-labelledby="tasks-title">
            <header className="home-panel-head">
              <h2 id="tasks-title">任务</h2>
              <span className="home-panel-meta">
                计算中 {counts.running} · 已完成 {counts.completed}
              </span>
            </header>

            <div className="home-shortcuts">
              <button type="button" className="home-shortcut is-primary" onClick={() => navigate('/editor')}>
                <span className="home-shortcut-icon"><Plus size={20} /></span>
                <span className="home-shortcut-copy">
                  <strong>新建评估任务</strong>
                  <small>从选择岸段开始</small>
                </span>
                <ChevronRight size={16} className="home-shortcut-go" />
                <span className="home-shortcut-art" aria-hidden="true"><Layers3 size={56} strokeWidth={1} /></span>
              </button>
              <button type="button" className="home-shortcut" onClick={() => navigate('/reports')}>
                <span className="home-shortcut-icon"><BarChart3 size={20} /></span>
                <span className="home-shortcut-copy">
                  <strong>成果报告</strong>
                  <small>查看图表与导出</small>
                </span>
                <ChevronRight size={16} className="home-shortcut-go" />
                <span className="home-shortcut-art" aria-hidden="true"><Activity size={56} strokeWidth={1} /></span>
              </button>
            </div>

            <div className="home-tabs" role="tablist" aria-label="按状态筛选">
              {TABS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.key}
                  className={`home-tab${tab === item.key ? ' is-active' : ''}`}
                  onClick={() => setTab(item.key)}
                >
                  {item.label}
                  <i>{counts[item.key]}</i>
                </button>
              ))}
            </div>

            <div className="home-rows" aria-live="polite" aria-busy={loading}>
              {loading && [0, 1, 2, 3, 4].map((row) => (
                <div className="home-row is-skeleton" key={row}>
                  <span className="ds-skeleton home-row-mark" />
                  <span className="ds-skeleton home-row-name" />
                  <span className="ds-skeleton home-row-tag" />
                </div>
              ))}

              {!loading && error && (
                <div className="home-empty ds-alert ds-alert--error" role="alert">
                  <span>{error}</span>
                  <button type="button" className="home-link" onClick={() => setReloadKey((key) => key + 1)}>
                    <RefreshCw size={13} /> 重试
                  </button>
                </div>
              )}

              {!loading && !error && visibleTasks.length === 0 && (
                <div className="home-empty">
                  <span>{tab === 'all' ? '还没有任务' : '该状态下暂无任务'}</span>
                  <button type="button" className="home-link" onClick={() => navigate('/editor')}>
                    去创建 <ArrowRight size={13} />
                  </button>
                </div>
              )}

              {!loading && !error && visibleTasks.map((task) => {
                const status = dashboardStatusOf(task.status);
                const meta = DASHBOARD_STATUS_META[status];
                return (
                  <div className="home-row" key={task.task_id}>
                    <span className={`home-row-mark is-${status}`} aria-hidden="true" />
                    <button type="button" className="home-row-name" onClick={() => openTaskInEditor(task.task_id)} title={task.task_name}>
                      {task.task_name}
                    </button>
                    <span className="home-row-time"><Clock3 size={12} /> {formatTaskTime(task)}</span>
                    <span className={`home-row-tag is-${status}`}>{meta.label}</span>
                    <span className="home-row-actions">
                      <button type="button" className="home-link" onClick={() => openTaskInEditor(task.task_id)}>继续编辑</button>
                      <button type="button" className="home-link" onClick={() => openTaskResult(task.task_id)}>结果</button>
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="home-panel-foot">
              <button type="button" className="home-link" onClick={() => navigate('/result?panel=tasks')}>
                全部任务 <ArrowRight size={13} />
              </button>
            </div>
          </section>

          <aside className="home-panel home-faq" aria-labelledby="faq-title">
            <header className="home-panel-head">
              <h2 id="faq-title">常见问题</h2>
            </header>
            <ul>
              {FAQS.map((item, index) => (
                <li key={item.q} className={openFaq === index ? 'is-open' : ''}>
                  <button type="button" onClick={() => setOpenFaq(openFaq === index ? null : index)} aria-expanded={openFaq === index}>
                    {item.q}
                  </button>
                  {openFaq === index && <p>{item.a}</p>}
                </li>
              ))}
            </ul>
            <div className="home-panel-foot">
              <button type="button" className="home-link" onClick={() => navigate('/knowledge')}>
                查看知识库 <ArrowRight size={13} />
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
