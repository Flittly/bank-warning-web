import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  BookOpen,
  FileText,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  deleteDocument,
  fetchDocumentDetail,
  fetchKnowledgeList,
  fetchKnowledgeStats,
  searchKnowledge,
  uploadKnowledgePdf,
  uploadKnowledgeText,
  type KnowledgeDoc,
  type KnowledgeDocDetail,
  type KnowledgeStats,
  type SearchResult,
} from '../services/knowledgeApi';
import './catalog.css';

/**
 * 知识中心（/knowledge）。
 *
 * <p>与报告中心（/reports）、技能中心（/skills）同一套版式：页头 + 筛选条 +
 * 左列表 / 右预览。此前这里借用了编辑器那套玻璃拟态侧栏（KnowledgeSidebar +
 * 可拖拽分隔条），从首页点进来像是又进了断面编辑器；现在整体换成 `catalog-*`。
 *
 * <p>两种检索并存，互不干扰：
 * - 搜索框输入 = 按文件名 / docId 本地过滤左侧列表（与报告中心一致）；
 * - 「语义检索」或回车 = 走后端向量检索，右侧换成命中片段（带相似度）。
 */
export default function KnowledgePage() {
  const [searchParams] = useSearchParams();

  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [stats, setStats] = useState<KnowledgeStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [query, setQuery] = useState('');

  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('doc'));
  const [detail, setDetail] = useState<KnowledgeDocDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [hits, setHits] = useState<SearchResult[] | null>(null);
  const [hitQuery, setHitQuery] = useState('');
  const [hitting, setHitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // 列表 + 统计（knowledgeApi 不接 AbortSignal，用 cancelled 标记代替）
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchKnowledgeList(), fetchKnowledgeStats()])
      .then(([list, summary]) => {
        if (cancelled) return;
        setDocs(list);
        setStats(summary);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '文档列表加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  /** 分类 chip：按数据里真实出现过的 type 生成，计数跟着数据走，不写死分类表。 */
  const types = useMemo(() => {
    const counter = new Map<string, number>();
    docs.forEach((doc) => {
      const key = doc.type || '未分类';
      counter.set(key, (counter.get(key) || 0) + 1);
    });
    return [...counter.entries()].sort((a, b) => b[1] - a[1]);
  }, [docs]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return docs.filter((doc) => {
      if (typeFilter !== 'all' && (doc.type || '未分类') !== typeFilter) return false;
      if (!keyword) return true;
      return (doc.fileName || '').toLowerCase().includes(keyword) || doc.docId.toLowerCase().includes(keyword);
    });
  }, [docs, typeFilter, query]);

  // 选中项始终落在「当前筛选结果里真实存在的那一条」上：删掉或换了筛选条件后回落到第一条。
  const active = useMemo(
    () => filtered.find((doc) => doc.docId === selectedId) || filtered[0] || null,
    [filtered, selectedId],
  );
  const activeId = active?.docId ?? null;

  useEffect(() => {
    if (!activeId) {
      setDetail(null);
      setDetailError(null);
      setDetailLoading(false);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    fetchDocumentDetail(activeId)
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setDetail(null);
        setDetailError(reason instanceof Error ? reason.message : '文档内容加载失败');
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeId, reloadKey]);

  const runSearch = useCallback(async () => {
    const keyword = query.trim();
    if (!keyword) {
      setHits(null);
      setHitQuery('');
      return;
    }
    setHitting(true);
    setHitQuery(keyword);
    try {
      setHits(await searchKnowledge(keyword));
    } catch (reason: unknown) {
      setHits([]);
      setDetailError(reason instanceof Error ? reason.message : '语义检索失败');
    } finally {
      setHitting(false);
    }
  }, [query]);

  const clearSearch = () => {
    setHits(null);
    setHitQuery('');
    setQuery('');
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    const type = window.prompt('请输入文档分类（如 hydraulic / engineering）：', '文档') || '文档';
    setUploading(true);
    try {
      if (file.name.endsWith('.pdf') || file.name.endsWith('.docx')) {
        await uploadKnowledgePdf(file, type);
      } else {
        await uploadKnowledgeText(type, file.name, await file.text());
      }
      setReloadKey((key) => key + 1);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '上传失败');
    } finally {
      setUploading(false);
      input.value = '';
    }
  };

  const handleDelete = async () => {
    if (!active) return;
    if (!window.confirm(`确定要删除「${active.fileName || active.docId}」吗？`)) return;
    setDeleting(true);
    try {
      await deleteDocument(active.docId);
      setSelectedId(null);
      setHits(null);
      setReloadKey((key) => key + 1);
    } catch (reason: unknown) {
      setDetailError(reason instanceof Error ? reason.message : '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  const summary = stats
    ? `共 ${stats.documents} 个文档 · ${stats.chunks} 个分块 · ${stats.dimensions} 维 · ${stats.store}`
    : `共 ${docs.length} 个文档`;

  return (
    <div className="catalog-page">
      <div className="catalog-shell">
        <header className="catalog-head">
          <div>
            <h1>知识中心</h1>
            <p>{summary}</p>
          </div>
          <div className="catalog-head-actions">
            <label
              className="ds-button ds-button--primary"
              style={{ cursor: uploading ? 'progress' : 'pointer' }}
            >
              <Upload size={14} /> {uploading ? '上传中…' : '上传文档'}
              <input
                type="file"
                accept=".pdf,.docx,.txt,.md"
                onChange={handleUpload}
                disabled={uploading}
                style={{ display: 'none' }}
              />
            </label>
            <button
              type="button"
              className="ds-button ds-button--secondary"
              onClick={() => setReloadKey((key) => key + 1)}
              disabled={loading}
            >
              <RefreshCw size={14} /> 刷新
            </button>
          </div>
        </header>

        <div className="catalog-filters">
          <button
            type="button"
            className={`catalog-chip${typeFilter === 'all' ? ' is-active' : ''}`}
            onClick={() => setTypeFilter('all')}
          >
            全部<i>{docs.length}</i>
          </button>
          {types.map(([type, count]) => (
            <button
              key={type}
              type="button"
              className={`catalog-chip${typeFilter === type ? ' is-active' : ''}`}
              onClick={() => setTypeFilter(type)}
            >
              {type}
              <i>{count}</i>
            </button>
          ))}

          <div className="catalog-search-group">
            <label className="catalog-search">
              <span className="catalog-search-icon" aria-hidden="true"><Search size={13} /></span>
              <input
                className="ds-input"
                type="search"
                value={query}
                placeholder="按名称过滤，回车做语义检索"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void runSearch();
                }}
                aria-label="搜索知识文档"
              />
            </label>
            <button
              type="button"
              className="ds-button ds-button--secondary"
              onClick={() => void runSearch()}
              disabled={hitting || !query.trim()}
            >
              {hitting ? <Loader2 size={13} /> : <Search size={13} />} 语义检索
            </button>
            {hits !== null && (
              <button type="button" className="ds-button ds-button--ghost" onClick={clearSearch}>
                退出检索
              </button>
            )}
          </div>
        </div>

        <div className="catalog-split">
          <section className="catalog-panel" aria-label="知识文档" data-tour="knowledge-sidebar">
            <header className="catalog-panel-head">
              <h2>知识文档</h2>
              <span>{filtered.length} 篇</span>
            </header>
            <div className="catalog-list">
              {loading && [0, 1, 2, 3].map((row) => (
                <div key={row} className="catalog-row" aria-hidden="true">
                  <span className="ds-skeleton catalog-skeleton-row" style={{ width: '100%' }} />
                </div>
              ))}

              {!loading && error && (
                <div className="catalog-empty" role="alert">
                  <BookOpen size={24} />
                  <span>{error}</span>
                  <button
                    type="button"
                    className="ds-button ds-button--secondary"
                    onClick={() => setReloadKey((key) => key + 1)}
                  >
                    <RefreshCw size={14} /> 重试
                  </button>
                </div>
              )}

              {!loading && !error && filtered.length === 0 && (
                <div className="catalog-empty">
                  <BookOpen size={24} />
                  <span>{docs.length === 0 ? '暂无文档，点右上角「上传文档」' : '没有匹配的文档'}</span>
                </div>
              )}

              {!loading && !error && filtered.map((doc) => (
                <button
                  key={doc.docId}
                  type="button"
                  className={`catalog-row${active?.docId === doc.docId ? ' is-active' : ''}`}
                  onClick={() => {
                    setSelectedId(doc.docId);
                    setHits(null);
                  }}
                  title={doc.fileName || doc.docId}
                >
                  <span className="catalog-tag catalog-tag--doc">{doc.type || '未分类'}</span>
                  <span className="catalog-row-main">
                    <span className="catalog-row-title">{doc.fileName || doc.docId}</span>
                    <span className="catalog-row-meta">{doc.chunks} 分块 · {doc.docId}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section
            className="catalog-panel catalog-preview"
            aria-label="文档预览"
            data-tour="knowledge-preview"
          >
            <header className="catalog-preview-bar">
              <span className="catalog-preview-title">
                {hits !== null
                  ? `语义检索 · “${hitQuery}”`
                  : active
                    ? (active.fileName || active.docId)
                    : '未选择文档'}
              </span>
              <span className="catalog-preview-actions">
                {hits === null && active && (
                  <button
                    type="button"
                    className="ds-button ds-button--ghost"
                    onClick={handleDelete}
                    disabled={deleting}
                    title="删除这篇文档"
                  >
                    <Trash2 size={14} /> {deleting ? '删除中…' : '删除'}
                  </button>
                )}
              </span>
            </header>

            <div className="catalog-markdown">
              {hits !== null && (
                <div className="knowledge-hits">
                  {hitting && (
                    <div className="catalog-empty"><span>检索中…</span></div>
                  )}
                  {!hitting && hits.length === 0 && (
                    <div className="catalog-empty">
                      <Search size={24} />
                      <span>没有检索到相关内容</span>
                    </div>
                  )}
                  {!hitting && hits.map((hit, index) => (
                    <article className="knowledge-hit" key={`${hit.docId}-${index}`}>
                      <header className="knowledge-hit-head">
                        <span className="knowledge-hit-doc">
                          <FileText size={13} /> {hit.docId}
                        </span>
                        <span className="knowledge-hit-score">相似度 {hit.score.toFixed(3)}</span>
                      </header>
                      <p className="knowledge-hit-body">
                        {hit.content.length > 320 ? `${hit.content.slice(0, 320)}…` : hit.content}
                      </p>
                    </article>
                  ))}
                </div>
              )}

              {hits === null && !active && (
                <div className="catalog-empty">
                  <BookOpen size={26} />
                  <span>左侧选择一篇文档查看全文，或直接用语义检索</span>
                </div>
              )}

              {hits === null && active && detailLoading && (
                <div className="catalog-empty"><span>加载中…</span></div>
              )}

              {hits === null && active && !detailLoading && detailError && (
                <div className="catalog-empty" role="alert">
                  <FileText size={24} />
                  <span>{detailError}</span>
                </div>
              )}

              {hits === null && active && !detailLoading && !detailError && detail && (
                <>
                  <p className="knowledge-doc-meta">
                    <span>分类 {detail.type || '—'}</span>
                    <span>{detail.chunks} 分块</span>
                    <span>{detail.docId}</span>
                  </p>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{detail.content}</ReactMarkdown>
                </>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
