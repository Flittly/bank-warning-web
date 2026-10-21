import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { X, Edit3, X as XIcon, Save } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { resolveExportName, sectionCsvCount, partitionCsvInfoFromReport } from '../utils/downloadName';

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
  // hooks 必须在任何提前 return 之前调用：本组件在 reportTabs 为空时是被父级
  // 整体卸载的，一旦将来改成常驻渲染，先 return 再 useState 会直接抛
  // 「Rendered more hooks than during the previous render」。
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const editRef = useRef<HTMLTextAreaElement>(null);

  const activeTab = tabs[activeTabIndex];

  useEffect(() => {
    setEditing(false);
    setEditContent('');
  }, [activeTabIndex]);

  if (!activeTab) return null;

  // 这份报告是否带分区断面详情 CSV —— 直接读报告附录表格，
  // 于是按钮文案在点之前就能说明「导出的是报告包（docx + N 个分区 CSV）」，
  // 而不是等下载完看到 `..._导出包.zip` 才发现。
  const csvInfo = partitionCsvInfoFromReport(activeTab.content);
  const extraUnassigned = csvInfo.files - csvInfo.partitions;

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
          <>
            {activeTab.filename && (
              <button
                  onClick={async () => {
                    // 第 103 行的 activeTab.filename 守卫只在同步作用域内有效：
                    // TS 不会把类型窄化带进 async 回调（回调可能在 activeTab 变化后才执行），
                    // 所以在回调开头重新取一次局部常量，让类型收窄与运行时守卫落在同一处。
                    const filename = activeTab.filename;
                    if (!filename) return;
                    try {
                      const res = await fetch(`/v0/bank/ai/reports/${encodeURIComponent(filename)}/export`)
                      if (!res.ok) throw new Error(`HTTP ${res.status}`)
                      const blob = await res.blob()
                      const url = URL.createObjectURL(blob)
                      const a = document.createElement('a')
                      a.href = url
                      // 有 CSV 时导出的是 zip（报告.docx + 各分区断面详情.csv + 风险段汇总.csv），
                      // 一份 CSV 都没有时仍是 docx —— 文件名以服务端 Content-Disposition 为准。
                      a.download = resolveExportName(res.headers.get('Content-Disposition'), filename)
                      a.click()
                      URL.revokeObjectURL(url)
                      const csvCount = sectionCsvCount(res.headers.get('X-Section-Csv-Count'))
                      if (csvCount > 0) {
                        window.dispatchEvent(new CustomEvent('report-exports-saved', {
                          detail: { filename, csvCount },
                        }))
                      }
                    } catch (e) {
                      console.error('导出Word失败:', e)
                    }
                  }}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                  padding: '5px 12px', marginRight: 6,
                  border: '1.5px solid rgba(59,130,246,0.35)',
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.3) 0%, rgba(59,130,246,0.12) 100%)',
                  backdropFilter: 'blur(6px)',
                  WebkitBackdropFilter: 'blur(6px)',
                  cursor: 'pointer', fontSize: '0.75rem', color: '#2563eb',
                  borderRadius: 12,
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.4)',
                  transition: 'all 0.15s',
                }}
                title={csvInfo.files > 0
                  ? `下载报告压缩包：报告.docx + ${csvInfo.files} 个 CSV（分区断面详情 / 风险段汇总）`
                  : '导出Word'}
              >
                {csvInfo.files > 0
                  ? `⬇ 导出报告包（含 ${csvInfo.files} 个 CSV）`
                  : '⬇ 导出Word'}
              </button>
            )}
            <button
              onClick={startEdit}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                padding: '5px 12px', marginRight: 6,
                border: '1.5px solid rgba(0,0,0,0.08)',
                background: 'rgba(255,255,255,0.4)',
                backdropFilter: 'blur(6px)',
                WebkitBackdropFilter: 'blur(6px)',
                cursor: 'pointer', fontSize: '0.75rem', color: '#64748b',
                borderRadius: 12,
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.5)',
                transition: 'all 0.15s',
              }}
            >
              <Edit3 size={14} /> 编辑
            </button>
          </>
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
      {csvInfo.files > 0 && !editing && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 14px', flexShrink: 0,
          background: '#eff6ff', borderBottom: '1px solid #dbeafe',
          fontSize: '0.72rem', color: '#1d4ed8',
        }}>
          <span>
            本报告已按经纬度划分为 <b>{csvInfo.partitions}</b> 个分区
            {extraUnassigned > 0 ? `（另有 ${extraUnassigned} 个未落入分区的断面文件）` : ''}
            ，点右上角「导出报告包」可同时下载报告 Word 与各分区断面详情 CSV。
          </span>
        </div>
      )}
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
