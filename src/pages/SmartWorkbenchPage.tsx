import { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import * as turf from '@turf/turf';
import 'mapbox-gl/dist/mapbox-gl.css';
import '../App.css';
import { getVerticalFootCoordsFromAny, getVerticalFootPointFromAny } from '../utils/verticalFootPoint';
import ChatPanel from '../components/ChatPanel';
import ResizeHandle from '../components/ResizeHandle';
import WorkspacePanel from '../components/WorkspacePanel';
import type { ReportTab } from '../components/WorkspacePanel';
import VerticalResizeHandle from '../components/VerticalResizeHandle';
import { Box, FileText, List, Bot, MessageCircle, Globe, Plus, UserPlus } from 'lucide-react';
import { ConfigProvider, Modal } from 'antd';

// —— Mapbox token
mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

// ============================================================
//  类型定义
// ============================================================

// 后端返回的任务结构
interface Task {
  id: number;
  task_id: string;
  task_name: string;
  bank_ids: string[];
  description: string;
  created_at: string;
  status?: string;
  run_started_at?: string | null;
  run_completed_at?: string | null;
  error_message?: string | null;
}

// 断面结构（带模型结果）
interface SectionResult {
  section_id: string;
  id?: number;
  section_name?: string;
  distance: number;
  bank_id: string;
  geometry: any;
  vertical_foot_point?: { type: 'Point'; coordinates: [number, number] } | null;
  // legacy compatibility
  anchorPoint?: number[] | null;
  risk_level?: string | number;
  indicator_result?: number | null; // 字符串(high, medium, low, no) 或 数字(1, 2, 3, 4)
  risk_score?: number;
}

type SectionProfilePoint = {
  index?: number;
  distance?: number;
  elevation?: number;
  x?: number;
  y?: number;
};

type SectionProfile = {
  id?: number;
  task_id?: string;
  section_id?: string;
  section_name?: string;
  bank_id?: string;
  interval?: number;
  point_count?: number;
  profile_data?: {
    profile?: SectionProfilePoint[];
    interval?: number;
    points_v?: Array<[number, number, number]>;
  };
  [k: string]: any;
};

type TaskProgressSnapshot = {
  taskId: string;
  taskName?: string;
  status?: string;
  runStartedAt?: string | null;
  runCompletedAt?: string | null;
  expectedTotal: number;
  processedCount: number;
  successCount: number;
  errorCount: number;
  lastUpdatedAt: string;
  errors: Array<{
    section_id: string;
    section_name?: string;
    bank_id?: string;
    message: string;
    raw?: any;
    detail?: any;
    detailError?: string;
  }>;
};

// 颜色映射：支持数字 ID 和 字符串
// 风险等级映射：0 最低，3 最高
const RISK_COLORS: Record<string, string> = {
  '0': '#10b981', // 最低风险 - 绿
  '1': '#facc15', // 低-中 - 黄
  '2': '#f97316', // 较高 - 橙
  '3': '#ef4444', // 最高 - 红
  'default': '#94a3b8'
};

// ============================================================
//  模块级常量 & 工具函数
// ============================================================

// 风险等级中文标签
const RISK_LABELS: Record<number, string> = { 3: '极高风险', 2: '高风险', 1: '一般风险', 0: '低/无风险' };

// 中线闭合距离阈值（米）
const CLOSE_LOOP_DISTANCE_METERS = 2000;

// 通用 fetch + JSON 解析 + 错误处理
async function fetchJSON(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, init);
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text?.slice(0, 500)}`);
  return json ?? text;
}

// 通用列表解析：从后端多种返回格式中提取数组
function parseList(data: any, key?: string): any[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (key && Array.isArray(data[key])) return data[key];
  if (Array.isArray(data.profiles)) return data.profiles;
  if (Array.isArray(data.results)) return data.results;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.items)) return data.items;
  if (key && Array.isArray(data.data?.[key])) return data.data[key];
  return [];
}

// 矩阵指标分组配置

const MATRIX_GROUPS = [
  {
    title: '水流动力指标',
    weightKey: 'wRE',
    indicatorKeys: [
      { label: '抗冲流速(Ky)', key: 'Ky' },
      { label: '造床流量当量(PQ)', key: 'PQ' },
      { label: '水位变幅(Zd)', key: 'Zd' }
    ]
  },
  {
    title: '河床演变指标',
    weightKey: 'wNM',
    indicatorKeys: [
      { label: '岸坡坡比(Sa)', key: 'Sa' },
      { label: '近岸冲刷(Ln)', key: 'Ln' },
      { label: '滩槽高差(Zb)', key: 'Zb' }
    ]
  },
  {
    title: '地质工程指标',
    weightKey: 'wGE',
    indicatorKeys: [
      { label: '土体组成(Dsed)', key: 'Dsed' },
      { label: '岸坡防护(PL)', key: 'PL' },
      { label: '荷载控制(LC)', key: 'LC' }
    ]
  }
] as const;

interface SmartWorkbenchPageProps {
  initialTaskId?: string;
}

function AgentCircle({ agent, pos, label, isLeader, onDragStart, onRemove }: {
  agent: { id: string; name: string; color: string };
  pos: { x: number; y: number };
  label: string;
  isLeader?: boolean;
  onDragStart: () => void;
  onRemove?: (() => void) | undefined;
}) {
  const size = isLeader ? 64 : 48;
  return (
    <div
      onMouseDown={(e) => { e.stopPropagation(); onDragStart(); }}
      style={{
        position: 'absolute', left: `${pos.x}%`, top: `${pos.y}%`,
        transform: 'translate(-50%,-50%)',
        zIndex: 2, display: 'flex',
        flexDirection: 'column', alignItems: 'center', gap: 4,
        cursor: 'grab', userSelect: 'none',
      }}
    >
      <div style={{
        width: size, height: size, borderRadius: '50%',
        background: isLeader
          ? 'linear-gradient(135deg, #f59e0b, #d97706)'
          : agent.color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontSize: isLeader ? '0.9rem' : '0.7rem',
        fontWeight: 800,
        boxShadow: isLeader
          ? '0 4px 20px rgba(217,119,6,0.4), 0 0 0 3px rgba(251,191,36,0.2)'
          : `0 3px 12px ${agent.color}44`,
        position: 'relative',
      }}>
        {label}
        {onRemove && (
          <span
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            style={{
              position: 'absolute', top: -6, right: -6,
              width: 18, height: 18, borderRadius: '50%',
              background: '#ef4444', color: '#fff',
              fontSize: '0.55rem', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', lineHeight: 1,
            }}
          >×</span>
        )}
      </div>
      <span style={{
        fontSize: isLeader ? '0.72rem' : '0.62rem',
        color: isLeader ? '#92400E' : '#475569',
        fontWeight: isLeader ? 600 : 500,
      }}>{agent.name}</span>
      {isLeader && (
        <span style={{ fontSize: '0.55rem', color: '#d97706', background: '#fef3c7', padding: '1px 6px', borderRadius: 3 }}>总指挥</span>
      )}
    </div>
  );
}

function SmartWorkbenchPage(props: SmartWorkbenchPageProps) {
  const { initialTaskId } = props;

  // ============================================================
  //  Refs & State
  // ============================================================
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  const selectedTaskRef = useRef<string | null>(null);
  const autoOpenTaskRef = useRef<string | null>(null);

  const pollTimerRef = useRef<number | null>(null);
  const activePollTaskIdRef = useRef<string | null>(null);
  const lastSectionsByTaskRef = useRef<Record<string, SectionResult[]>>({});
  const sectionIndicatorResultCacheRef = useRef<Record<string, Record<string, number | null>>>({});
  const sectionIndicatorResultPromiseRef = useRef<Record<string, Record<string, Promise<number | null> | null>>>({});

  const sectionClickHandlerRef = useRef<((e: any) => void) | null>(null);
  const sectionEnterHandlerRef = useRef<(() => void) | null>(null);
  const sectionLeaveHandlerRef = useRef<(() => void) | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const [taskList, setTaskList] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSections, setShowSections] = useState(true);

  const [progressOpen, setProgressOpen] = useState(false);
  const [progress, setProgress] = useState<TaskProgressSnapshot | null>(null);
  const [expandedErrorIds, setExpandedErrorIds] = useState<Record<string, boolean>>({});

  const [matrixOpen, setMatrixOpen] = useState(false);
  const [matrixLoading, setMatrixLoading] = useState(false);
  const [matrixError, setMatrixError] = useState<string | null>(null);
  const [matrixSectionId, setMatrixSectionId] = useState<string | null>(null);
  const [matrixSectionName, setMatrixSectionName] = useState<string | null>(null);
  const [matrixDetail, setMatrixDetail] = useState<any | null>(null);

  const [chatCollapsed, setChatCollapsed] = useState<boolean>(false);
  const [satellite, setSatellite] = useState<boolean>(false);
  const [resizeTrigger, setResizeTrigger] = useState(0);
  const [leftPanelWidth, setLeftPanelWidth] = useState(350);
  const [rightPanelWidth, setRightPanelWidth] = useState(350);
  const [reportTabs, setReportTabs] = useState<ReportTab[]>([]);
  const [activeReportTab, setActiveReportTab] = useState(0);
  const [workspaceHeight, setWorkspaceHeight] = useState(300);
  const [generatingTaskId, setGeneratingTaskId] = useState<string | null>(null);
  const [reportList, setReportList] = useState<any[]>([]);
  const [activeSidebarPanel, setActiveSidebarPanel] = useState<'tasks' | 'reports' | 'agents' | 'skills'>('tasks');
  const [orchestratedAgents, setOrchestratedAgents] = useState<Set<string>>(new Set());
  const [customAgents, setCustomAgents] = useState<Array<{id: string, name: string, desc: string, color: string, role: 'Leader' | 'Member'}>>([]);
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [newAgentName, setNewAgentName] = useState('');
  const [newAgentDesc, setNewAgentDesc] = useState('');
  const [newAgentColor, setNewAgentColor] = useState('#8b5cf6');
  const [newAgentRole, setNewAgentRole] = useState<'Member' | 'Leader'>('Member');
  const AGENT_COLORS = ['#8b5cf6', '#ec4899', '#14b8a6', '#f59e0b', '#06b6d4', '#f43f5e', '#ef4444', '#6366f1'];

  const getAgentById = (id: string) => {
    const predefined = [
      { id: 'chief', name: '总工程师', color: '#d97706', role: 'Leader' as const, desc: '' },
      { id: 'cartographer', name: '制图师', color: '#3b82f6', role: 'Member' as const, desc: '' },
      { id: 'hydrologist', name: '水文专家', color: '#10b981', role: 'Member' as const, desc: '' },
    ];
    return [...predefined, ...customAgents].find(a => a.id === id) || null;
  };
  const [agentPositions, setAgentPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [dragAgent, setDragAgent] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [skillList, setSkillList] = useState<any[]>([]);
  const [chatTaskId, setChatTaskId] = useState<string | null>(null);
  const [chatTaskName, setChatTaskName] = useState<string>('');
  const [chatTasks, setChatTasks] = useState<{ taskId: string; taskName: string }[]>([]);
  const [chatReports, setChatReports] = useState<{ filename: string; taskId: string }[]>([]);

  const profilesCacheRef = useRef<Record<string, Record<string, SectionProfile>>>({});
  const profilesPromiseRef = useRef<Record<string, Promise<Record<string, SectionProfile>> | null>>({});
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileDetail, setProfileDetail] = useState<SectionProfile | null>(null);
  const [regenerateTarget, setRegenerateTarget] = useState<{ taskId: string; taskName: string } | null>(null);

  // ============================================================
  //  API 请求 & 报告生成
  // ============================================================

  const doGenerateReport = async (taskId: string, taskName: string) => {
    setGeneratingTaskId(taskId);
    const ts = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    console.log(`[doGenerateReport] 开始生成报告: taskId=${taskId}, 时间=${ts}`);
    try {
      const res = await fetch(`/v0/bank/ai/agent/report/task/${taskId}`, { method: 'POST' });
      const data = await res.json();
      console.log(`[doGenerateReport] API 响应:`, data);
      if (data.success && data.data) {
        const content = String(data.data).replace(/\.\/([^\s)]+\.png)/g, '/v0/bank/ai/viz-output/$1');
        const newTab: ReportTab = { taskId, taskName: `${taskName} (${ts})`, content, filename: data.filename };
        const prevLength = reportTabs.length;
        setReportTabs(prev => [...prev, newTab]);
        setActiveReportTab(prevLength);
        console.log(`[doGenerateReport] 新增标签页: 索引=${prevLength}, 标签总数=${prevLength + 1}`);
        if (prevLength === 0) setWorkspaceHeight(300);
      } else {
        console.error(`[doGenerateReport] API 返回失败:`, data.error);
        alert(translateError(data.error || '未知错误'));
      }
    } catch (e: any) {
      console.error(`[doGenerateReport] 网络异常:`, e.message);
      alert(translateError(e.message || '网络错误'));
    } finally {
      setGeneratingTaskId(null);
    }
  };

  const handleGenerateReport = (taskId: string, taskName: string) => {
    const existsInList = reportList.some((r: any) => r.taskId === taskId);
    if (existsInList) {
      setRegenerateTarget({ taskId, taskName });
      return;
    }
    doGenerateReport(taskId, taskName);
  };

  const fetchReportList = async () => {
    try {
      const res = await fetch('/v0/bank/ai/reports');
      const data = await res.json();
      if (data.success) setReportList(data.reports || []);
    } catch (e) { /* ignore */ }
  };

  const fetchSkills = async () => {
    try {
      const res = await fetch('/v0/bank/ai/skill/list');
      const data = await res.json();
      if (data.success) setSkillList(data.skills || []);
    } catch (e) { /* ignore */ }
  };

  const openReport = async (filename: string) => {
    try {
      const res = await fetch(`/v0/bank/ai/reports/${encodeURIComponent(filename)}`);
      const data = await res.json();
      if (data.success && data.content) {
        const content = String(data.content).replace(/\.\/([^\s)]+\.png)/g, '/v0/bank/ai/viz-output/$1');
        const taskId = filename.replace(/^report_/, '').replace(/_\d{8}_\d{6}\.md$/, '');
        handleTaskClick(taskId);
        setReportTabs(prev => {
          const existing = prev.findIndex(t => t.filename === filename);
          const tab: ReportTab = { taskId, taskName: filename, content, filename };
          if (existing >= 0) {
            const next = [...prev];
            next[existing] = tab;
            setActiveReportTab(existing);
            return next;
          }
          setActiveReportTab(prev.length);
          if (prev.length === 0) setWorkspaceHeight(300);
          return [...prev, tab];
        });
      }
    } catch (e) { /* ignore */ }
  };

  const translateError = (msg: string) => {
    const m = msg.toLowerCase();
    if (m.includes('insufficient balance') || m.includes('402') || m.includes('insufficient_balance')) {
      return 'DeepSeek API 余额不足，请前往 platform.deepseek.com 充值后再试。';
    }
    if (m.includes('401') || m.includes('unauthorized')) {
      return 'API Key 无效或已过期，请检查配置。';
    }
    if (m.includes('429') || m.includes('rate limit')) {
      return 'API 请求过于频繁，请稍后再试。';
    }
    if (m.includes('timeout') || m.includes('timed out')) {
      return '请求超时，请检查网络后重试。';
    }
    return '报告生成失败: ' + msg;
  };

  useEffect(() => {
    selectedTaskRef.current = selectedTask;
  }, [selectedTask]);

  useEffect(() => {
    if (!initialTaskId) return;
    setSelectedTask(initialTaskId);
  }, [initialTaskId]);

  const parseProfilesList = (data: any): any[] => parseList(data, 'profiles');

  // — 断面剖面数据加载与缓存
  const ensureTaskProfilesLoaded = async (taskId: string) => {
    if (!taskId) return {} as Record<string, SectionProfile>;
    if (profilesCacheRef.current[taskId]) return profilesCacheRef.current[taskId];
    if (profilesPromiseRef.current[taskId]) return profilesPromiseRef.current[taskId]!;

    const promise = (async () => {
      const payload = await fetchJSON(`/v0/bank/tasks/${encodeURIComponent(taskId)}/section-profiles`);
      const list = parseProfilesList(payload);
      const bySection: Record<string, SectionProfile> = {};
      list.forEach((p: any) => {
        const sid = p?.section_id ?? p?.sectionId ?? p?.sectionID;
        if (!sid) return;
        bySection[String(sid)] = p as SectionProfile;
      });
      profilesCacheRef.current[taskId] = bySection;
      return bySection;
    })();

    profilesPromiseRef.current[taskId] = promise;
    try {
      return await promise;
    } finally {
      profilesPromiseRef.current[taskId] = null;
    }
  };

  const getProfileSeries = (p: SectionProfile | null) => {
    const profile = p?.profile_data?.profile;
    if (Array.isArray(profile) && profile.length > 0) {
      const points = profile
        .map((pt, idx) => {
          const d = pt?.distance;
          const e = pt?.elevation;
          const distance = typeof d === 'number' ? d : idx;
          const elevation = typeof e === 'number' ? e : null;
          if (elevation === null || !Number.isFinite(distance) || !Number.isFinite(elevation)) return null;
          return { distance, elevation };
        })
        .filter(Boolean) as Array<{ distance: number; elevation: number }>;
      return points;
    }
    return [] as Array<{ distance: number; elevation: number }>;
  };

  const renderProfileChart = (series: Array<{ distance: number; elevation: number }>) => {
    if (!series || series.length < 2) {
      return <div className="profile-empty">无剖面数据</div>;
    }

    const width = 900;
    const height = 220;
    const padL = 44;
    const padR = 16;
    const padT = 12;
    const padB = 30;

    const xs = series.map(p => p.distance);
    const ys = series.map(p => p.elevation);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;

    const xToSvg = (x: number) => padL + ((x - minX) / spanX) * (width - padL - padR);
    const yToSvg = (y: number) => padT + (1 - (y - minY) / spanY) * (height - padT - padB);

    const polylinePoints = series.map(p => `${xToSvg(p.distance)},${yToSvg(p.elevation)}`).join(' ');

    return (
      <div className="profile-chart-wrap">
        <svg className="profile-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="断面剖面折线">
          <line x1={padL} y1={height - padB} x2={width - padR} y2={height - padB} className="profile-axis" />
          <line x1={padL} y1={padT} x2={padL} y2={height - padB} className="profile-axis" />
          <polyline points={polylinePoints} className="profile-polyline" fill="none" />

          <text x={padL} y={padT + 10} className="profile-label" textAnchor="start">{Number.isFinite(maxY) ? maxY.toFixed(3) : ''}</text>
          <text x={padL} y={height - padB - 6} className="profile-label" textAnchor="start">{Number.isFinite(minY) ? minY.toFixed(3) : ''}</text>
          <text x={padL} y={height - 8} className="profile-label" textAnchor="start">{Number.isFinite(minX) ? minX.toFixed(2) : ''}</text>
          <text x={width - padR} y={height - 8} className="profile-label" textAnchor="end">{Number.isFinite(maxX) ? maxX.toFixed(2) : ''}</text>
        </svg>
      </div>
    );
  };

  // — 矩阵详情弹窗
  const openMatrixDetail = async (taskId: string | null, sectionId: string, sectionName?: string) => {
    if (!sectionId) return;
    setMatrixOpen(true);
    setMatrixLoading(true);
    setMatrixError(null);
    setMatrixSectionId(sectionId);
    setMatrixSectionName(sectionName || null);
    setMatrixDetail(null);

    setProfileLoading(true);
    setProfileError(null);
    setProfileDetail(null);

    const effectiveTaskId = taskId || selectedTaskRef.current;

    const matrixPromise = (async () => {
      const payload = await fetchJSON(`/v0/bank/results/${encodeURIComponent(sectionId)}`);
      const result = payload?.result ?? payload?.data?.result ?? payload?.data ?? payload;
      const indicators = result?.indicators ?? payload?.indicators ?? {};
      const matrices = indicators?.matrices ?? result?.matrices ?? payload?.matrices ?? {};
      const matrix = {
        ...result,
        ...indicators,
        matrices,
        weight_matrix: matrices.weight_matrix ?? indicators.weight_matrix ?? result?.weight_matrix,
        concat_matrix: matrices.concat_matrix ?? indicators.concat_matrix ?? result?.concat_matrix,
        result_matrix: matrices.result_matrix ?? indicators.result_matrix ?? result?.result_matrix,
        risk_level: result?.['risk-level'] ?? result?.risk_level ?? result?.riskLevel,
        result: result?.result ?? indicators?.result ?? payload?.result?.result,
      };
      console.log('ResultPage: matrix detail payload:', payload);
      console.log('ResultPage: matrix detail resolved matrix:', matrix);
      setMatrixDetail(matrix);
    })().catch((err: any) => {
      setMatrixError(err?.message || '获取矩阵详情失败');
    }).finally(() => {
      setMatrixLoading(false);
    });

    const profilePromise = (async () => {
      if (!effectiveTaskId) {
        throw new Error('未选择任务，无法加载断面剖面');
      }
      const bySection = await ensureTaskProfilesLoaded(effectiveTaskId);
      const prof = bySection[String(sectionId)] ?? null;
      setProfileDetail(prof);
    })().catch((err: any) => {
      setProfileError(err?.message || '获取断面剖面失败');
    }).finally(() => {
      setProfileLoading(false);
    });

    await Promise.allSettled([matrixPromise, profilePromise]);
  };

  // — 矩阵详情弹窗 — 关闭
  const closeMatrixDetail = () => {
    setMatrixOpen(false);
    setMatrixLoading(false);
    setMatrixError(null);
    setMatrixSectionId(null);
    setMatrixSectionName(null);
    setMatrixDetail(null);

    setProfileLoading(false);
    setProfileError(null);
    setProfileDetail(null);
  };

  const formatCellValue = (v: any) => {
    if (v === null || v === undefined) return '-';
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return String(v);
      // 避免长小数影响可读性
      return Math.abs(v) >= 1000 ? String(Math.round(v)) : String(Number(v.toFixed(4)));
    }
    if (typeof v === 'string') return v;
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  };

  const generateMatrixCSV = () => {
    if (!matrixDetail) return '';

    const rows: string[][] = [];
    
    // 头部信息
    rows.push(['断面矩阵详情']);
    rows.push([]);
    rows.push(['字段', '值']);
    rows.push(['断面名称', String(matrixSectionName || '-')]);
    rows.push(['断面ID', String(matrixSectionId || '-')]);
    rows.push(['Task ID', formatCellValue(matrixDetail.task_id ?? matrixDetail.taskId)]);
    rows.push(['Case ID', formatCellValue(matrixDetail['case-id'] ?? matrixDetail.case_id ?? matrixDetail.caseId)]);
    rows.push(['区域代码', formatCellValue(matrixDetail.region_code ?? matrixDetail.regionCode)]);
    rows.push(['岸段ID', formatCellValue(matrixDetail.bank_id ?? matrixDetail.bankId)]);
    rows.push(['运行时间', formatCellValue(matrixDetail.run_time ?? matrixDetail.runTime)]);
    rows.push(['水流量', formatCellValue(matrixDetail.water_qs ?? matrixDetail?.indicators?.water_qs ?? matrixDetail?.water_qs)]);
    rows.push(['潮差', formatCellValue(matrixDetail.tidal_level ?? matrixDetail?.indicators?.tidal_level ?? matrixDetail?.tidal_level)]);
    rows.push(['风险等级', formatCellValue(matrixDetail.risk_level ?? matrixDetail.riskLevel)]);
    rows.push([]);
    
    // 指标矩阵部分
    const indicators = matrixDetail?.indicators?.thresholds ?? matrixDetail?.thresholds ?? {};
    
    MATRIX_GROUPS.forEach((group, groupIdx) => {
      const weightKey = group.weightKey as keyof typeof indicators;
      const weightValues = indicators?.[weightKey];
      const subThresholds = indicators?.sub_thresholds || {};
      const groupWeight = Array.isArray(indicators?.wRL) ? indicators.wRL[groupIdx] : weightValues;
      
      // 组标题
      rows.push([]);
      rows.push([group.title]);
      rows.push(['准则权重', formatCellValue(groupWeight)]);
      rows.push([]);
      
      // 表头
      rows.push(['指标', '阈值1', '阈值2', '阈值3', '权重', '结果']);
      
      // 数据行
      group.indicatorKeys.forEach(({ label, key }, idx) => {
        const thresholdRow = subThresholds[key] || [];
        const displayThresholds = Array.isArray(thresholdRow) ? thresholdRow : [];
        const displayWeight = Array.isArray(weightValues) ? formatCellValue(weightValues[idx]) : formatCellValue(weightValues);
        const rawValues = matrixDetail?.raw_values || {};
        const resultValue = rawValues[key] !== undefined && rawValues[key] !== null ? formatCellValue(rawValues[key]) : 'N/A';
        rows.push([
          label,
          displayThresholds[0] !== undefined ? formatCellValue(displayThresholds[0]) : 'N/A',
          displayThresholds[1] !== undefined ? formatCellValue(displayThresholds[1]) : 'N/A',
          displayThresholds[2] !== undefined ? formatCellValue(displayThresholds[2]) : 'N/A',
          displayWeight !== undefined ? displayWeight : 'N/A',
          resultValue
        ]);
      });
    });
    
    // 转换为 CSV 格式
    return rows.map(row => 
      row.map(cell => {
        const str = String(cell);
        // 如果包含逗号、双引号或换行符，则用双引号包围并转义双引号
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      }).join(',')
    ).join('\n');
  };

  const downloadMatrixCSV = () => {
    const csv = generateMatrixCSV();
    if (!csv) {
      alert('无可导出的数据');
      return;
    }
    
    // 创建 Blob 并下载
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `断面矩阵详情_${matrixSectionId || 'export'}_${new Date().toISOString().slice(0, 10)}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // — 矩阵详情 — 指标组渲染
  const renderAssessmentGroup = (group: typeof MATRIX_GROUPS[number], indicators: any, groupIdx: number) => {
    const weightKey = group.weightKey as keyof typeof indicators;
    const weightValues = indicators?.[weightKey];
    const subThresholds = indicators?.sub_thresholds || {};
    const rawValues = matrixDetail?.raw_values || {};
    const groupWeight = Array.isArray(indicators?.wRL) ? indicators.wRL[groupIdx] : weightValues;
    
    const hasAnyData = group.indicatorKeys.length > 0 && (groupWeight || Object.keys(subThresholds).length > 0 || weightValues);
    if (!hasAnyData) return null;

    return (
      <div className="matrix-assessment-group" key={group.title}>
        <div className="matrix-assessment-meta">
          <div className="matrix-assessment-title">{group.title}</div>
          <div className="matrix-assessment-weight">
            <span>准则权重</span>
            <span className="matrix-assessment-weight-value">{formatCellValue(groupWeight)}</span>
          </div>
        </div>

        <div className="matrix-assessment-table-wrap">
          <table className="matrix-assessment-table">
            <thead>
              <tr>
                <th className="matrix-assessment-row-header" />
                <th colSpan={3}>风险阈值</th>
                <th>权重</th>
                <th>结果</th>
              </tr>
            </thead>
            <tbody>
              {group.indicatorKeys.map(({ label, key }, idx) => {
                const thresholdRow = subThresholds[key] || [];
                const displayThresholds = Array.isArray(thresholdRow) ? thresholdRow : [];
                const displayWeight = Array.isArray(weightValues) ? weightValues[idx] : weightValues;
                const resultValue = rawValues[key] !== undefined && rawValues[key] !== null ? formatCellValue(rawValues[key]) : 'N/A';
                
                return (
                  <tr key={key}>
                    <th scope="row" className="matrix-assessment-row-name">{label}</th>
                    <td>{displayThresholds[0] !== undefined ? formatCellValue(displayThresholds[0]) : 'N/A'}</td>
                    <td>{displayThresholds[1] !== undefined ? formatCellValue(displayThresholds[1]) : 'N/A'}</td>
                    <td>{displayThresholds[2] !== undefined ? formatCellValue(displayThresholds[2]) : 'N/A'}</td>
                    <td>{displayWeight !== undefined ? formatCellValue(displayWeight) : '-'}</td>
                    <td>{resultValue}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // 切换断面可见性
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    
    if (map.getLayer('sections-line')) {
      map.setLayoutProperty('sections-line', 'visibility', showSections ? 'visible' : 'none');
    }
    if (map.getLayer('sections-line-hit')) {
      map.setLayoutProperty('sections-line-hit', 'visibility', showSections ? 'visible' : 'none');
    }
  }, [showSections]);

  // 清理地图上所有断面和中线图层/数据源
  const clearMapLayers = (map: mapboxgl.Map) => {
    ['sections-line-hit', 'sections-line'].forEach(layer => {
      if (map.getLayer(layer)) map.removeLayer(layer);
    });
    if (map.getSource('sections-source')) map.removeSource('sections-source');

    const style = map.getStyle();
    if (style && style.layers) {
      style.layers.forEach((layer: any) => {
        if (layer.id && String(layer.id).startsWith('midline-')) {
          if (map.getLayer(layer.id)) map.removeLayer(layer.id);
        }
      });
    }
    if (style && style.sources) {
      Object.keys(style.sources).forEach((sourceId: string) => {
        if (sourceId.startsWith('midline-')) {
          if (map.getSource(sourceId)) map.removeSource(sourceId);
        }
      });
    }
  };

  const stopPolling = () => {
    if (pollTimerRef.current) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    activePollTaskIdRef.current = null;
  };

  useEffect(() => {
    return () => {
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 风险解析辅助：根据 /v0/bank/results/{sectionId} 的 indicators.result(0-1) 映射到 0-3 风险等级
  const mapIndicatorResultToRiskLevel = (value: any) => {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 1) return null;
    if (n < 0.25) return 0;
    if (n < 0.5) return 1;
    if (n < 0.75) return 2;
    return 3;
  };

  const getRiskInfo = (indicatorResult: any) => {
    const level = mapIndicatorResultToRiskLevel(indicatorResult);
    if (level === null) {
      return { valid: false, color: RISK_COLORS.default, label: '未知', level: null };
    }
    return { valid: true, color: RISK_COLORS[String(level)] || RISK_COLORS.default, label: level, level };
  };

  const parseIndicatorResultFromSectionDetail = (payload: any): number | null => {
    const indicators =
      payload?.indicators ??
      payload?.result?.indicators ??
      payload?.data?.indicators ??
      payload?.data?.result?.indicators;
    const raw = indicators?.result;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 1) return null;
    return n;
  };

  // 颜色展示：按 indicators.result 对应的四级风险颜色展示
  // 不同等级之间的过渡（岸线/中线）仍由 Mapbox 的 line-gradient 插值完成
  const computeColorWithMatrix = (indicatorResult: any) => {
    return getRiskInfo(indicatorResult);
  };

  const ensureSectionIndicatorResultLoaded = async (taskId: string, sectionId: string): Promise<number | null> => {
    if (!taskId || !sectionId) return null;
    if (!sectionIndicatorResultCacheRef.current[taskId]) {
      sectionIndicatorResultCacheRef.current[taskId] = {};
    }
    if (!sectionIndicatorResultPromiseRef.current[taskId]) {
      sectionIndicatorResultPromiseRef.current[taskId] = {};
    }
    if (Object.prototype.hasOwnProperty.call(sectionIndicatorResultCacheRef.current[taskId], sectionId)) {
      return sectionIndicatorResultCacheRef.current[taskId][sectionId] ?? null;
    }
    const pending = sectionIndicatorResultPromiseRef.current[taskId][sectionId];
    if (pending) return pending;
    const promise = (async () => {
      const payload = await fetchJSON(`/v0/bank/results/${encodeURIComponent(sectionId)}`);
      const value = parseIndicatorResultFromSectionDetail(payload);
      sectionIndicatorResultCacheRef.current[taskId][sectionId] = value;
      return value;
    })();
    sectionIndicatorResultPromiseRef.current[taskId][sectionId] = promise;
    try { return await promise; } finally { sectionIndicatorResultPromiseRef.current[taskId][sectionId] = null; }
  };

  // 获取所有任务列表
  useEffect(() => {
    const fetchTasks = async () => {
      try {
        const res = await fetch('/v0/bank/tasks');
        if (!res.ok) throw new Error('获取任务列表失败');
        const data = await res.json();
        if (data.success) {
          setTaskList(data.tasks || []);
        }
      } catch (err: any) {
        console.error('获取任务列表失败:', err);
        setError('无法加载任务列表');
      }
    };
    fetchTasks();
  }, [initialTaskId]);

  useEffect(() => {
    if (!initialTaskId) return;
    if (autoOpenTaskRef.current === initialTaskId) return;
    if (!mapReady) return;

    autoOpenTaskRef.current = initialTaskId;
    void handleTaskClick(initialTaskId);
  }, [initialTaskId, taskList, mapReady]);

  useEffect(() => {
    fetchReportList();
  }, []);

  useEffect(() => {
    fetchSkills();
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      fetchReportList();
      const taskId = (e as CustomEvent).detail?.taskId;
      if (taskId) handleTaskClick(taskId);
    };
    window.addEventListener('report-saved', handler);
    return () => window.removeEventListener('report-saved', handler);
  }, []);

  const parseResultsList = (data: any): any[] => parseList(data, 'results');

  // — 标准化结果记录
  const normalizeResultRecord = (r: any) => {
    const sectionId = r?.section_id ?? r?.sectionId ?? r?.sectionID;
    const riskLevel = r?.risk_level ?? r?.riskLevel ?? r?.risk;
    const status = r?.status ?? r?.state ?? r?.code;
    const message = r?.error_message ?? r?.errorMessage ?? r?.error ?? r?.message;
    return { sectionId, riskLevel, status, message, raw: r };
  };

  const isTaskCompleted = (taskInfo: any) => {
    const st = String(taskInfo?.status ?? '').toLowerCase();
    if (st === 'completed' || st === 'success' || st === 'done') return true;
    if (taskInfo?.run_completed_at) return true;
    if (taskInfo?.runCompletedAt) return true;
    return false;
  };

  const loadErrorDetail = async (taskId: string, sectionId: string) => {
    // 仅在当前任务仍为选中时才更新
    if (!taskId || taskId !== selectedTask) return;

    try {
      const res = await fetch(`/v0/bank/results/${sectionId}`);
      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }

      setProgress(prev => {
        if (!prev || prev.taskId !== taskId) return prev;
        const nextErrors = prev.errors.map(e => {
          if (e.section_id !== sectionId) return e;
          if (!res.ok) {
            return { ...e, detailError: `HTTP ${res.status}: ${text?.slice(0, 500)}` };
          }
          return { ...e, detail: json ?? text };
        });
        return { ...prev, errors: nextErrors };
      });
    } catch (err: any) {
      setProgress(prev => {
        if (!prev || prev.taskId !== taskId) return prev;
        const nextErrors = prev.errors.map(e => {
          if (e.section_id !== sectionId) return e;
          return { ...e, detailError: err?.message || '获取错误详情失败' };
        });
        return { ...prev, errors: nextErrors };
      });
    }
  };

  // — 轮询核心：拉取任务状态 + 结果，更新进度 & 地图
  const updateProgressAndMap = async (taskId: string, taskName: string | undefined, baseSections: SectionResult[]) => {
    const startedAt = new Date().toISOString();
    const map = mapRef.current;

    let taskInfo: any = null;
    let resultsList: any[] = [];

    try {
      const taskRes = await fetch(`/v0/bank/tasks/${taskId}`);
      if (taskRes.ok) {
        const jt = await taskRes.json().catch(() => null);
        taskInfo = jt?.task ?? jt?.data ?? jt;
      }
    } catch (err) {
      // 忽略：任务状态接口可能不可用，但轮询结果仍可继续
    }

    // 兼容：部分后端只在 /full 中返回 status/run_completed_at 等字段
    if (!taskInfo || (!taskInfo.status && !taskInfo.run_completed_at && !taskInfo.runCompletedAt)) {
      try {
        const fullRes = await fetch(`/v0/bank/tasks/${taskId}/full`);
        if (fullRes.ok) {
          const jf = await fullRes.json().catch(() => null);
          const d = jf?.data ?? jf;
          taskInfo = d?.task ?? d?.data?.task ?? taskInfo;
        }
      } catch {
        // ignore
      }
    }

    try {
      const resultsRes = await fetch(`/v0/bank/results?task_id=${encodeURIComponent(taskId)}`);
      if (resultsRes.ok) {
        const jr = await resultsRes.json().catch(() => null);
        resultsList = parseResultsList(jr);
      }
    } catch (err) {
      // 忽略：临时网络错误不应中断轮询
    }

    if (activePollTaskIdRef.current !== taskId) return;

    const latestBySection: Record<string, ReturnType<typeof normalizeResultRecord>> = {};
    resultsList.forEach(r => {
      const nr = normalizeResultRecord(r);
      if (!nr.sectionId) return;
      latestBySection[String(nr.sectionId)] = nr;
    });

    const resultBySection: Record<string, { riskLevel?: any; status?: any; message?: any; raw?: any }> = {};
    const errorsFromResults: TaskProgressSnapshot['errors'] = [];
    Object.keys(latestBySection).forEach(sectionId => {
      const nr = latestBySection[sectionId];
      resultBySection[sectionId] = {
        riskLevel: nr.riskLevel,
        status: nr.status,
        message: nr.message,
        raw: nr.raw
      };

      const st = String(nr.status ?? '').toUpperCase();
      const hasError = (nr.message && String(nr.message).trim().length > 0) || (st && st !== 'SUCCESS' && st !== 'COMPLETED' && st !== '200');
      const riskIsValidNumber = (() => {
        const n = Number(nr.riskLevel);
        return !isNaN(n) && Number.isFinite(n) && n >= 0 && n <= 3;
      })();

      if (hasError && !riskIsValidNumber) {
        errorsFromResults.push({
          section_id: String(sectionId),
          message: String(nr.message ?? nr.status ?? '未知错误'),
          raw: nr.raw
        });
      }
    });

    const mergedSections = baseSections.map(s => {
      const hit = resultBySection[s.section_id];
      if (!hit) return s;
      return { ...s, risk_level: hit.riskLevel ?? s.risk_level };
    });

    const detailSectionIds = Object.keys(latestBySection);
    if (detailSectionIds.length > 0) {
      await Promise.allSettled(
        detailSectionIds.map(sectionId => ensureSectionIndicatorResultLoaded(taskId, sectionId))
      );
    }

    const sectionsWithIndicatorResult = mergedSections.map(s => {
      const cached = sectionIndicatorResultCacheRef.current[taskId]?.[s.section_id];
      if (cached === undefined) return s;
      return { ...s, indicator_result: cached };
    });

    // 注：result 的数值意义尚不明确，暂不再轮询 /matrix（避免高频额外请求）

    // 统计成功数：以 risk_level(0-3) 为准
    const successCount = mergedSections.reduce((acc, s) => {
      const n = Number(s.risk_level);
      if (!isNaN(n) && Number.isFinite(n) && n >= 0 && n <= 3) return acc + 1;
      return acc;
    }, 0);

    // 如果任务已完成，但仍有部分断面没有结果，则把它们当作“无结果/计算失败”展示出来
    const completed = isTaskCompleted(taskInfo);
    const missingAsErrors: TaskProgressSnapshot['errors'] = [];
    if (completed) {
      mergedSections.forEach(s => {
        const hasAnyResult = Boolean(resultBySection[s.section_id]);
        const n = Number(s.risk_level);
        const riskOk = !isNaN(n) && Number.isFinite(n) && n >= 0 && n <= 3;
        if (!hasAnyResult || !riskOk) {
          const already = errorsFromResults.some(e => e.section_id === s.section_id);
          if (!already) {
            missingAsErrors.push({
              section_id: s.section_id,
              section_name: s.section_name,
              bank_id: s.bank_id,
              message: hasAnyResult ? '计算未返回有效风险等级' : '未返回结果（可能计算失败）'
            });
          }
        }
      });
    }

    const allErrors = [...errorsFromResults, ...missingAsErrors].map(e => {
      const sec = baseSections.find(s => s.section_id === e.section_id);
      return {
        ...e,
        section_name: e.section_name ?? sec?.section_name,
        bank_id: e.bank_id ?? sec?.bank_id
      };
    });

    const expectedTotal = baseSections.length;
    const processedCount = completed ? expectedTotal : Math.min(expectedTotal, successCount + allErrors.length);

    setProgress({
      taskId,
      taskName,
      status: taskInfo?.status,
      runStartedAt: taskInfo?.run_started_at ?? taskInfo?.runStartedAt ?? null,
      runCompletedAt: taskInfo?.run_completed_at ?? taskInfo?.runCompletedAt ?? null,
      expectedTotal,
      processedCount,
      successCount,
      errorCount: allErrors.length,
      lastUpdatedAt: startedAt,
      errors: allErrors
    });

    // 轮询驱动地图刷新（断面颜色 + 岸段插值）
    if (map) {
      renderSections(sectionsWithIndicatorResult);
      applyShorelineGradient(sectionsWithIndicatorResult);
    }

    const shouldStop = completed || (expectedTotal > 0 && processedCount >= expectedTotal);
    if (shouldStop) {
      stopPolling();
    }
  };

  // ============================================================
  //  任务操作
  // ============================================================

  // 点击任务：获取任务详情（包含所有断面及其结果）并在地图可视化
  const handleTaskClick = async (taskId: string) => {
    stopPolling();

    setSelectedTask(taskId);
    selectedTaskRef.current = taskId;
    setLoading(true);
    setError(null);
    setProgressOpen(true);
    setProgress(null);
    setExpandedErrorIds({});

    // 清理地图上之前任务的图层和数据源
    const map = mapRef.current;
    if (map) clearMapLayers(map);

    try {
      // 1) 先拉取断面列表（含几何），先渲染“未着色”的断面
      const sectionsRes = await fetch(`/v0/bank/sections?task_id=${encodeURIComponent(taskId)}`);
      if (!sectionsRes.ok) throw new Error('获取断面列表失败');
      const js = await sectionsRes.json().catch(() => null);
      const sectionsRaw: any[] = (js?.sections ?? js?.data ?? js) || [];
      console.log('ResultPage: raw sections response:', sectionsRaw);
      const sectionResults: SectionResult[] = (Array.isArray(sectionsRaw) ? sectionsRaw : [])
        .filter(s => s && (s.geometry || s.section_geometry))
        .map((s: any) => ({
          section_id: s.section_id,
          section_name: s.section_name,
          distance: Number(s.distance ?? 0),
          bank_id: s.bank_id ?? 'unknown',
          geometry: s.geometry ?? s.section_geometry,
          vertical_foot_point: getVerticalFootPointFromAny(s) ?? null,
          // legacy compatibility
          anchorPoint: (s.anchorPoint ?? s.anchor_point ?? s.anchor) ?? null,
          risk_level: s.risk_level,
          indicator_result: null
        }));

      // 打印处理后的断面列表 JSON，便于调试（也可在控制台查看）
      try {
        console.log('ResultPage: parsed sectionResults:', JSON.stringify(sectionResults, null, 2));
      } catch (e) {
        console.log('ResultPage: parsed sectionResults (non-serializable):', sectionResults);
      }

      lastSectionsByTaskRef.current[taskId] = sectionResults;

      // 2) 地图初始渲染（先灰色/未知风险），并缩放到断面范围
      renderSections(sectionResults);
      applyShorelineGradient(sectionResults);

      const map = mapRef.current;
      if (map && sectionResults.length > 0) {
        const sectionFeatures = sectionResults
          .filter(s => s.geometry)
          .map(s => ({ type: 'Feature', geometry: s.geometry, properties: {} }));
        if (sectionFeatures.length > 0) {
          const bbox = turf.bbox({ type: 'FeatureCollection', features: sectionFeatures as any });
          map.fitBounds([bbox[0], bbox[1], bbox[2], bbox[3]], { padding: 80 });
        }
      }

      // 3) 打开进度窗口并开始轮询（任务状态 + 结果列表），驱动地图插值持续更新
      activePollTaskIdRef.current = taskId;

      // 任务名用于弹窗展示（优先用列表中的名称）
      const taskName = taskList.find(t => t.task_id === taskId)?.task_name;

      // 立即执行一次，再开启定时轮询
      await updateProgressAndMap(taskId, taskName, sectionResults);

      pollTimerRef.current = window.setInterval(() => {
        if (activePollTaskIdRef.current !== taskId) return;
        const latestSections = lastSectionsByTaskRef.current[taskId] ?? sectionResults;
        updateProgressAndMap(taskId, taskName, latestSections);
      }, 2000);

    } catch (e: any) {
      console.error(e);
      setError(e.message || '加载任务数据失败');
    } finally {
      setLoading(false);
    }
  };

  // 删除当前选中的任务
  const handleDeleteTask = async () => {
    if (!selectedTask) return;

    const confirmDelete = window.confirm('确定要删除当前选中的任务吗？此操作不可恢复。');
    if (!confirmDelete) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/v0/bank/tasks/${selectedTask}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('删除任务失败');

      const data = await res.json().catch(() => ({}));
      if (data && data.success === false) {
        throw new Error(data.message || '删除任务失败');
      }

      // 从任务列表中移除已删除任务
      setTaskList(prev => prev.filter(task => task.task_id !== selectedTask));

      // 清空当前选择
      stopPolling();
      setSelectedTask(null);
      setProgressOpen(false);
      setProgress(null);

      // 清理地图上的图层和数据源
      const map = mapRef.current;
      if (map) clearMapLayers(map);
    } catch (e: any) {
      console.error('删除任务出错:', e);
      setError(e.message || '删除任务失败');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteTaskById = async (taskId: string) => {
    try {
      const res = await fetch(`/v0/bank/tasks/${taskId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('删除任务失败');
      setTaskList(prev => prev.filter(t => t.task_id !== taskId));
      if (selectedTask === taskId) { stopPolling(); setSelectedTask(null); }
    } catch (e: any) { setError(e.message); }
  };

  // ============================================================
  //  地图渲染 & 可视化
  // ============================================================

  // 渲染断面集合几何并在地图显示
  const renderSections = (sections: SectionResult[]) => {
    const map = mapRef.current;
    if (!map) return;

    // 转换断面数据为 GeoJSON
    const features = sections.filter(s => s.geometry).map(s => {
      const info = computeColorWithMatrix(s.indicator_result);
      const color = info.color;
      const displayRisk = info.valid ? info.level : info.label;
      const riskLabel = info.valid && info.level !== null ? RISK_LABELS[info.level] : '未知';

      return {
        type: 'Feature',
        geometry: s.geometry,
        properties: {
          id: s.section_id,
          name: s.section_name || s.section_id,
          risk_level: displayRisk,
          risk_label: riskLabel,
          color: color
        }
      };
    });


    // 更新/创建 source（支持高频刷新）
    const fc = turf.featureCollection(features as any);
    const existingSource = map.getSource('sections-source') as mapboxgl.GeoJSONSource | undefined;
    if (existingSource) {
      existingSource.setData(fc as any);
    } else {
      map.addSource('sections-source', {
        type: 'geojson',
        data: fc as any
      });
    }

    // 若图层不存在则创建一次；后续仅更新 source 数据与可见性
    if (!map.getLayer('sections-line')) {
      map.addLayer({
        id: 'sections-line',
        type: 'line',
        source: 'sections-source',
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
          'visibility': showSections ? 'visible' : 'none'
        },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 5,
          'line-opacity': 0.9
        }
      });
    }

    if (!map.getLayer('sections-line-hit')) {
      map.addLayer({
        id: 'sections-line-hit',
        type: 'line',
        source: 'sections-source',
        paint: {
          'line-width': 12,
          'line-opacity': 0
        },
        layout: {
          'visibility': showSections ? 'visible' : 'none'
        }
      });
    }

    // 事件只绑定一次（防止轮询刷新导致重复绑定）
    if (!sectionClickHandlerRef.current) {
      sectionClickHandlerRef.current = (e: any) => {
        if (!e.features || e.features.length === 0) return;
        const f = e.features[0];
        const p = f.properties;
        if (!p) return;

        const root = document.createElement('div');
        root.style.padding = '6px 6px 4px';
        root.style.fontFamily = 'sans-serif';

        const title = document.createElement('div');
        title.textContent = String(p.name ?? '断面');
        title.style.margin = '0';
        title.style.fontWeight = '700';
        title.style.color = '#1e293b';
        title.style.fontSize = '13px';
        root.appendChild(title);

        const meta = document.createElement('div');
        meta.textContent = `断面ID: ${p.id}`;
        meta.style.marginTop = '4px';
        meta.style.fontSize = '12px';
        meta.style.color = '#64748b';
        root.appendChild(meta);

        const risk = document.createElement('div');
        risk.style.marginTop = '4px';
        risk.style.fontSize = '12px';
        risk.style.color = '#64748b';
        risk.innerHTML = `风险等级: <span style="color:${p.color}; font-weight:700;">${p.risk_label}</span>`;
        root.appendChild(risk);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = '查看细节';
        btn.style.marginTop = '8px';
        btn.style.border = 'none';
        btn.style.background = '#3b82f6';
        btn.style.color = 'white';
        btn.style.borderRadius = '6px';
        btn.style.padding = '4px 8px';
        btn.style.cursor = 'pointer';
        btn.style.fontSize = '12px';
        btn.onclick = () => {
          const sid = String(p.id);
          const sname = String(p.name ?? '断面');
          const tid = selectedTaskRef.current;
          openMatrixDetail(tid, sid, sname);
        };
        root.appendChild(btn);

        new mapboxgl.Popup().setLngLat(e.lngLat).setDOMContent(root).addTo(map);
      };
      sectionEnterHandlerRef.current = () => {
        map.getCanvas().style.cursor = 'pointer';
      };
      sectionLeaveHandlerRef.current = () => {
        map.getCanvas().style.cursor = '';
      };

      map.off('click', 'sections-line-hit', sectionClickHandlerRef.current);
      map.on('click', 'sections-line-hit', sectionClickHandlerRef.current);

      map.off('mouseenter', 'sections-line-hit', sectionEnterHandlerRef.current);
      map.on('mouseenter', 'sections-line-hit', sectionEnterHandlerRef.current);

      map.off('mouseleave', 'sections-line-hit', sectionLeaveHandlerRef.current);
      map.on('mouseleave', 'sections-line-hit', sectionLeaveHandlerRef.current);
    }
  };

  // 颜色插值逻辑: 基于同一岸段下所有断面中点生成一条折线，并根据中点的风险值插值颜色
  const applyShorelineGradient = (sections: SectionResult[]) => {
    const map = mapRef.current;
    if (!map || !sections || sections.length === 0) return;

    // 1. 按 bank_id 分组
    const groups: Record<string, SectionResult[]> = {};
    sections.forEach(s => {
      const bid = s.bank_id || 'unknown';
      if (!groups[bid]) groups[bid] = [];
      groups[bid].push(s);
    });

    // 2. 遍历每个岸段组
    Object.keys(groups).forEach(bankId => {
      const bankSections = groups[bankId];
      if (!bankSections || bankSections.length < 2) return;

      // 计算每个断面中点，并按传入的断面顺序（即 sections 数组本身的顺序）连接
      // 说明：此前按经纬度排序（西→东、北→南）会改变生成顺序；现在改为使用后端/生成顺序（section 列表顺序）
      const points = bankSections
        .filter(s => s && s.geometry && s.geometry.type === 'LineString')
        .map(s => {
          const coords = (s.geometry as any).coordinates as number[][];
          if (!coords || coords.length < 2) return null;
          const ap = getVerticalFootCoordsFromAny(s);
          const mid: number[] = ap
            ? [Number(ap[0]), Number(ap[1])]
            : [
                (coords[0][0] + coords[1][0]) / 2,
                (coords[0][1] + coords[1][1]) / 2,
              ];
          const info = computeColorWithMatrix(s.indicator_result);
          return { mid, color: info.color, section: s, valid: info.valid };
        })
        .filter(Boolean) as Array<{ mid: number[]; color: string; section: SectionResult; valid: boolean }>;

      if (points.length < 2) return;

      const midpoints = points.map(p => p.mid as number[]);
      const shouldClose = turf.distance(points[0].mid as any, points[points.length - 1].mid as any, { units: 'meters' }) < CLOSE_LOOP_DISTANCE_METERS;
      const lineCoords = shouldClose ? [...midpoints, midpoints[0]] : midpoints;
      const newLine = turf.lineString(lineCoords as any);
      const totalDist = turf.length(newLine, { units: 'meters' });

      // 构建颜色梯度参数（沿排序后的折线累积距离）
      const riskStops: { val: number; color: string }[] = [];
      let currentDist = 0;
      for (let idx = 0; idx < points.length; idx++) {
        if (idx > 0) {
          const prevMid = points[idx - 1].mid;
          const currMid = points[idx].mid;
          currentDist += turf.distance(prevMid as any, currMid as any, { units: 'meters' });
        }
        const progress = totalDist > 0 ? (currentDist / totalDist) : 0;
        if (points[idx].valid) {
          riskStops.push({ val: progress, color: points[idx].color });
        }
      }

      // Mapbox interpolate 表达式格式
      const stops: any[] = ['interpolate', ['linear'], ['line-progress']];
      if (riskStops.length === 0) {
        stops.push(0, RISK_COLORS.default, 1, RISK_COLORS.default);
      } else if (riskStops.length === 1) {
        stops.push(0, riskStops[0].color, 1, riskStops[0].color);
      } else {
        riskStops.forEach(rs => {
          const val = Math.max(0, Math.min(1, rs.val));
          stops.push(val, rs.color);
        });
        if (shouldClose) {
          stops.push(1, riskStops[0].color);
        }
      }

      // 渲染新生成的中间折线
      const layerId = `midline-result-${bankId}`;
      const sourceId = `midline-source-${bankId}`;

      const existing = map.getSource(sourceId) as mapboxgl.GeoJSONSource | undefined;
      if (existing) {
        existing.setData(newLine as any);
      } else {
        map.addSource(sourceId, { type: 'geojson', data: newLine as any, lineMetrics: true } as any);
      }

      if (!map.getLayer(layerId)) {
        map.addLayer({
          id: layerId,
          type: 'line',
          source: sourceId,
          paint: {
            'line-width': 20,
            'line-gradient': stops as any,
            'line-opacity': 0.7
          }
        });
      } else {
        map.setPaintProperty(layerId, 'line-gradient', stops as any);
      }
    });
  };

  // 底图切换
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const style = satellite
      ? 'mapbox://styles/mapbox/satellite-v9'
      : 'mapbox://styles/mapbox/light-v10';
    map.setStyle(style);
  }, [satellite]);

  // 初始化地图（沿用 EditorPage 的风格）
  useEffect(() => {
    if (!mapContainer.current) return;

    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/light-v10',
      center: [119.89600633, 32.22907004],
      zoom: 7,
    });

    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl(), 'top-left');

    const initLayers = () => {
      map.addSource('uploaded-data', { type: 'geojson', data: turf.featureCollection([]) });
      map.addLayer({
        id: 'uploaded-lines-base',
        type: 'line',
        source: 'uploaded-data',
        filter: ['==', '$type', 'LineString'],
        paint: { 'line-color': '#94a3b8', 'line-width': 2 }
      });
      setMapReady(true);
    };

    map.on('load', initLayers);
    map.on('style.load', initLayers);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    requestAnimationFrame(() => map.resize());
  }, [resizeTrigger]);

  const progressPercent = useMemo(() => {
    if (!progress) return 0;
    if (progress.expectedTotal <= 0) return 0;
    return Math.round((progress.processedCount / progress.expectedTotal) * 100);
  }, [progress]);

  const toggleErrorExpanded = (sectionId: string) => {
    const willExpand = !expandedErrorIds[sectionId];
    setExpandedErrorIds(prev => ({ ...prev, [sectionId]: willExpand }));
    if (willExpand && progress?.taskId && sectionId) loadErrorDetail(progress.taskId, sectionId);
  };

  // — 活动栏图标按钮通用样式
  const activityBarBtnStyle = (active: boolean): React.CSSProperties => ({
    width: 38, height: 38, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    border: 'none', borderRadius: 6, cursor: 'pointer',
    background: active ? '#e0e7ff' : 'transparent',
    color: active ? '#2563eb' : '#94a3b8',
    gap: 1,
  });

  // — 地图覆盖按钮通用样式（卫星/聊天切换）
  const MAP_OVERLAY_BTN_STYLE: React.CSSProperties = {
    position: 'absolute', right: 12, zIndex: 10,
    background: 'rgba(255,255,255,0.7)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    border: '1px solid rgba(0,0,0,0.08)',
    borderRadius: 14, padding: '6px 12px', cursor: 'pointer',
    fontSize: '0.8rem', color: '#334155',
    display: 'flex', alignItems: 'center', gap: 4,
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
  };

  // ============================================================
  //  JSX 渲染
  // ============================================================

  return (
    <div className="editor-layout">
      <div className="editor-sidebar-panel" style={{ width: leftPanelWidth, minWidth: leftPanelWidth, display: 'flex' }}>
        {/* Activity Bar - narrow icon column */}
        <div style={{
          width: 44, minWidth: 44,
          background: 'rgba(255,255,255,0.3)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          borderRight: '1px solid rgba(255,255,255,0.3)',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          paddingTop: 12, gap: 2,
        }}>
          <button
            onClick={() => setActiveSidebarPanel('tasks')}
            title="任务列表"
            style={activityBarBtnStyle(activeSidebarPanel === 'tasks')}
            data-tour="result-tasks"
          ><List size={16} /></button>
          <button
            onClick={() => setActiveSidebarPanel('reports')}
            title="报告查看"
            style={activityBarBtnStyle(activeSidebarPanel === 'reports')}
            data-tour="result-reports"
          ><FileText size={16} /></button>
          <button
            onClick={() => setActiveSidebarPanel('skills')}
            title="Skills"
            style={activityBarBtnStyle(activeSidebarPanel === 'skills')}
            data-tour="result-skills"
          ><Box size={16} /></button>
          <button
            onClick={() => setActiveSidebarPanel('agents')}
            title="智能体"
            style={activityBarBtnStyle(activeSidebarPanel === 'agents')}
          ><Bot size={16} /></button>
        </div>

        {/* Content panel - shows the active section only */}
        <div className="upload-control result-sidebar" style={{ position: 'static', flex: 1, height: '100%', top: 0, left: 0, background: 'transparent' }}>
          {/* === TASKS PANEL === */}
          {activeSidebarPanel === 'tasks' && (
            <>
              <div className="sidebar-header">
                <List size={14} />
                <h4>任务列表</h4>
              </div>
              <div className="task-list-container">
                {taskList.length === 0 && !loading && <p className="empty-hint">暂无任务</p>}
                {taskList.map(task => (
                  <div 
                    key={task.task_id} 
                    className={`task-item ${selectedTask === task.task_id ? 'active' : ''}`}
                    onClick={() => handleTaskClick(task.task_id)}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/task-id', task.task_id);
                      e.dataTransfer.setData('application/task-name', task.task_name);
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <div className="task-title">{task.task_name}</div>
                        <div className="task-meta">
                          ID: {task.task_id} | {new Date(task.created_at).toLocaleDateString()}
                        </div>
                      </div>
                      <button className="task-delete-btn" onClick={(e) => {
                        e.stopPropagation();
                        if (!confirm(`确认删除任务「${task.task_name}」？`)) return;
                        handleDeleteTaskById(task.task_id);
                      }} title="删除任务">×</button>
                    </div>
                  </div>
                ))}
              </div>

                    <button
                className="toggle-sections-btn"
                onClick={() => setShowSections(!showSections)}
              >
                {showSections ? '隐藏断面' : '显示断面'}
              </button>

              {loading && <div className="loading-spinner">数据加载中...</div>}
              {error && <p className="error-message">错误: {error}</p>}
              
              {selectedTask && !loading && (
                <div className="result-info">
                  <h5>当前分析结果</h5>
                  <div className="legend">
                    <div className="legend-item"><span className="dot high"></span>极高风险</div>
                    <div className="legend-item"><span className="dot medium"></span>高风险</div>
                    <div className="legend-item"><span className="dot low"></span>一般风险</div>
                    <div className="legend-item"><span className="dot no"></span>低/无风险</div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* === REPORTS PANEL === */}
          {activeSidebarPanel === 'reports' && (
            <>
              <div className="sidebar-header">
                <FileText size={14} />
                <h4>报告查看</h4>
              </div>
              <div className="task-list-container" style={{ maxHeight: 'calc(100% - 50px)', overflowY: 'auto' }}>
                {reportList.length === 0 && <p className="empty-hint">暂无报告</p>}
                {reportList.map((r: any, i: number) => (
                  <div
                    key={r.filename || i}
                    className="task-item"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/report-filename', r.filename);
                      e.dataTransfer.setData('application/report-taskid', r.taskId || '');
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'grab' }}
                  >
                    <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => openReport(r.filename)}>
                      <div className="task-title" style={{ fontSize: '0.8rem' }}>{r.taskId ? `任务 ${r.taskId}` : r.filename}</div>
                      <div className="task-meta" style={{ fontSize: '0.7rem' }}>{r.time || ''}</div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!confirm('确定删除此报告？')) return;
                        fetch(`/v0/bank/ai/reports/${encodeURIComponent(r.filename)}`, { method: 'DELETE' })
                          .then(() => fetchReportList());
                      }}
                      style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', padding: '2px 4px' }}
                      title="删除报告"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* === AGENTS PANEL === */}
          {activeSidebarPanel === 'agents' && (
            <>
              <div className="sidebar-header">
                <Bot size={14} />
                <h4>智能体</h4>
              </div>
              <div className="task-list-container" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                {[
                  { id: 'chief', name: '总工程师', role: 'Leader', desc: '统筹调度制图师与水文专家，规划任务执行流程', color: '#d97706' },
                  { id: 'cartographer', name: '制图师', role: 'Member', desc: '负责空间数据可视化、岸段地图渲染与断面图表生成', color: '#3b82f6' },
                  { id: 'hydrologist', name: '水文专家', role: 'Member', desc: '负责水文参数分析、风险评估模型计算与报告编写', color: '#10b981' },
                  ...customAgents.map(c => ({ ...c, role: 'Member' as const })),
                ].map((agent) => (
                  <div
                    key={agent.id}
                    className="task-item"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('agent-id', agent.id);
                      e.dataTransfer.setData('agent-name', agent.name);
                      e.dataTransfer.setData('agent-color', agent.color);
                      e.dataTransfer.setData('agent-role', agent.role);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    style={{ cursor: 'grab' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <div className="task-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>{agent.name}</span>
                          <span style={{
                            fontSize: '0.6rem', padding: '1px 6px', borderRadius: 3,
                            background: agent.role === 'Leader' ? '#fef3c7' : '#f1f5f9',
                            color: agent.role === 'Leader' ? '#d97706' : '#64748b',
                            border: `1px solid ${agent.role === 'Leader' ? 'rgba(217,119,6,0.3)' : 'rgba(0,0,0,0.08)'}`,
                          }}>{agent.role === 'Leader' ? '总指挥' : '成员'}</span>
                        </div>
                        <div className="task-meta" style={{ marginTop: 2 }}>{agent.desc}</div>
                      </div>
                      <span style={{
                        width: 10, height: 10, borderRadius: '50%', background: agent.color,
                        marginTop: 4, flexShrink: 0,
                      }} />
                    </div>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setShowCreateAgent(!showCreateAgent)}
                style={{
                  width: '100%', marginTop: 8, padding: '6px 0',
                  border: '1px dashed rgba(0,0,0,0.15)', borderRadius: 12,
                  background: 'rgba(255,255,255,0.3)', cursor: 'pointer',
                  fontSize: '0.75rem', color: '#64748b',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                }}
              >
                <UserPlus size={14} /> 创建智能体
              </button>

              {showCreateAgent && (
                <div style={{
                  marginTop: 8, padding: 12,
                  border: '1px solid rgba(249,115,22,0.3)', borderRadius: 14,
                  background: 'rgba(255,255,255,0.45)',
                  display: 'flex', flexDirection: 'column', gap: 8,
                }}>
                  <input
                    placeholder="智能体名称"
                    value={newAgentName}
                    onChange={(e) => setNewAgentName(e.target.value)}
                    style={{
                      width: '100%', padding: '6px 10px', border: '1px solid rgba(0,0,0,0.1)',
                      borderRadius: 8, fontSize: '0.78rem', outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                  <input
                    placeholder="职能描述"
                    value={newAgentDesc}
                    onChange={(e) => setNewAgentDesc(e.target.value)}
                    style={{
                      width: '100%', padding: '6px 10px', border: '1px solid rgba(0,0,0,0.1)',
                      borderRadius: 8, fontSize: '0.78rem', outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: '0.7rem', color: '#64748b', whiteSpace: 'nowrap' }}>颜色:</span>
                    {AGENT_COLORS.map(c => (
                      <button
                        key={c}
                        onClick={() => setNewAgentColor(c)}
                        style={{
                          width: 22, height: 22, borderRadius: '50%',
                          background: c, border: newAgentColor === c
                            ? '2px solid #1e293b'
                            : '2px solid rgba(0,0,0,0.08)',
                          cursor: 'pointer', padding: 0,
                          boxShadow: newAgentColor === c ? `0 0 0 2px rgba(255,255,255,0.8), 0 0 8px ${c}66` : 'none',
                          transition: 'all 0.15s',
                          flexShrink: 0,
                        }}
                      />
                    ))}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: '0.7rem', color: '#64748b', whiteSpace: 'nowrap' }}>角色:</span>
                    <button
                      onClick={() => setNewAgentRole('Member')}
                      style={{
                        flex: 1, padding: '4px 0', border: newAgentRole === 'Member' ? '1.5px solid #3b82f6' : '1px solid rgba(0,0,0,0.1)',
                        borderRadius: 6, background: newAgentRole === 'Member' ? '#e0e7ff' : 'transparent',
                        color: newAgentRole === 'Member' ? '#2563eb' : '#94a3b8',
                        fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer',
                      }}
                    >成员</button>
                    <button
                      onClick={() => setNewAgentRole('Leader')}
                      style={{
                        flex: 1, padding: '4px 0', border: newAgentRole === 'Leader' ? '1.5px solid #d97706' : '1px solid rgba(0,0,0,0.1)',
                        borderRadius: 6, background: newAgentRole === 'Leader' ? '#fef3c7' : 'transparent',
                        color: newAgentRole === 'Leader' ? '#d97706' : '#94a3b8',
                        fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer',
                      }}
                    >总指挥</button>
                  </div>
                  <button
                    onClick={() => {
                      if (!newAgentName.trim()) return;
                      setCustomAgents([...customAgents, {
                        id: 'custom_' + Date.now(),
                        name: newAgentName.trim(),
                        desc: newAgentDesc.trim() || '自定义智能体',
                        color: newAgentColor,
                        role: newAgentRole,
                      }]);
                      setNewAgentName('');
                      setNewAgentDesc('');
                      setNewAgentColor('#8b5cf6');
                      setNewAgentRole('Member');
                      setShowCreateAgent(false);
                    }}
                    style={{
                      width: '100%', padding: '6px 0', border: 'none', borderRadius: 8,
                      background: 'rgba(249,115,22,0.15)', color: '#9A3412',
                      fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer',
                    }}
                  >确认创建</button>
                </div>
              )}
            </>
          )}

    {/* === SKILLS PANEL === */}
    {activeSidebarPanel === 'skills' && (
      <>
        <div className="sidebar-header">
          <Box size={14} />
          <h4>Skills</h4>
        </div>
        <div className="task-list-container" style={{ maxHeight: 'calc(100% - 50px)', overflowY: 'auto' }}>
          {skillList.length === 0 && <p className="empty-hint">暂无 Skills</p>}
          {skillList.map((s: any) => (
            <div
              key={s.name}
              className="task-item"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', s.name);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              style={{ cursor: 'grab', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <div style={{ flex: 1 }}>
                <div className="task-title" style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                  {s.source === 'local' ? '📁' : s.source === 'synced' ? '✅' : '☁️'} {s.name}
                  <span style={{
                    fontSize: '0.6rem', padding: '1px 5px', borderRadius: 3,
                    background: s.source === 'local' ? '#dbeafe' : s.source === 'synced' ? '#dcfce7' : '#fef3c7',
                    color: s.source === 'local' ? '#2563eb' : s.source === 'synced' ? '#16a34a' : '#d97706',
                  }}>{s.source === 'local' ? '本地' : s.source === 'synced' ? '已同步' : 'Nacos'}</span>
                  {s.source === 'local' && (
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        try {
                          const res = await fetch(`/v0/bank/ai/skill/upload/${encodeURIComponent(s.name)}`, { method: 'POST' });
                          const d = await res.json();
                          if (d.success) { alert('上传成功！'); fetchSkills(); }
                          else alert('上传失败: ' + (d.error || '未知错误'));
                        } catch (err: any) { alert('网络错误'); }
                      }}
                      style={{
                        marginLeft: 4, fontSize: '0.6rem', padding: '1px 6px',
                        border: '1px solid #2563eb', background: '#dbeafe',
                        color: '#2563eb', borderRadius: 3, cursor: 'pointer',
                      }}
                    >上传</button>
                  )}
                  {s.source === 'nacos' && (
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        try {
                          const res = await fetch(`/v0/bank/ai/skill/download/${encodeURIComponent(s.name)}`, { method: 'POST' });
                          const d = await res.json();
                          if (d.success) alert('下载成功！重启后端后生效');
                          else alert('下载失败: ' + (d.error || '未知错误'));
                        } catch (err: any) { alert('下载失败: ' + (err.message || '网络错误')); }
                      }}
                      style={{
                        marginLeft: 4, fontSize: '0.6rem', padding: '1px 6px',
                        border: '1px solid #d97706', background: '#fef3c7',
                        color: '#d97706', borderRadius: 3, cursor: 'pointer',
                      }}
                    >下载到本地</button>
                  )}
                </div>
                <div className="task-meta" style={{ fontSize: '0.7rem' }}>{s.description || ''}</div>
              </div>
            </div>
          ))}
        </div>
      </>
    )}
        </div>
      </div>
      <ResizeHandle onResize={(delta) => setLeftPanelWidth(w => Math.max(200, Math.min(600, w + delta)))} onDragEnd={() => setResizeTrigger(t => t + 1)} />
      <div className="editor-map-panel" style={{ display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>
        {/* ===== LEFT: 智能体编排画布 ===== */}
        <div className="workbench-orchestra-panel" style={{
          flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0,
          background: 'rgba(255,255,255,0.75)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}>
          <div style={{
            padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.06)',
            fontSize: '0.82rem', fontWeight: 700, color: '#1e293b',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <Bot size={16} /> 智能体编排
          </div>
          <div
            ref={canvasRef}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
            onDrop={(e) => {
              e.preventDefault();
              const agentId = e.dataTransfer.getData('agent-id');
              const agentRole = e.dataTransfer.getData('agent-role');
              if (!agentId) return;
              const rect = canvasRef.current?.getBoundingClientRect();
              if (!rect) return;
              // 检查是否已有 leader
              if (agentRole === 'Leader') {
                const allAgents = getAgentById(agentId);
                const hasLeader = [...orchestratedAgents].some(id => {
                  const a = getAgentById(id);
                  return a && (a.role === 'Leader' || id === 'chief');
                });
                if (hasLeader) return; // 只能有一个总指挥
              }
              const x = ((e.clientX - rect.left) / rect.width) * 100;
              const y = ((e.clientY - rect.top) / rect.height) * 100;
              setOrchestratedAgents((prev) => {
                const next = new Set(prev);
                next.add(agentId);
                return next;
              });
              setAgentPositions((prev) => ({ ...prev, [agentId]: { x: Math.round(x), y: Math.round(y) } }));
            }}
            onMouseMove={(e) => {
              if (!dragAgent || !canvasRef.current) return;
              const rect = canvasRef.current.getBoundingClientRect();
              const x = ((e.clientX - rect.left) / rect.width) * 100;
              const y = ((e.clientY - rect.top) / rect.height) * 100;
              setAgentPositions((prev) => ({ ...prev, [dragAgent]: { x: Math.round(Math.max(0, Math.min(100, x))), y: Math.round(Math.max(0, Math.min(100, y))) } }));
            }}
            onMouseUp={() => setDragAgent(null)}
            onMouseLeave={() => setDragAgent(null)}
            style={{
              flex: 1, position: 'relative', overflow: 'hidden',
              backgroundImage: 'radial-gradient(circle, rgba(0,0,0,0.08) 1px, transparent 1px)',
              backgroundSize: '20px 20px',
            }}
          >
            {orchestratedAgents.size === 0 ? (
              <div style={{
                position: 'absolute', inset: 0, display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                pointerEvents: 'none',
              }}>
                <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>
                  从左侧智能体列表拖拽到此编排画布（需先放置一位总指挥）
                </p>
              </div>
            ) : (
              <>
                {/* SVG 连线：从 leader 到每个非 leader 成员 */}
                <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 0 }}>
                  {(() => {
                    const ids = [...orchestratedAgents];
                    const leaderId = ids.find(id => {
                      const a = getAgentById(id);
                      return a?.role === 'Leader' || id === 'chief';
                    });
                    if (!leaderId) return null;
                    const leaderPos = agentPositions[leaderId] || { x: 50, y: 15 };
                    return ids.filter(id => id !== leaderId).map((memberId) => {
                      const memberPos = agentPositions[memberId] || { x: 30, y: 50 };
                      return (
                        <line
                          key={memberId}
                          x1={`${leaderPos.x}%`} y1={`${leaderPos.y}%`}
                          x2={`${memberPos.x}%`} y2={`${memberPos.y}%`}
                          stroke="rgba(249,115,22,0.35)"
                          strokeWidth="2"
                          markerEnd="url(#arrowhead)"
                        />
                      );
                    });
                  })()}
                  <defs>
                    <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                      <polygon points="0 0, 8 3, 0 6" fill="rgba(249,115,22,0.35)" />
                    </marker>
                  </defs>
                </svg>
                {/* 渲染所有编排中的智能体 */}
                {[...orchestratedAgents].map((agentId) => {
                  const agent = getAgentById(agentId);
                  if (!agent) return null;
                  const isLeader = agent.role === 'Leader' || agentId === 'chief';
                  const defaultPos = isLeader
                    ? { x: 50, y: 15 }
                    : { x: 25 + Math.random() * 50, y: 35 + Math.random() * 50 };
                  const pos = agentPositions[agentId] || defaultPos;
                  return (
                    <AgentCircle
                      key={agentId}
                      agent={agent}
                      pos={pos}
                      label={isLeader ? agent.name.substring(0, 2) : agent.name.charAt(0)}
                      isLeader={isLeader}
                      onDragStart={() => setDragAgent(agentId)}
                      onRemove={() => {
                        setOrchestratedAgents((prev) => {
                          const next = new Set(prev); next.delete(agentId); return next;
                        });
                        setAgentPositions((prev) => {
                          const next = { ...prev };
                          delete next[agentId];
                          return next;
                        });
                      }}
                    />
                  );
                })}
              </>
            )}
          </div>
        </div>

        {/* ===== RIGHT: 结果输出 ===== */}
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0,
          background: 'rgba(248,250,252,0.85)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        }}>
          <div style={{
            padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.06)',
            fontSize: '0.82rem', fontWeight: 700, color: '#1e293b',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <MessageCircle size={16} /> 结果输出
          </div>
          <div style={{
            flex: 1, padding: 16, overflowY: 'auto',
            color: '#64748b', fontSize: '0.78rem', fontFamily: 'monospace',
          }}>
            <p style={{ color: '#94a3b8' }}>智能体编排完成后，运行结果将在此处展示</p>
          </div>
        </div>
      </div>
      {!chatCollapsed && <ResizeHandle onResize={(delta) => setRightPanelWidth(w => Math.max(200, Math.min(600, w - delta)))} onDragEnd={() => setResizeTrigger(t => t + 1)} />}
      <ChatPanel collapsed={chatCollapsed} onToggleCollapse={() => setChatCollapsed(!chatCollapsed)} width={rightPanelWidth} selectedSkills={selectedSkills} setSelectedSkills={setSelectedSkills} chatTasks={chatTasks} setChatTasks={setChatTasks} chatReports={chatReports} setChatReports={setChatReports} onReportsUpdated={() => { fetchReportList(); }} />
    </div>
  );
}

export default SmartWorkbenchPage;