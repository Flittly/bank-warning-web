import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Search, X } from 'lucide-react';
import { KIND_LABEL, searchGlobal, toRefKeySet, type SearchHit } from '../services/searchApi';
import { useResourceTreeStore } from '../store/useResourceTreeStore';
import { splitHighlight } from '../utils/highlight';
import styles from './GlobalSearchBar.module.css';

/** 高亮渲染：产出 React 节点，不用 innerHTML */
function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  const segments = useMemo(() => splitHighlight(text, terms), [text, terms]);
  if (segments.length === 0) return null;
  return (
    <>
      {segments.map((seg, i) =>
        seg.hit ? (
          <mark key={i} className={styles.hl}>{seg.text}</mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}

/**
 * 顶部全局搜索框（Ctrl/Cmd+K 唤起）。
 *
 * 与资源树的联动不是「再查一遍树」，而是把命中写进 store：
 * 树自己订阅 searchQuery / searchTerms / searchMatchedRefs 做剪枝与高亮。
 * 这样搜索结果与树永远同一份判定，不会出现「列表说有、树里找不到」。
 */
export default function GlobalSearchBar() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [terms, setTerms] = useState<string[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [truncated, setTruncated] = useState(false);

  const setSearch = useResourceTreeStore((s) => s.setSearch);
  const setSearchBusy = useResourceTreeStore((s) => s.setSearchBusy);
  const selectNode = useResourceTreeStore((s) => s.selectNode);
  const setPendingFocus = useResourceTreeStore((s) => s.setPendingFocus);
  const clearSearch = useResourceTreeStore((s) => s.clearSearch);
  const busy = useResourceTreeStore((s) => s.searchBusy);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // 序号防覆盖：150ms debounce + 网络抖动下，先发的慢响应可能后到
  const seqRef = useRef(0);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  useEffect(() => {
    const q = query.trim();
    const seq = ++seqRef.current;
    abortRef.current?.abort();

    if (!q) {
      setHits([]);
      setTerms([]);
      setHint(null);
      setTruncated(false);
      setError(null);
      setOpen(false);
      setSearchBusy(false);
      clearSearch();
      return;
    }

    // 本地即时剪枝：不等网络，敲第一个字树就开始收窄。
    // 表单式 token（risk:3）不进 terms，否则树会去匹配 "risk:3" 这个字面量。
    const localTerms = q.split(/\s+/).filter((t) => t && !t.includes(':'));
    const effectiveTerms = localTerms.length > 0 ? localTerms : [q];
    setTerms(effectiveTerms);
    // strict=false：本地阶段按字面匹配，先让树有反应
    setSearch(q, effectiveTerms, new Set(), false);
    setOpen(true);
    setSearchBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const timer = window.setTimeout(async () => {
      try {
        const res = await searchGlobal(q, controller.signal);
        if (seq !== seqRef.current) return;
        setHits(res.hits);
        setHint(res.hint ?? null);
        setTruncated(Boolean(res.truncated));
        setError(null);
        setActive(0);
        setTerms(res.terms.length > 0 ? res.terms : effectiveTerms);
        // 后端命中覆盖本地：能捞出「关键词只在 description / 备注里」的结果。
        // strict=true 表示此后树只认这批 ref —— 带 risk: 筛选时树才不会比列表多。
        setSearch(
          res.query,
          res.terms.length > 0 ? res.terms : effectiveTerms,
          toRefKeySet(res.hits),
          true,
        );
      } catch (e) {
        if (controller.signal.aborted || seq !== seqRef.current) return;
        setError(e instanceof Error ? e.message : '搜索失败');
        setHits([]);
      } finally {
        if (seq === seqRef.current) setSearchBusy(false);
      }
    }, 150);

    return () => window.clearTimeout(timer);
  }, [query, setSearch, setSearchBusy, clearSearch]);

  const reset = useCallback(() => {
    setQuery('');
    setHits([]);
    setTerms([]);
    setHint(null);
    setTruncated(false);
    setError(null);
    setOpen(false);
    clearSearch();
    inputRef.current?.focus();
  }, [clearSearch]);

  const choose = useCallback(
    (hit: SearchHit) => {
      const taskId = hit.taskId || (hit.kind === 'task' ? hit.id : null);
      setOpen(false);

      if ((hit.kind === 'section' || hit.kind === 'note') && taskId && hit.sectionId) {
        // 树里同一个断面有两处引用，选「数据资源 > 断面」下那一支
        selectNode(`section:${taskId}:${hit.sectionId}`);
        // 坐标由后端 ST_Centroid 直接带出来，跳转后不必再查一次几何
        setPendingFocus({
          taskId,
          sectionId: hit.sectionId,
          sectionName: hit.title,
          lng: hit.lng ?? null,
          lat: hit.lat ?? null,
        });
      } else if (hit.kind === 'task' && taskId) {
        selectNode(`task:${taskId}`);
      } else if (hit.kind === 'bank' && hit.bankId) {
        selectNode(`bank:${hit.bankId}`);
      } else if (hit.kind === 'dem' && hit.demKey) {
        selectNode(`dem:${hit.demKey}`);
      }

      if (taskId) navigate(`/result/${taskId}`);
      else if (hit.kind === 'bank') navigate('/editor');
    },
    [navigate, selectNode, setPendingFocus],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (query) {
        reset();
      } else {
        setOpen(false);
        inputRef.current?.blur();
      }
      return;
    }
    if (!open || hits.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % hits.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + hits.length) % hits.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = hits[active] ?? hits[0];
      if (hit) choose(hit);
    }
  };

  const showPanel = open && query.trim().length > 0;

  return (
    <div className={styles.wrap} ref={rootRef}>
      <div className={`${styles.box} ${showPanel ? styles.boxActive : ''}`}>
        <Search size={14} className={styles.iconLeft} />
        <input
          ref={inputRef}
          className={styles.input}
          value={query}
          placeholder="搜索任务、岸段、断面、备注…"
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          aria-label="全局搜索"
        />
        {busy ? <Loader2 size={13} className={styles.spin} /> : null}
        {query ? (
          <span className={styles.clear} role="button" tabIndex={-1} title="清空" onClick={reset}>
            <X size={13} />
          </span>
        ) : (
          <kbd className={styles.kbd}>Ctrl K</kbd>
        )}
      </div>

      {showPanel && (
        <div className={styles.panel}>
          {error ? (
            <div className={styles.state}>{error}</div>
          ) : hint && hits.length === 0 ? (
            <div className={styles.state}>{hint}</div>
          ) : hits.length === 0 ? (
            <div className={styles.state}>
              {busy ? '检索中…' : `没有匹配「${query.trim()}」的对象`}
            </div>
          ) : (
            <>
              <div className={styles.summary}>
                {truncated
                  ? `显示前 ${hits.length} 条（命中更多，建议补充关键词）`
                  : `共 ${hits.length} 条`}
                {' · '}↑↓ 选择，Enter 打开
              </div>
              <div className={styles.list}>
                {hits.map((hit, i) => (
                  <div
                    key={`${hit.kind}:${hit.id}:${i}`}
                    className={`${styles.item} ${i === active ? styles.itemActive : ''}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(hit)}
                  >
                    <span className={`${styles.kind} ${styles[`kind_${hit.kind}`] || ''}`}>
                      {KIND_LABEL[hit.kind] || hit.kind}
                    </span>
                    <span className={styles.itemBody}>
                      <span className={styles.itemTitleRow}>
                        <span className={styles.itemTitle}>
                          <Highlighted text={hit.title} terms={terms} />
                          {hit.duplicateCount && hit.duplicateCount > 1 ? (
                            <span className={styles.dup} title="同名对象数量">+{hit.duplicateCount - 1}</span>
                          ) : null}
                        </span>
                        {/* 同名对象（90+ 条「岸线分析任务」）光看标题无法区分，右侧补时间与 id 尾段 */}
                        <span className={styles.itemMeta}>
                          {hit.updatedAt ? hit.updatedAt.slice(0, 10) : ''}
                        </span>
                      </span>
                      {hit.snippet ? (
                        <span className={styles.itemSnippet}>
                          <Highlighted text={hit.snippet} terms={terms} />
                        </span>
                      ) : null}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
