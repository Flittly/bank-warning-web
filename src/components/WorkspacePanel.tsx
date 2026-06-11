import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { X } from 'lucide-react';

export interface ReportTab {
  taskId: string;
  taskName: string;
  content: string;
}

interface WorkspacePanelProps {
  tabs: ReportTab[];
  activeTabIndex: number;
  onSelectTab: (index: number) => void;
  onCloseTab: (index: number) => void;
  height: number;
}

function WorkspacePanel({ tabs, activeTabIndex, onSelectTab, onCloseTab, height }: WorkspacePanelProps) {
  if (tabs.length === 0) return null;

  const activeTab = tabs[activeTabIndex];

  return (
    <div style={{
      height, minHeight: height, overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      background: '#ffffff', borderTop: '1px solid #e2e8f0',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center',
        background: '#f1f5f9', borderBottom: '1px solid #e2e8f0',
        overflowX: 'auto', flexShrink: 0,
      }}>
        {tabs.map((tab, i) => (
          <div
            key={`${tab.taskId}-${i}`}
            onClick={() => onSelectTab(i)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 12px', cursor: 'pointer',
              fontSize: '0.8rem', whiteSpace: 'nowrap',
              borderRight: '1px solid #e2e8f0',
              background: i === activeTabIndex ? '#ffffff' : 'transparent',
              color: i === activeTabIndex ? '#1e293b' : '#64748b',
              fontWeight: i === activeTabIndex ? 500 : 400,
              borderBottom: i === activeTabIndex ? '2px solid #2563eb' : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            <span style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {tab.taskName}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onCloseTab(i); }}
              style={{
                border: 'none', background: 'transparent', cursor: 'pointer',
                padding: 0, display: 'flex', color: '#94a3b8',
              }}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      <div style={{
        flex: 1, overflow: 'auto', padding: '20px 24px',
        fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
        lineHeight: 1.8, color: '#1e293b',
      }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {activeTab.content}
        </ReactMarkdown>
      </div>
    </div>
  );
}

export default WorkspacePanel;
