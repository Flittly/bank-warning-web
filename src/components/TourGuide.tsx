import { Tour, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import type { TourProps } from 'antd';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useEditorStore } from '../store/useEditorStore';

interface TourGuideProps {
  open: boolean;
  onClose: () => void;
}

type SidebarMode = 'tree' | 'classic';

/**
 * 每一步自带它所在的路由：引导先切页面、再定位元素。
 * 原先是一张 STEP_PAGE 下标表，步骤一增删就会整体错位 —— 现在把路由跟步骤绑死。
 */
type TourStep = NonNullable<TourProps['steps']>[number] & { route: string };

const ROUTE = {
  editor: '/editor',
  /** 结果页的四个面板由活动栏 + ?panel= 驱动，不是四个独立路由 */
  result: (panel: 'tasks' | 'reports' | 'skills' | 'progress') => `/result?panel=${panel}`,
  knowledge: '/knowledge',
};

/**
 * antd Tour 的 target 类型只接受 `() => HTMLElement`（不含 `| null`），
 * 但运行时返回 null 是被支持的 —— 找不到元素时 Tour 会退化成居中、无高亮。
 * 这里统一断言成 HTMLElement，省掉十几处重复的 as。
 * （注意：这意味着「锚点写错」不会报错也不会警告，只会静默地没有高亮框，
 *   所以每个选择器都必须有对应的真机校验，不能靠肉眼。）
 */
function getEl(selector: string): HTMLElement {
  return document.querySelector(selector) as HTMLElement;
}

const here = () => `${window.location.pathname}${window.location.search}`;

// ============================================================
//  两种面板风格共用的步骤
// ============================================================

/** 左侧活动栏：这次更新新增的全局入口，两种风格下都在 */
const ACTIVITY_BAR_STEP: TourStep = {
  title: '左侧功能栏',
  description:
    '平台所有页面都收在这一条竖栏里：断面编辑器、任务列表、报告查看、Skills、计算进度、知识库。点图标直接切换，当前所在页面会高亮。',
  target: () => getEl('[data-tour="activity-bar"]'),
  placement: 'right',
  route: ROUTE.editor,
};

/** 地图底部操作条：两种风格共用（经典面板没有「新建任务」，只能从这里点） */
const MAP_TOOLBAR_STEP: TourStep = {
  title: '地图底部操作条',
  description:
    '上传岸段、上传断面、中间圆形按钮是「新建任务」、在地图上点选岸段、清除断面。两种面板风格下都有这一条，与左侧面板功能互通。',
  target: () => getEl('[data-tour="map-toolbar"]'),
  placement: 'top',
  route: ROUTE.editor,
};

const CHAT_STEP: TourStep = {
  title: 'AI 智能助手',
  description: '右侧 AI 助手可随时回答崩岸预警相关问题，支持知识库检索和报告生成。',
  target: () => getEl('[data-tour="chat-panel"]'),
  placement: 'left',
  route: ROUTE.editor,
};

/** 告诉用户「还有另一种左侧面板风格」——解决两种风格只有一种有引导的发现性问题 */
const PANEL_SWITCH_STEP: TourStep = {
  title: '两套左侧面板风格，随时切换',
  description:
    '右上角菜单 →「设置」→「界面」→「编辑器左侧面板」，可在「资源树」与「经典面板」之间切换。两者数据完全互通，切换后新手引导也会跟着换成对应风格的步骤。',
  target: () => getEl('[data-tour="nav-menu"]'),
  placement: 'bottomRight',
  route: ROUTE.editor,
};

// ============================================================
//  编辑器页 —— 资源树风格
// ============================================================
const TREE_EDITOR_STEPS: TourStep[] = [
  ACTIVITY_BAR_STEP,
  {
    title: '左侧面板：资源树',
    description:
      '当前用的是「资源树」风格：左侧把平台的岸段、断面、参数模板、DEM 与计算任务按数据资源树组织，适合「我已经知道东西在哪，直接去点」的用法。',
    target: () => getEl('[data-tour="tree-header"]'),
    placement: 'right',
    route: ROUTE.editor,
  },
  {
    title: '资源树怎么用',
    description:
      '「数据资源」下分四类：岸段、断面、参数模板、DEM 资源；「计算任务」是另一组。单击展开/收起并选中，双击把该资源直接加载到地图，右键弹出完整操作菜单（加载到地图、定位缩放、平滑岸段、截取岸段、查看属性、删除等），鼠标悬停时行尾还会浮出常用操作图标。',
    target: () => getEl('[data-tour="tree-root"]'),
    placement: 'right',
    route: ROUTE.editor,
  },
  {
    title: '当前任务与执行风险分析',
    description:
      '树底部常驻「执行风险分析」按钮，右侧显示当前选中的任务名；没有选任务时会提示「未选择任务」。',
    target: () => getEl('[data-tour="tree-footer"]'),
    placement: 'right',
    route: ROUTE.editor,
  },
  MAP_TOOLBAR_STEP,
  CHAT_STEP,
  PANEL_SWITCH_STEP,
];

