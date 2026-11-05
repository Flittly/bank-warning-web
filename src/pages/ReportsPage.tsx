import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FileText, Image as ImageIcon, RefreshCw, Search, Trash2 } from 'lucide-react';
import {
  deleteReport,
  fetchReportCatalog,
  fetchReportContent,
  type ReportEntry,
} from '../services/reportCatalogService';
import './catalog.css';

type KindFilter = 'all' | 'report' | 'viz';

const KIND_LABEL: Record<ReportEntry['kind'], string> = { report: '报告', viz: '出图' };

/**
 * 报告中心（/reports）。
 *
 * <p>独立页面：只读自己的报告列表，点一条就在右侧预览，
 * 不加载地图、不切任务、不经过编辑器 —— 与 /editor、/skills、/knowledge 互不影响。
 */
export default function ReportsPage() {
  const [reports, setReports] = useState<ReportEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');

  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchReportCatalog(controller.signal)
      .then(setReports)
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setError(reason instanceof Error ? reason.message : '报告列表加载失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reloadKey]);

  const counts = useMemo(() => ({
    all: reports.length,
    report: reports.filter((item) => item.kind === 'report').length,
    viz: reports.filter((item) => item.kind === 'viz').length,
  }), [reports]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return reports.filter((item) => {
      if (kind !== 'all' && item.kind !== kind) return false;
      if (!keyword) return true;
      return item.filename.toLowerCase().includes(keyword) || item.taskId.toLowerCase().includes(keyword);
    });
  }, [reports, kind, query]);

  // 选中项始终以「当前筛选结果里真实存在的那一条」为准：
  // 删掉或换了筛选条件后，自动回落到第一条，避免预览区停在一条已不存在的报告上。
  const active = useMemo(
    () => filtered.find((item) => item.filename === activeFile) || filtered[0] || null,
    [filtered, activeFile],
  );

  const activeFilename = active?.filename ?? null;

  useEffect(() => {
    if (!activeFilename) {
      setContent('');
      setContentError(null);
      setContentLoading(false);
      return;
    }
    const controller = new AbortController();
    setContentLoading(true);
    setContentError(null);
    fetchReportContent(activeFilename, controller.signal)
      .then(setContent)
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setContent('');
        setContentError(reason instanceof Error ? reason.message : '报告内容加载失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) setContentLoading(false);
      });
    return () => controller.abort();
  }, [activeFilename, reloadKey]);

  const handleDelete = async () => {
    if (!active) return;
    const ask = active.kind === 'viz'
      ? '确定删除这条出图记录？它引用的图片文件会一并删除。'
      : '确定删除这份报告？';
    if (!window.confirm(ask)) return;
    setDeleting(true);
    try {
      await deleteReport(active.filename);
      setActiveFile(null);
      setReloadKey((key) => key + 1);
    } catch (reason: unknown) {
      setContentError(reason instanceof Error ? reason.message : '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="catalog-page">
      <div className="catalog-shell">
        <header className="catalog-head">
          <div>
            <h1>报告中心</h1>
            <p>共 {counts.all} 份 · 报告 {counts.report} · 出图 {counts.viz}</p>
          </div>
          <div className="catalog-head-actions">
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
          {(['all', 'report', 'viz'] as const).map((key) => (
            <button
              key={key}
              type="button"
              className={`catalog-chip${kind === key ? ' is-active' : ''}`}
              onClick={() => setKind(key)}
            >
              {key === 'all' ? '全部' : KIND_LABEL[key]}
              <i>{counts[key]}</i>
            </button>
          ))}
          <label className="catalog-search">
            <span className="catalog-search-icon" aria-hidden="true"><Search size={13} /></span>
            <input
              className="ds-input"
              type="search"
              value={query}
              placeholder="搜索任务编号或文件名"
              onChange={(event) => setQuery(event.target.value)}
              aria-label="搜索报告"
            />
          </label>
        </div>

        <div className="catalog-split">
          <section className="catalog-panel" aria-label="报告列表">
            <header className="catalog-panel-head">
              <h2>报告与出图</h2>
              <span>{filtered.length} 条</span>
            </header>
            <div className="catalog-list">
              {loading && [0, 1, 2, 3].map((row) => (
                <div key={row} className="catalog-row" aria-hidden="true">
                  <span className="ds-skeleton catalog-skeleton-row" style={{ width: '100%' }} />
                </div>
              ))}

              {!loading && error && (
                <div className="catalog-empty" role="alert">
                  <FileText size={24} />
                  <span>{error}</span>
                  <button type="button" className="ds-button ds-button--secondary" onClick={() => setReloadKey((key) => key + 1)}>
                    <RefreshCw size={14} /> 重试
                  </button>
                </div>
              )}

              {!loading && !error && filtered.length === 0 && (
                <div className="catalog-empty">
                  <FileText size={24} />
                  <span>{reports.length === 0 ? '暂无报告或出图记录' : '没有匹配的记录'}</span>
                </div>
              )}

              {!loading && !error && filtered.map((item) => (
                <button
                  key={item.filename}
                  type="button"
                  className={`catalog-row${active?.filename === item.filename ? ' is-active' : ''}`}
                  onClick={() => setActiveFile(item.filename)}
                  title={item.filename}
                >
                  <span className={`catalog-tag catalog-tag--${item.kind}`}>{KIND_LABEL[item.kind]}</span>
                  <span className="catalog-row-main">
                    <span className="catalog-row-title">{item.taskId}</span>
                    <span className="catalog-row-meta">{item.time || '—'}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="catalog-panel catalog-preview" aria-label="报告预览">
            <header className="catalog-preview-bar">
              <span className="catalog-preview-title">
                {active ? (active.kind === 'viz' ? '出图详情' : '报告详情') : '未选择报告'}
              </span>
              <span className="catalog-preview-actions">
                {active && (
                  <button
                    type="button"
                    className="ds-button ds-button--ghost"
                    onClick={handleDelete}
                    disabled={deleting}
                    title="删除这条记录"
                  >
                    <Trash2 size={14} /> {deleting ? '删除中…' : '删除'}
                  </button>
                )}
              </span>
            </header>

            <div className="catalog-markdown">
              {!active && (
                <div className="catalog-empty">
                  <FileText size={26} />
                  <span>左侧选择一条记录查看内容</span>
                </div>
              )}
              {active && contentLoading && (
                <div className="catalog-empty"><span>加载中…</span></div>
              )}
              {active && !contentLoading && contentError && (
                <div className="catalog-empty" role="alert">
                  <ImageIcon size={24} />
                  <span>{contentError}</span>
                </div>
              )}
              {active && !contentLoading && !contentError && (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
