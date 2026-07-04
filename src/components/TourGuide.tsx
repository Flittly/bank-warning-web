import { Tour, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import type { TourProps } from 'antd';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

interface TourGuideProps {
  open: boolean;
  onClose: () => void;
}

function getEl(selector: string): HTMLElement | null {
  return document.querySelector(selector) as HTMLElement | null;
}

const STEP_PAGE: Record<number, string> = {
  0: '/editor', 1: '/editor', 2: '/editor', 3: '/editor', 4: '/editor', 5: '/editor', 6: '/editor',
  7: '/result', 8: '/result', 9: '/result', 10: '/result',
  11: '/knowledge', 12: '/knowledge',
};

export default function TourGuide({ open, onClose }: TourGuideProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [current, setCurrent] = useState(0);
  const [tourKey, setTourKey] = useState(0);
  const navTimerRef = useRef<number>(0);

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

  const steps: TourProps['steps'] = useMemo(() => [
    {
      title: '上传岸段',
      description: '点击此处上传岸段 Shapefile 或 GeoJSON 数据，支持 .geojson 格式',
      target: () => getEl('[data-tour="upload-bank"]'),
      placement: 'right',
    },
    {
      title: '选择岸段',
      description: '上传后岸段出现在本地列表中，点击可选中多选，用于后续生成断面',
      target: () => getEl('[data-tour="bank-list"]'),
      placement: 'right',
    },
    {
      title: '选中岸段',
      description: '在"方式二：手动创建断面"区域，点击"选中岸段"或"全选"按钮选择需要在底图上操作的岸段',
      target: () => getEl('[data-tour="select-bank-lines"]'),
      placement: 'right',
    },
    {
      title: '生成断面',
      description: '选择岸段后，设置间距和长度参数，点击"生成展示断面"或"生成计算断面"',
      target: () => getEl('[data-tour="generate-sections"]'),
      placement: 'right',
    },
    {
      title: '参数配置',
      description: '在此选择参数模板并配置全局属性，包括水位、潮位、保护等级等水文计算参数',
      target: () => getEl('[data-tour="param-config"]'),
      placement: 'right',
    },
    {
      title: '断面精细调整',
      description: '生成断面后，点击"开启断面精调"进入编辑模式，可手动拖拽、旋转、缩放断面',
      target: () => getEl('[data-tour="fine-tune"]'),
      placement: 'right',
    },
    {
      title: 'AI 智能助手',
      description: '右侧 AI 助手可随时回答崩岸预警相关问题，支持知识库检索和报告生成',
      target: () => getEl('[data-tour="chat-panel"]'),
      placement: 'left',
    },
    {
      title: '任务列表',
      description: '查看已创建的所有预警任务，点击任务加载计算结果，下方图例展示风险等级着色含义',
      target: () => getEl('[data-tour="result-tasks"]'),
      placement: 'right',
    },
    {
      title: '报告查看',
      description: '系统自动生成岸坡稳定性分析报告，可选择任务生成并查看，支持导出',
      target: () => getEl('[data-tour="result-reports"]'),
      placement: 'right',
    },
    {
      title: 'Skills 工具箱',
      description: '内置水文分析、地质评估等 AI 技能工具，可上传自定义 Skill 扩展功能',
      target: () => getEl('[data-tour="result-skills"]'),
      placement: 'right',
    },
    {
      title: '计算进度',
      description: '查看当前任务计算的实时进度，了解各断面处理状态和异常详情',
      target: () => getEl('[data-tour="result-progress"]'),
      placement: 'right',
    },
    {
      title: '知识文档',
      description: '上传和管理崩岸预警相关的研究文献、技术报告、案例资料',
      target: () => getEl('[data-tour="knowledge-sidebar"]'),
      placement: 'right',
    },
    {
      title: '文档预览',
      description: '点击左侧文档可在右侧预览全文，支持 AI 问答检索文档内容',
      target: () => getEl('[data-tour="knowledge-preview"]'),
      placement: 'left',
    },
  ], []);

  const handleChange = useCallback((next: number) => {
    setCurrent(next);
    const targetPage = STEP_PAGE[next];
    if (targetPage && !location.pathname.startsWith(targetPage)) {
      navigate(targetPage);
      clearTimeout(navTimerRef.current);
      navTimerRef.current = window.setTimeout(() => {
        setTourKey((k) => k + 1);
      }, 600);
    } else {
      setTourKey((k) => k + 1);
    }
  }, [location.pathname, navigate]);

  const handleClose = useCallback(() => {
    setCurrent(0);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      setTourKey((k) => k + 1);
    }, 300);
    return () => clearTimeout(timer);
  }, [location.pathname]);

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
