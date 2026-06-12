import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { X, Edit3, Check, X as XIcon, Save } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

export interface ReportTab {
  taskId: string;
  taskName: string;
  content: string;
  filename?: string;
}

interface WorkspacePanelProps {
  tabs: ReportTab[];
  activeTabIndex: number;
  onSelectTab: (index: number) => void;
  onCloseTab: (index: number) => void;
  onUpdateTab: (index: number, content: string) => Promise<void>;
  height: number;
}

function WorkspacePanel({ tabs, activeTabIndex, onSelectTab, onCloseTab, onUpdateTab, height }: WorkspacePanelProps) {
  if (tabs.length === 0) return null;

  const activeTab = tabs[activeTabIndex];
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const editRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setEditing(false);
    setEditContent('');
  }, [activeTabIndex]);

  const startEdit = () => {
    setEditContent(activeTab.content);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setEditContent('');
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      await onUpdateTab(activeTabIndex, editContent);
      setEditing(false);
      setEditContent('');
    } catch (e) {
      alert('保存失败: ' + (e instanceof Error ? e.message : '未知错误'));
    } finally {
      setSaving(false);
    }
  };

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
        <div style={{ flex: 1 }} />
        {!editing ? (
          <button
            onClick={startEdit}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '4px 10px', marginRight: 4,
              border: 'none', background: 'transparent',
              cursor: 'pointer', fontSize: '0.75rem', color: '#64748b',
            }}
          >
            <Edit3 size={14} /> 编辑
          </button>
        ) : (
          <>
            <button
              onClick={saveEdit} disabled={saving}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', marginRight: 4,
                border: 'none', background: saving ? '#94a3b8' : '#2563eb',
                cursor: saving ? 'not-allowed' : 'pointer',
                fontSize: '0.75rem', color: '#ffffff', borderRadius: 4,
              }}
            >
              <Save size={14} /> {saving ? '保存中' : '保存'}
            </button>
            <button
              onClick={cancelEdit} disabled={saving}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', marginRight: 4,
                border: '1px solid #e2e8f0', background: '#ffffff',
                cursor: saving ? 'not-allowed' : 'pointer',
                fontSize: '0.75rem', color: '#64748b', borderRadius: 4,
              }}
            >
              <XIcon size={14} /> 取消
            </button>
          </>
        )}
      </div>
      {editing ? (
        <textarea
          ref={editRef}
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          style={{
            flex: 1, padding: '16px 20px',
            border: 'none', outline: 'none', resize: 'none',
            fontFamily: 'monospace', fontSize: '0.85rem',
            lineHeight: 1.6, color: '#1e293b',
            background: '#fefefe',
          }}
        />
      ) : (
        <div style={{
          flex: 1, overflow: 'auto', padding: '20px 24px',
          fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
          lineHeight: 1.8, color: '#1e293b',
        }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {activeTab.content}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}

export default WorkspacePanel;