// ============================================================
//  编辑器页 —— 经典面板风格
// ============================================================
const CLASSIC_EDITOR_STEPS: TourStep[] = [
  ACTIVITY_BAR_STEP,
  {
    title: '左侧面板：经典面板',
    description:
      '当前用的是「经典面板」风格：左侧按操作顺序分区 —— 创建岸段 → 生成断面 → 参数配置 → 截取岸段 → 断面精细调整 → 视图与工具，适合照着流程一步步做。',
    target: () => getEl('[data-tour="classic-root"]'),
    placement: 'right',
    route: ROUTE.editor,
  },
  {
    title: '创建岸段：上传岸段',
    description: '点此上传岸段数据（.geojson / .json）。右上角的「?」是数据格式说明。',
    target: () => getEl('[data-tour="upload-bank"]'),
    placement: 'right',
    route: ROUTE.editor,
  },
  {
    title: '本地岸段列表',
    description:
      '已上传的岸段出现在「本地岸段」里：单击选中（按住 Shift 可连选），行尾的齿轮按钮可查看该岸段的参数配置。',
    target: () => getEl('[data-tour="bank-list"]'),
    placement: 'right',
    route: ROUTE.editor,
  },
  {
    title: '生成断面：选中岸段',
    description:
      '在「生成断面 · 方式二：手动创建断面」里点「选中岸段」，或直接用「全选」，把需要生成断面的岸段选上。',
    target: () => getEl('[data-tour="select-bank-lines"]'),
    placement: 'right',
    route: ROUTE.editor,
  },
  {
    title: '生成断面',
    description:
      '先设好断面间距（m）与断面长度（m），再点「生成展示断面」（仅查看）或「生成计算断面」（进计算流程）。生成后同一区域还会出现断面检查、一键删除、导出断面样例、修正选择等操作。',
    target: () => getEl('[data-tour="generate-sections"]'),
    placement: 'right',
    route: ROUTE.editor,
  },
  {
    title: '参数配置',
    description:
      '选择参数模板并配置全局属性：水文条件、护岸等级、工程扰动控制等级等，即计算所使用的那套参数。',
    target: () => getEl('[data-tour="param-config"]'),
    placement: 'right',
    route: ROUTE.editor,
  },
  {
    title: '断面精细调整',
    description:
      '点「进入精调」进入断面编辑模式：可「沿线约束」沿岸段线平移保持垂直，或「自由拖动」移动/旋转/缩放；也能用「按垂线生成」「自由创建」补新断面。',
    target: () => getEl('[data-tour="fine-tune"]'),
    placement: 'right',
    route: ROUTE.editor,
  },
  MAP_TOOLBAR_STEP,
  CHAT_STEP,
  PANEL_SWITCH_STEP,
];

// ============================================================
//  结果页 / 知识库 —— 两种风格共用
// ============================================================
const TAIL_STEPS: TourStep[] = [
  {
    title: '任务列表',
    description:
      '所有预警任务都在这里。点任务加载它的计算结果与风险着色；每个任务还能「AI 出报告」或「导出断面详情」。',
    target: () => getEl('[data-tour="result-tasks"]'),
    placement: 'right',
    route: ROUTE.result('tasks'),
  },
  {
    title: '结果地图',
    description:
      '中间是结果地图，按风险等级着色；左侧「当前分析结果」里的图例说明每种颜色的含义。',
    target: () => getEl('[data-tour="result-workspace"]'),
    placement: 'right',
    route: ROUTE.result('tasks'),
  },
  {
    title: '报告查看',
    description: 'AI 生成的岸坡稳定性分析报告列表，点开即可预览，也可以拖到右侧面板并排对照。',
    target: () => getEl('[data-tour="result-reports"]'),
    placement: 'right',
    route: ROUTE.result('reports'),
  },
  {
    title: 'Skills 工具箱',
    description: '内置水文分析、地质评估等 AI 技能工具，也可上传自定义 Skill 扩展功能。',
    target: () => getEl('[data-tour="result-skills"]'),
    placement: 'right',
    route: ROUTE.result('skills'),
  },
  {
    title: '计算进度',
    description:
      '选中任务后可查看实时进度：已处理 / 总数、成功 / 失败，以及每条断面的报错详情。',
    target: () => getEl('[data-tour="result-progress"]'),
    placement: 'right',
    route: ROUTE.result('progress'),
  },
  {
    title: '知识文档',
    description: '上传和管理崩岸预警相关的研究文献、技术报告、案例资料。',
    target: () => getEl('[data-tour="knowledge-sidebar"]'),
    placement: 'right',
    route: ROUTE.knowledge,
  },
  {
    title: '文档预览',
    description: '点击左侧文档可在右侧预览全文，并可就文档内容向 AI 提问检索。',
    target: () => getEl('[data-tour="knowledge-preview"]'),
    placement: 'left',
    route: ROUTE.knowledge,
  },
];

