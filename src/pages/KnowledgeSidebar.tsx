import { useState, useEffect, useCallback } from 'react';
import { Upload, Search, FileText, Trash2, BookOpen } from 'lucide-react';
import type { KnowledgeDoc, KnowledgeStats } from '../services/knowledgeApi';
import {
  fetchKnowledgeList,
  deleteDocument,
  uploadKnowledgePdf,
  uploadKnowledgeText,
  fetchKnowledgeStats,
} from '../services/knowledgeApi';

interface Props {
  onSelectDoc: (id: string) => void;
  onSearch: (query: string) => void;
  style?: React.CSSProperties;
}

export default function KnowledgeSidebar({ onSelectDoc, onSearch, style }: Props) {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [stats, setStats] = useState<KnowledgeStats | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    try {
      setLoading(true);
      const [list, s] = await Promise.all([fetchKnowledgeList(), fetchKnowledgeStats()]);
      setDocs(list);
      setStats(s);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const type = prompt('请输入文档分类（如 hydraulic / engineering）：', '文档') || '文档';
    try {
      if (file.name.endsWith('.pdf')) {
        await uploadKnowledgePdf(file, type);
      } else {
        const text = await file.text();
        await uploadKnowledgeText(type, file.name, text);
      }
      await loadList();
    } catch (e: any) {
      setError(e.message);
    }
    e.target.value = '';
  }, [loadList]);

  const handleDelete = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`确定要删除「${id}」吗？`)) return;
    try {
      await deleteDocument(id);
      await loadList();
    } catch (e: any) {
      setError(e.message);
    }
  }, [loadList]);

  const handleSearch = useCallback(() => {
    onSearch(searchQuery.trim());
  }, [searchQuery, onSearch]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  }, [handleSearch]);

  const handleClearSearch = useCallback(() => {
    setSearchQuery('');
    onSearch('');
  }, [onSearch]);

  const typeColors: Record<string, string> = {
    hydraulic: '#3b82f6',
    engineering: '#f59e0b',
    geological: '#10b981',
    weather: '#06b6d4',
  };

  return (
    <div style={{
      overflowY: 'auto', padding: '16px', width: '100%', height: '100%',
      background: '#ffffff', borderRight: '1px solid #e2e8f0',
      ...style,
    }}>
      {/* Upload */}
      <label style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
        background: '#3b82f6', color: '#fff', borderRadius: 8, cursor: 'pointer',
        fontWeight: 600, fontSize: 14, justifyContent: 'center', marginBottom: 12,
      }}>
        <Upload size={16} />
        上传文档 (PDF / TXT)
        <input type="file" accept=".pdf,.txt,.md" onChange={handleUpload} style={{ display: 'none' }} />
      </label>

      {/* Search */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <input
          type="text"
          placeholder="语义搜索知识库..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          style={{
            flex: 1, padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 6,
            fontSize: 13, outline: 'none',
          }}
        />
        <button onClick={handleSearch}
          style={{
            padding: '8px 12px', background: '#6366f1', color: '#fff', border: 'none',
            borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center',
          }}>
          <Search size={14} />
        </button>
        {searchQuery && (
          <button onClick={handleClearSearch}
            style={{
              padding: '8px 12px', background: '#f1f5f9', color: '#64748b', border: 'none',
              borderRadius: 6, cursor: 'pointer', fontSize: 12,
            }}>
            清除
          </button>
        )}
      </div>

      {/* Document List */}
      <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <BookOpen size={14} color="#64748b" />
          <span style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>知识文档</span>
          <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 'auto' }}>{docs.length} 个</span>
        </div>

        {loading && <div className="loading-spinner">加载中...</div>}
        {error && <div className="error-message">{error}</div>}

        {!loading && docs.length === 0 && (
          <div className="empty-hint">
            <FileText size={32} color="#cbd5e1" style={{ marginBottom: 8 }} />
            <div>暂无文档，点击上方按钮上传</div>
          </div>
        )}

        {docs.map(doc => (
          <div
            key={doc.docId}
            onClick={() => onSelectDoc(doc.docId)}
            style={{
              padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
              border: '1px solid #e2e8f0', marginBottom: 8, transition: 'all 0.15s',
              background: '#fff',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
            onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', minWidth: 0 }}>
                <FileText size={18} color="#64748b" style={{ marginTop: 2, flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {doc.fileName || doc.docId}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    <span style={{
                      fontSize: 11, padding: '1px 6px', borderRadius: 4,
                      background: (typeColors[doc.type] || '#94a3b8') + '18',
                      color: typeColors[doc.type] || '#64748b',
                    }}>
                      {doc.type}
                    </span>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>
                      {doc.chunks} 分块
                    </span>
                  </div>
                </div>
              </div>
              <button onClick={(e) => handleDelete(doc.docId, e)}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: '#94a3b8', padding: 4, borderRadius: 4, flexShrink: 0,
                }}
                onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                onMouseLeave={e => (e.currentTarget.style.color = '#94a3b8')}
                title="删除"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Stats Footer */}
      {stats && (
        <div style={{
          marginTop: 16, paddingTop: 12, borderTop: '1px solid #e2e8f0',
          fontSize: 11, color: '#94a3b8', textAlign: 'center',
        }}>
          共 {stats.documents} 个文档 · {stats.chunks} 个分块 · {stats.store}
        </div>
      )}
    </div>
  );
}
