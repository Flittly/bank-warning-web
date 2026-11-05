import { useEffect, useMemo, useState } from 'react';
import { Box, Download, RefreshCw, Search, Upload } from 'lucide-react';
import {
  SKILL_SOURCE_META,
  approvalLabelOf,
  downloadSkill,
  fetchSkillCatalog,
  uploadSkill,
  type SkillEntry,
  type SkillSource,
} from '../services/skillCatalogService';
import './catalog.css';

type SourceFilter = 'all' | SkillSource;

const SOURCE_TABS: Array<{ key: SourceFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'local', label: '本地' },
  { key: 'synced', label: '已同步' },
  { key: 'nacos', label: 'Nacos' },
];

/**
 * 技能中心（/skills）。
 *
 * <p>独立页面：只调 `/v0/bank/ai/skill/list`，与结果页的 Skills 面板互不共享 state；
 * 进入这里不会初始化地图、不会选中任务，也不会跳去编辑器。
 */
export default function SkillsPage() {
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [query, setQuery] = useState('');
  const [source, setSource] = useState<SourceFilter>('all');
  const [busyName, setBusyName] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ name: string; text: string; ok: boolean } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchSkillCatalog(controller.signal)
      .then(setSkills)
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setError(reason instanceof Error ? reason.message : '技能列表加载失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reloadKey]);

  const counts = useMemo(() => ({
    all: skills.length,
    local: skills.filter((item) => item.source === 'local').length,
    synced: skills.filter((item) => item.source === 'synced').length,
    nacos: skills.filter((item) => item.source === 'nacos').length,
  }), [skills]);

  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return skills.filter((item) => {
      if (source !== 'all' && item.source !== source) return false;
      if (!keyword) return true;
      return item.name.toLowerCase().includes(keyword) || item.description.toLowerCase().includes(keyword);
    });
  }, [skills, source, query]);

  const runAction = async (skill: SkillEntry, action: 'upload' | 'download') => {
    setBusyName(skill.name);
    setNotice(null);
    try {
      if (action === 'upload') await uploadSkill(skill.name);
      else await downloadSkill(skill.name);
      setNotice({
        name: skill.name,
        text: action === 'upload' ? '已上传，等待审批' : '已下载到本地',
        ok: true,
      });
      setReloadKey((key) => key + 1);
    } catch (reason: unknown) {
      setNotice({
        name: skill.name,
        text: reason instanceof Error ? reason.message : '操作失败',
        ok: false,
      });
    } finally {
      setBusyName(null);
    }
  };

  return (
    <div className="catalog-page">
      <div className="catalog-shell">
        <header className="catalog-head">
          <div>
            <h1>技能中心</h1>
            <p>
              共 {counts.all} 个 · 本地 {counts.local} · 已同步 {counts.synced} · Nacos {counts.nacos}
            </p>
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
          {SOURCE_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`catalog-chip${source === tab.key ? ' is-active' : ''}`}
              onClick={() => setSource(tab.key)}
            >
              {tab.label}
              <i>{counts[tab.key]}</i>
            </button>
          ))}
          <label className="catalog-search">
            <span className="catalog-search-icon" aria-hidden="true"><Search size={13} /></span>
            <input
              className="ds-input"
              type="search"
              value={query}
              placeholder="搜索技能名称或描述"
              onChange={(event) => setQuery(event.target.value)}
              aria-label="搜索技能"
            />
          </label>
        </div>

        {loading && (
          <div className="skill-grid" aria-hidden="true">
            {[0, 1, 2].map((card) => (
              <div key={card} className="skill-card">
                <span className="ds-skeleton" style={{ height: 16, width: '60%' }} />
                <span className="ds-skeleton" style={{ height: 12, width: '100%' }} />
                <span className="ds-skeleton" style={{ height: 12, width: '80%' }} />
              </div>
            ))}
          </div>
        )}

        {!loading && error && (
          <div className="catalog-panel catalog-empty" role="alert">
            <Box size={24} />
            <span>{error}</span>
            <button type="button" className="ds-button ds-button--secondary" onClick={() => setReloadKey((key) => key + 1)}>
              <RefreshCw size={14} /> 重试
            </button>
          </div>
        )}

        {!loading && !error && visible.length === 0 && (
          <div className="catalog-panel catalog-empty">
            <Box size={24} />
            <span>{skills.length === 0 ? '暂无技能' : '没有匹配的技能'}</span>
          </div>
        )}

        {!loading && !error && visible.length > 0 && (
          <div className="skill-grid">
            {visible.map((skill) => {
              const sourceMeta = SKILL_SOURCE_META[skill.source];
              const approval = approvalLabelOf(skill.approval);
              const busy = busyName === skill.name;
              return (
                <article className="skill-card" key={skill.name}>
                  <header className="skill-card-head">
                    <span className="skill-card-icon"><Box size={16} /></span>
                    <span className="skill-card-name" title={skill.name}>{skill.name}</span>
                    {skill.version && <span className="skill-card-version">v{skill.version}</span>}
                  </header>

                  <p className="skill-card-desc">{skill.description || '暂无描述'}</p>

                  <footer className="skill-card-foot">
                    <span className="skill-card-badges">
                      <span className={`ds-badge ds-badge--${sourceMeta.tone}`}>{sourceMeta.label}</span>
                      {approval && (
                        <span className={`ds-badge ds-badge--${skill.approval === 'APPROVED' ? 'success' : skill.approval === 'PENDING' ? 'warning' : skill.approval === 'REJECTED' ? 'danger' : 'info'}`}>
                          {approval}
                        </span>
                      )}
                    </span>

                    {skill.source === 'local' && (
                      <button
                        type="button"
                        className="ds-button ds-button--secondary"
                        onClick={() => void runAction(skill, 'upload')}
                        disabled={busy}
                      >
                        <Upload size={13} /> {busy ? '上传中…' : '上传'}
                      </button>
                    )}
                    {skill.source === 'nacos' && (
                      <button
                        type="button"
                        className="ds-button ds-button--secondary"
                        onClick={() => void runAction(skill, 'download')}
                        disabled={busy}
                      >
                        <Download size={13} /> {busy ? '下载中…' : '下载到本地'}
                      </button>
                    )}
                    {skill.source === 'synced' && <span className="skill-card-hint">已同步，无需操作</span>}
                  </footer>

                  {notice?.name === skill.name && (
                    <span
                      className="skill-card-hint"
                      style={{ color: notice.ok ? 'var(--ds-success)' : 'var(--ds-danger)' }}
                      role="status"
                    >
                      {notice.text}
                    </span>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
