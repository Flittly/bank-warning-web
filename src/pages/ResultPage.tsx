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
import { Box, FileText, List, BarChart3, MessageCircle } from 'lucide-react';

// 与 EditorPage 保持一致的 Mapbox token
mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

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
  risk_level?: string | number; // 字符串(high, medium, low, no) 或 数字(1, 2, 3, 4)
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

const CLOSE_LOOP_DISTANCE_METERS = 2000;

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

interface ResultPageProps {
  initialTaskId?: string;
}

function ResultPage(props: ResultPageProps) {
  const { initialTaskId } = props;
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  const selectedTaskRef = useRef<string | null>(null);
  const autoOpenTaskRef = useRef<string | null>(null);

  const pollTimerRef = useRef<number | null>(null);
  const activePollTaskIdRef = useRef<string | null>(null);
  const lastSectionsByTaskRef = useRef<Record<string, SectionResult[]>>({});

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
  const [resizeTrigger, setResizeTrigger] = useState(0);
  const [leftPanelWidth, setLeftPanelWidth] = useState(350);
  const [rightPanelWidth, setRightPanelWidth] = useState(350);
  const [reportTabs, setReportTabs] = useState<ReportTab[]>([]);
  const [activeReportTab, setActiveReportTab] = useState(0);
  const [workspaceHeight, setWorkspaceHeight] = useState(300);
  const [generatingTaskId, setGeneratingTaskId] = useState<string | null>(null);
  const [reportList, setReportList] = useState<any[]>([]);
  const [activeSidebarPanel, setActiveSidebarPanel] = useState<'tasks' | 'reports' | 'progress' | 'skills'>('tasks');
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [skillList, setSkillList] = useState<any[]>([]);
  const [chatTaskId, setChatTaskId] = useState<string | null>(null);
  const [chatTaskName, setChatTaskName] = useState<string>('');
  const [chatTasks, setChatTasks] = useState<{ taskId: string; taskName: string }[]>([]);

  const profilesCacheRef = useRef<Record<string, Record<string, SectionProfile>>>({});
  const profilesPromiseRef = useRef<Record<string, Promise<Record<string, SectionProfile>> | null>>({});
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileDetail, setProfileDetail] = useState<SectionProfile | null>(null);

  const handleGenerateReport = async (taskId: string, taskName: string) => {
    setGeneratingTaskId(taskId);
    try {
      const res = await fetch(`/v0/bank/ai/agent/report/task/${taskId}`, { method: 'POST' });
      const data = await res.json();
      if (data.success && data.data) {
        const content = String(data.data).replace(/\.\/([^\s)]+\.png)/g, '/v0/bank/ai/viz-output/$1');
        setReportTabs(prev => {
          const existing = prev.findIndex(t => t.taskId === taskId);
          const newTab: ReportTab = { taskId, taskName, content, filename: data.filename };
          if (existing >= 0) {
            const next = [...prev];
            next[existing] = newTab;
            setActiveReportTab(existing);
            return next;
          }
          setActiveReportTab(prev.length);
          return [...prev, newTab];
        });
        if (reportTabs.length === 0) {
          setWorkspaceHeight(300);
        }
      } else {
        alert(translateError(data.error || '未知错误'));
      }
    } catch (e: any) {
      alert(translateError(e.message || '网络错误'));
    } finally {
      setGeneratingTaskId(null);
    }
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
          const existing = prev.findIndex(t => t.taskId === taskId);
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

  const parseProfilesList = (data: any): any[] => {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.profiles)) return data.profiles;
    if (Array.isArray(data.data?.profiles)) return data.data.profiles;
    if (Array.isArray(data.data)) return data.data;
    return [];
  };

  const ensureTaskProfilesLoaded = async (taskId: string) => {
    if (!taskId) return {} as Record<string, SectionProfile>;
    if (profilesCacheRef.current[taskId]) return profilesCacheRef.current[taskId];
    if (profilesPromiseRef.current[taskId]) return profilesPromiseRef.current[taskId]!;

    const promise = (async () => {
      const res = await fetch(`/v0/bank/tasks/${encodeURIComponent(taskId)}/section-profiles`);
      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${text?.slice(0, 500)}`);
      }

      const payload = json ?? text;
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
      const res = await fetch(`/v0/bank/results/${encodeURIComponent(sectionId)}`);
      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${text?.slice(0, 500)}`);
      }

      const payload = json ?? text;
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

  // 风险解析辅助：判断 risk_level 是否为 0-3 的有效数字
  const getRiskInfo = (risk: any) => {
    if (risk === null || risk === undefined) {
      return { valid: false, color: RISK_COLORS.default, label: '未知', level: null };
    }

    const n = Number(risk);
    if (!isNaN(n) && Number.isFinite(n) && n >= 0 && n <= 3) {
      return { valid: true, color: RISK_COLORS[String(n)] || RISK_COLORS.default, label: n, level: n };
    }

    // 非 0-3 的值视为未知（灰色）
    return { valid: false, color: RISK_COLORS.default, label: '未知', level: null };
  };

  // 颜色展示回退：仅按四级风险颜色展示（result 数值暂不参与）
  // 不同等级之间的过渡（岸线/中线）仍由 Mapbox 的 line-gradient 插值完成
  const computeColorWithMatrix = (baseLevel: any) => {
    return getRiskInfo(baseLevel);
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

  const parseResultsList = (data: any): any[] => {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.results)) return data.results;
    if (Array.isArray(data.data)) return data.data;
    if (Array.isArray(data.items)) return data.items;
    return [];
  };

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
      renderSections(mergedSections);
      applyShorelineGradient(mergedSections);
    }

    const shouldStop = completed || (expectedTotal > 0 && processedCount >= expectedTotal);
    if (shouldStop) {
      stopPolling();
    }
  };

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

    // 清除地图上所有之前任务的图层和数据源
    const map = mapRef.current;
    if (map) {
      // 清除断面图层
      ['sections-line-hit', 'sections-line'].forEach(layer => {
        if (map.getLayer(layer)) map.removeLayer(layer);
      });
      if (map.getSource('sections-source')) map.removeSource('sections-source');

      // 清除所有中线图层（以 midline- 开头的）
      const style = map.getStyle();
      if (style && style.layers) {
        style.layers.forEach((layer: any) => {
          if (layer.id && layer.id.startsWith('midline-')) {
            if (map.getLayer(layer.id)) map.removeLayer(layer.id);
          }
        });
      }
      
      // 清除所有中线数据源（以 midline- 开头的）
      if (style && style.sources) {
        Object.keys(style.sources).forEach((sourceId: string) => {
          if (sourceId.startsWith('midline-')) {
            if (map.getSource(sourceId)) map.removeSource(sourceId);
          }
        });
      }
    }

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
          risk_level: s.risk_level
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
      if (map) {
        ['sections-line-hit', 'sections-line'].forEach(layer => {
          if (map.getLayer(layer)) map.removeLayer(layer);
        });
        if (map.getSource('sections-source')) map.removeSource('sections-source');

        const style = map.getStyle();
        if (style && style.layers) {
          style.layers.forEach((layer: any) => {
            if (layer.id && typeof layer.id === 'string' && layer.id.startsWith('midline-')) {
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
      }
    } catch (e: any) {
      console.error('删除任务出错:', e);
      setError(e.message || '删除任务失败');
    } finally {
      setLoading(false);
    }
  };

  // 渲染断面集合几何并在地图显示
  const renderSections = (sections: SectionResult[]) => {
    const map = mapRef.current;
    if (!map) return;

    // 转换断面数据为 GeoJSON
    const features = sections.filter(s => s.geometry).map(s => {
      const info = computeColorWithMatrix(s.risk_level);
      const color = info.color;
      const displayRisk = info.valid ? info.level : info.label;

      // 风险等级的中文标签映射
      const RISK_LABELS: Record<number, string> = {
        3: '极高风险',
        2: '高风险',
        1: '一般风险',
        0: '低/无风险'
      };

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
          const info = computeColorWithMatrix(s.risk_level);
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
    map.addControl(new mapboxgl.NavigationControl(), 'top-right');

    map.on('load', () => {
      // 与 EditorPage 一样预留 uploaded-data 源供岸段使用
      map.addSource('uploaded-data', { type: 'geojson', data: turf.featureCollection([]) });
      map.addLayer({
        id: 'uploaded-lines-base',
        type: 'line',
        source: 'uploaded-data',
        filter: ['==', '$type', 'LineString'],
        paint: {
          'line-color': '#94a3b8',
          'line-width': 2
        }
      });
      // 标记地图加载完成，以触发自动点击逻辑
      setMapReady(true);
    });

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

  return (
    <div className="editor-layout">
      <div className="editor-sidebar-panel" style={{ width: leftPanelWidth, minWidth: leftPanelWidth, display: 'flex' }}>
        {/* Activity Bar - narrow icon column */}
        <div style={{
          width: 44, minWidth: 44, background: '#f1f5f9',
          borderRight: '1px solid #e2e8f0',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          paddingTop: 12, gap: 2,
        }}>
          <button
            onClick={() => setActiveSidebarPanel('tasks')}
            title="任务列表"
            style={{
              width: 38, height: 38, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              border: 'none', borderRadius: 6, cursor: 'pointer',
              background: activeSidebarPanel === 'tasks' ? '#e0e7ff' : 'transparent',
              color: activeSidebarPanel === 'tasks' ? '#2563eb' : '#94a3b8',
              gap: 1,
            }}
          ><List size={16} /></button>
          <button
            onClick={() => setActiveSidebarPanel('reports')}
            title="报告查看"
            style={{
              width: 38, height: 38, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              border: 'none', borderRadius: 6, cursor: 'pointer',
              background: activeSidebarPanel === 'reports' ? '#e0e7ff' : 'transparent',
              color: activeSidebarPanel === 'reports' ? '#2563eb' : '#94a3b8',
              gap: 1,
            }}
          ><FileText size={16} /></button>
          <button
            onClick={() => setActiveSidebarPanel('skills')}
            title="Skills"
            style={{
              width: 38, height: 38, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              border: 'none', borderRadius: 6, cursor: 'pointer',
              background: activeSidebarPanel === 'skills' ? '#e0e7ff' : 'transparent',
              color: activeSidebarPanel === 'skills' ? '#2563eb' : '#94a3b8',
              gap: 1,
            }}
          ><Box size={16} /></button>
          <button
            onClick={() => setActiveSidebarPanel('progress')}
            title="计算进度"
            style={{
              width: 38, height: 38, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              border: 'none', borderRadius: 6, cursor: 'pointer',
              background: activeSidebarPanel === 'progress' ? '#e0e7ff' : 'transparent',
              color: activeSidebarPanel === 'progress' ? '#2563eb' : '#94a3b8',
              gap: 1,
            }}
          ><BarChart3 size={16} /></button>
        </div>

        {/* Content panel - shows the active section only */}
        <div className="upload-control result-sidebar" style={{ position: 'static', flex: 1, height: '100%', top: 0, left: 0 }}>
          {/* === TASKS PANEL === */}
          {activeSidebarPanel === 'tasks' && (
            <>
              <div className="sidebar-header">
                <h4>任务列表</h4>
                <button 
                  className={`toggle-sections-btn ${!showSections ? 'hidden' : ''}`}
                  onClick={() => setShowSections(!showSections)}
                >
                  {showSections ? '隐藏断面' : '显示断面'}
                </button>
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
                    <div className="task-title">{task.task_name}</div>
                    <div className="task-meta">
                      ID: {task.task_id} | {new Date(task.created_at).toLocaleDateString()}
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleGenerateReport(task.task_id, task.task_name); }}
                      disabled={generatingTaskId === task.task_id}
                      style={{
                        marginTop: 6, padding: '3px 10px', fontSize: '0.75rem',
                        background: generatingTaskId === task.task_id ? '#94a3b8' : '#2563eb',
                        color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 4,
                      }}
                    >
                      <FileText size={12} />
                      {generatingTaskId === task.task_id ? '生成中...' : 'AI 出报告'}
                    </button>
                  </div>
                ))}
              </div>

              <button className="delete-task-btn" disabled={!selectedTask || loading} onClick={handleDeleteTask}>
                删除选中任务
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
                <h4>报告查看</h4>
              </div>
              <div className="task-list-container" style={{ maxHeight: 'calc(100% - 50px)', overflowY: 'auto' }}>
                {reportList.length === 0 && <p className="empty-hint">暂无报告</p>}
                {reportList.map((r: any, i: number) => (
                  <div key={r.filename || i} className="task-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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

          {/* === PROGRESS PANEL === */}
          {activeSidebarPanel === 'progress' && (
            <>
              <div className="sidebar-header">
                <h4>计算进度</h4>
              </div>
              {progressOpen && selectedTask ? (
                <div style={{ flex: 1, overflow: 'auto' }}>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: 8 }}>
                    任务: {progress?.taskName || selectedTask}
                    {progress?.status ? ` | 状态: ${progress.status}` : ''}
                  </div>
                  <progress
                    value={progress?.processedCount ?? 0}
                    max={Math.max(1, progress?.expectedTotal ?? 1)}
                    style={{ width: '100%', height: 6, accentColor: '#2563eb' }}
                  />
                  <div style={{ fontSize: '0.72rem', marginTop: 6, color: '#64748b' }}>
                    <div>进度: {progressPercent}% · 已处理: {progress?.processedCount ?? 0}/{progress?.expectedTotal ?? 0}</div>
                    <div>成功: {progress?.successCount ?? 0} · 失败: {progress?.errorCount ?? 0}</div>
                    <div style={{ marginTop: 2, fontSize: '0.65rem' }}>更新: {progress?.lastUpdatedAt ? new Date(progress.lastUpdatedAt).toLocaleTimeString() : '-'}</div>
                  </div>
                  {(progress?.errors?.length ?? 0) > 0 ? (
                    <div className="task-list-container" style={{ marginTop: 10 }}>
                      {progress!.errors.map(err => {
                        const expanded = Boolean(expandedErrorIds[err.section_id]);
                        return (
                          <div key={err.section_id} className="task-item" style={{ cursor: 'default' }}>
                            <div className="task-title" style={{ fontSize: '0.8rem', color: '#ef4444' }}>{err.section_name || err.section_id}</div>
                            <div className="task-meta" style={{ fontSize: '0.7rem' }}>{err.message}</div>
                            <button
                              onClick={() => toggleErrorExpanded(err.section_id)}
                              style={{
                                marginTop: 4, width: '100%', border: '1px solid #e2e8f0',
                                background: '#f8fafc', borderRadius: 4, cursor: 'pointer',
                                fontSize: '0.7rem', color: '#2563eb', padding: '4px 10px',
                                textAlign: 'center',
                              }}
                            >
                              {expanded ? '收起详情' : '查看详情'}
                            </button>
                            {expanded && (
                              <div style={{ marginTop: 6, padding: 8, background: '#f8fafc', borderRadius: 4, border: '1px solid #e2e8f0' }}>
                                {err.detailError && <div className="task-meta" style={{ fontSize: '0.7rem', color: '#ef4444', marginBottom: 6 }}>{err.detailError}</div>}
                                <pre style={{ fontSize: '0.68rem', margin: 0, whiteSpace: 'pre-wrap', color: '#64748b', lineHeight: 1.4, fontFamily: 'monospace' }}>{JSON.stringify(err.detail ?? err.raw ?? err, null, 2)}</pre>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="task-list-container" style={{ marginTop: 10 }}>
                      <p className="empty-hint">暂无断面错误信息</p>
                    </div>
                  )}
                  <button onClick={() => setProgressOpen(false)} className="delete-task-btn" style={{ width: '100%', marginTop: 10 }}>
                    关闭进度
                  </button>
                </div>
              ) : (
                <p className="empty-hint" style={{ marginTop: 16 }}>请先选择一个任务查看进度</p>
              )}
            </>
          )}

    {/* === SKILLS PANEL === */}
    {activeSidebarPanel === 'skills' && (
      <>
        <div className="sidebar-header">
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
      <div className="editor-map-panel" style={{ display: 'flex', flexDirection: 'column' }}>
        <div ref={mapContainer} className="map-full" style={{ flex: 1 }} />

        {matrixOpen && (
          <div className="matrix-modal-overlay" onClick={closeMatrixDetail}>
            <div className="matrix-modal" onClick={(e) => e.stopPropagation()}>
              <div className="matrix-modal-header">
                <div>
                  <div className="matrix-modal-title">断面矩阵详情</div>
                  <div className="matrix-modal-subtitle">
                    {matrixSectionName ? `${matrixSectionName} | ` : ''}断面ID: {matrixSectionId || '-'}
                  </div>
                </div>
                <div className="matrix-modal-header-actions">
                  <button className="matrix-modal-download" onClick={downloadMatrixCSV} title="下载CSV数据">
                    下载CSV
                  </button>
                  <button className="matrix-modal-close" onClick={closeMatrixDetail}>关闭</button>
                </div>
              </div>

              <div className="matrix-body">
                {matrixLoading ? (
                  <div className="matrix-loading">加载中...</div>
                ) : matrixError ? (
                  <div className="matrix-error">{matrixError}</div>
                ) : matrixDetail ? (
                  <>
                    <div className="matrix-kv">
                      <div className="matrix-kv-row"><span>case-id</span><span>{formatCellValue(matrixDetail['case-id'] ?? matrixDetail.case_id ?? matrixDetail.caseId)}</span></div>
                      <div className="matrix-kv-row"><span>task_id</span><span>{formatCellValue(matrixDetail.task_id ?? matrixDetail.taskId ?? matrixDetail.taskId)}</span></div>
                      <div className="matrix-kv-row"><span>section_id</span><span>{formatCellValue(matrixDetail.section_id ?? matrixDetail.sectionId ?? matrixDetail.sectionId)}</span></div>
                      <div className="matrix-kv-row"><span>section_name</span><span>{formatCellValue(matrixDetail.section_name ?? matrixDetail.sectionName ?? matrixDetail.section_name)}</span></div>
                      <div className="matrix-kv-row"><span>region_code</span><span>{formatCellValue(matrixDetail.region_code ?? matrixDetail.regionCode ?? matrixDetail.region_code)}</span></div>
                      <div className="matrix-kv-row"><span>bank_id</span><span>{formatCellValue(matrixDetail.bank_id ?? matrixDetail.bankId ?? matrixDetail.bank_id)}</span></div>
                      <div className="matrix-kv-row"><span>run_time</span><span>{formatCellValue(matrixDetail.run_time ?? matrixDetail.runTime ?? matrixDetail.run_time)}</span></div>
                      <div className="matrix-kv-row"><span>流量 (water_qs)</span><span>{formatCellValue(matrixDetail.water_qs ?? matrixDetail?.indicators?.water_qs ?? matrixDetail?.water_qs)}</span></div>
                      <div className="matrix-kv-row"><span>潮差 (tidal_level)</span><span>{formatCellValue(matrixDetail.tidal_level ?? matrixDetail?.indicators?.tidal_level ?? matrixDetail?.tidal_level)}</span></div>
                      <div className="matrix-kv-row"><span>风险等级</span><span>{formatCellValue(matrixDetail.risk_level ?? matrixDetail.riskLevel)}</span></div>
                      
                    </div>

                    <div className="matrix-section-title">指标矩阵</div>
                    <div className="matrix-assessment-list">
                      {(() => {
                        const indicators = matrixDetail?.indicators?.thresholds ?? matrixDetail?.thresholds ?? {};
                        const renderedGroups = MATRIX_GROUPS.map((group, idx) => renderAssessmentGroup(group, indicators, idx)).filter(Boolean);
                        if (renderedGroups.length === 0) {
                          return <div className="matrix-empty">无矩阵数据</div>;
                        }
                        return renderedGroups;
                      })()}
                    </div>
                  </>
                ) : (
                  <div className="matrix-empty">无矩阵数据</div>
                )}

                <div className="profile-section-title">断面剖面折线</div>
                {profileLoading ? (
                  <div className="profile-loading">加载中...</div>
                ) : profileError ? (
                  <div className="profile-error">{profileError}</div>
                ) : (
                  renderProfileChart(getProfileSeries(profileDetail))
                )}
              </div>
            </div>
          </div>
        )}

        <button
          onClick={() => { setChatCollapsed(!chatCollapsed); setTimeout(() => setResizeTrigger(t => t + 1), 350); }}
          style={{
            position: 'absolute', top: 140, right: 12, zIndex: 10,
            background: '#ffffff', border: '1px solid #e2e8f0',
            borderRadius: 6, padding: '6px 10px', cursor: 'pointer',
            fontSize: '0.8rem', color: '#64748b',
            display: 'flex', alignItems: 'center', gap: 4,
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          }}
          title={chatCollapsed ? '展开聊天' : '收起聊天'}
        >
          <MessageCircle size={16} />
          {chatCollapsed ? 'AI' : '收起'}
        </button>
        {reportTabs.length > 0 && (
          <>
            <VerticalResizeHandle onResize={(delta) => setWorkspaceHeight(h => Math.max(80, h + delta))} onDragEnd={() => setResizeTrigger(t => t + 1)} />
            <WorkspacePanel
              tabs={reportTabs}
              activeTabIndex={activeReportTab}
              onSelectTab={setActiveReportTab}
              onCloseTab={(i) => {
                setReportTabs(prev => prev.filter((_, idx) => idx !== i));
                if (i <= activeReportTab && activeReportTab > 0) {
                  setActiveReportTab(prev => Math.max(0, prev - 1));
                }
              }}
              onUpdateTab={async (i, content) => {
                const tab = reportTabs[i];
                let filename = tab.filename;
                if (!filename) {
                  const ts = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
                  filename = `report_${tab.taskId}_${ts}.md`;
                }
                const res = await fetch(`/v0/bank/ai/reports/${encodeURIComponent(filename)}`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ content }),
                });
                const data = await res.json();
                if (!data.success) throw new Error(data.error || '保存失败');
                setReportTabs(prev => {
                  const next = [...prev];
                  next[i] = { ...next[i], content, filename };
                  return next;
                });
                fetchReportList();
              }}
              height={workspaceHeight}
            />
          </>
        )}
      </div>
      {!chatCollapsed && <ResizeHandle onResize={(delta) => setRightPanelWidth(w => Math.max(200, Math.min(600, w - delta)))} onDragEnd={() => setResizeTrigger(t => t + 1)} />}
      <ChatPanel collapsed={chatCollapsed} onToggleCollapse={() => setChatCollapsed(!chatCollapsed)} width={rightPanelWidth} selectedSkills={selectedSkills} setSelectedSkills={setSelectedSkills} chatTasks={chatTasks} setChatTasks={setChatTasks} />
    </div>
  );
}

export default ResultPage;