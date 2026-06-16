import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FileText, Search, Loader2 } from 'lucide-react';
import type { KnowledgeDocDetail, SearchResult } from '../services/knowledgeApi';
import { fetchDocumentDetail } from '../services/knowledgeApi';

interface Props {
  selectedDocId: string | null;
  searchResults: SearchResult[] | null;
  searchQuery: string;
  style?: React.CSSProperties;
}

export default function KnowledgePreview({ selectedDocId, searchResults, searchQuery, style }: Props) {
  const [doc, setDoc] = useState<KnowledgeDocDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedDocId) { setDoc(null); return; }
    let cancelled = false;
    setLoading(true);
    fetchDocumentDetail(selectedDocId)
      .then(d => { if (!cancelled) { setDoc(d); setError(null); } })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedDocId]);

  return (
    <div style={{ flex: 1, height: '100%', overflowY: 'auto', padding: 24, background: '#f8fafc', ...style }}>
      {/* Search Results */}
      {searchResults !== null && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <Search size={18} color="#6366f1" />
            <span style={{ fontSize: 15, fontWeight: 600, color: '#1e293b' }}>
              搜索结果: &quot;{searchQuery}&quot; ({searchResults.length} 条)
            </span>
          </div>
          {searchResults.length === 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>
              <Search size={40} style={{ marginBottom: 12 }} />
              <div>未找到匹配的知识内容</div>
            </div>
          )}
          {searchResults.map((r, i) => (
            <div key={i} style={{
              padding: '14px 16px', background: '#fff', borderRadius: 8,
              border: '1px solid #e2e8f0', marginBottom: 10,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#6366f1' }}>
                  <FileText size={13} style={{ marginRight: 4, verticalAlign: -2 }} />
                  {r.docId}
                </span>
                <span style={{
                  fontSize: 11, padding: '1px 8px', borderRadius: 10,
                  background: '#eef2ff', color: '#4f46e5',
                }}>
                  相似度 {r.score.toFixed(3)}
                </span>
              </div>
              <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.6 }}>
                {r.content.length > 300 ? r.content.slice(0, 300) + '...' : r.content}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Document Preview */}
      {searchResults === null && selectedDocId && (
        <div>
          {loading && (
            <div style={{ textAlign: 'center', padding: 60 }}>
              <Loader2 size={32} color="#3b82f6" style={{ animation: 'spin 1s linear infinite' }} />
              <div style={{ marginTop: 12, color: '#64748b', fontSize: 14 }}>加载中...</div>
            </div>
          )}

          {error && (
            <div className="error-message">{error}</div>
          )}

          {doc && !loading && (
            <>
              <div style={{ marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid #e2e8f0' }}>
                <h2 style={{ margin: '0 0 8px', fontSize: 20, color: '#0f172a' }}>
                  <FileText size={20} style={{ marginRight: 8, verticalAlign: -4, color: '#3b82f6' }} />
                  {doc.fileName || doc.docId}
                </h2>
                <div style={{ display: 'flex', gap: 16, fontSize: 13, color: '#64748b' }}>
                  <span>分类: {doc.type || '-'}</span>
                  <span>分块数: {doc.chunks}</span>
                  <span>ID: {doc.docId}</span>
                </div>
              </div>
              <div style={{
                background: '#fff', borderRadius: 8, border: '1px solid #e2e8f0',
                padding: '20px 24px', lineHeight: 1.8, fontSize: 14, color: '#334155',
              }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {doc.content}
                </ReactMarkdown>
              </div>
            </>
          )}
        </div>
      )}

      {/* Empty state */}
      {searchResults === null && !selectedDocId && (
        <div style={{
          textAlign: 'center', padding: 80, color: '#94a3b8',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
        }}>
          <FileText size={56} style={{ marginBottom: 16 }} />
          <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 6 }}>知识库预览</div>
          <div style={{ fontSize: 13 }}>点击左侧文档查看内容，或使用搜索框搜索</div>
        </div>
      )}
    </div>
  );
}