export default function TourGuide({ open, onClose }: TourGuideProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [current, setCurrent] = useState(0);
  const [tourKey, setTourKey] = useState(0);
  const navTimerRef = useRef<number>(0);

  // 引导只在「打开的那一刻」按当时的左侧面板风格取一套步骤：
  // 中途若在设置里改了风格，不让步骤集跟着变，避免 index 与步骤对不上。
  const [tourMode, setTourMode] = useState<SidebarMode>('classic');

  const editorSteps = tourMode === 'tree' ? TREE_EDITOR_STEPS : CLASSIC_EDITOR_STEPS;
  const steps = useMemo<TourStep[]>(() => [...editorSteps, ...TAIL_STEPS], [editorSteps]);

  const tourTheme = useMemo(() => ({
    token: {
      borderRadiusLG: 16,
      borderRadius: 12,
      colorPrimary: '#1e293b',
      colorBgElevated: 'rgba(255,255,255,0.88)',
      colorText: '#1e293b',
      colorTextSecondary: '#475569',
      fontSize: 14,
      fontSizeLG: 18,
      lineHeight: 1.6,
      controlHeight: 38,
      padding: 24,
      paddingContentHorizontal: 24,
      boxShadowSecondary:
        '0 0 0 1px rgba(255,255,255,0.4), 0 8px 32px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.5)',
    },
  }), []);

  /** 打开引导：取当前面板风格的一套步骤，并把页面切到第一步所在路由 */
  useEffect(() => {
    if (!open) return;
    const mode = useEditorStore.getState().sidebarMode;
    setTourMode(mode);
    setCurrent(0);

    const first = (mode === 'tree' ? TREE_EDITOR_STEPS : CLASSIC_EDITOR_STEPS)[0];
    if (first?.route && here() !== first.route) navigate(first.route);

    const timer = window.setTimeout(() => setTourKey((k) => k + 1), 400);
    return () => clearTimeout(timer);
    // 只在「打开」这一刻执行一次；后续位置变化由下面那个 effect 负责重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /** 位置变化后重建 Tour：antd Tour 需要重新取 target 元素 */
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => setTourKey((k) => k + 1), 300);
    return () => clearTimeout(timer);
  }, [open, location.pathname, location.search]);

  const handleChange = useCallback((next: number) => {
    setCurrent(next);
    const route = steps[next]?.route;
    if (route && route !== here()) {
      navigate(route);
      clearTimeout(navTimerRef.current);
      navTimerRef.current = window.setTimeout(() => {
        setTourKey((k) => k + 1);
      }, 600);
    } else {
      setTourKey((k) => k + 1);
    }
  }, [steps, navigate]);

  const handleClose = useCallback(() => {
    setCurrent(0);
    onClose();
  }, [onClose]);

  useEffect(() => {
    return () => clearTimeout(navTimerRef.current);
  }, []);

  if (!open) return null;

  return (
    <div className="tour-guide-root">
      <ConfigProvider theme={tourTheme} locale={zhCN}>
        <Tour
          key={tourKey}
          open={open}
          onClose={handleClose}
          steps={steps}
          current={current}
          onChange={handleChange}
          indicatorsRender={(c, total) => (
            <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
              {c + 1} / {total}
            </span>
          )}
          mask={{ color: 'rgba(0,0,0,0.25)' }}
        />
      </ConfigProvider>
    </div>
  );
}
