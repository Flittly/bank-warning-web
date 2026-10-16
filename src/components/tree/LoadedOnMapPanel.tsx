/**
 * 左侧边栏下半区：「已加载到屏幕」。
 *
 * <p>只负责渲染 —— 数据口径与分组逻辑都在 `loadedOnMap.ts`（纯函数、有单测），
 * 操作由 `ResourceSidebar` 透传（定位 / 移出 / 全部移出 / 隐藏 DEM 范围）。
 *
 * <p>面板本身只有三组内容 + 一条运行横幅，不摆任何筛选控件：
 * 按类型分组本身就已经是筛选手段，再叠一层搜索/标签只会让这个 300px 宽的窄栏更挤。
 * 分组标题可点折叠，折叠态记在 localStorage；某组超过 60 条时给一个「显示全部」兜底。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Crosshair,
  EyeOff,
  Layers,
  Ruler,
  Square,
  Waves,
  X,
} from 'lucide-react';
import type { DisplayGroup, LoadedGroup, LoadedRow, RunningTaskRow } from './loadedOnMap';
import { buildLoadedView, formatElapsed, parseServerTime } from './loadedOnMap';
import styles from './LoadedOnMapPanel.module.css';

export interface LoadedOnMapActions {
  /** 定位到某条岸段（不在图上的会先加载回来） */
  onFocusBank?: (bankId: string) => void;
  /** 把某条岸段（连同其断面）移出地图 */
  onRemoveBank?: (bankId: string) => void;
  /** 全部移出岸段 */
  onRemoveAllBanks?: () => void;
  /** 选中并定位某条断面 */
  onFocusSection?: (sectionId: string) => void;
  /** 把某条断面移出地图 */
  onRemoveSection?: (sectionId: string) => void;
  /** 全部移出断面 */
  onRemoveAllSections?: () => void;
  /** 只聚焦显示这一条 DEM 的范围 */
  onFocusDem?: (tiffKey: string) => void;
  /** 隐藏全部 DEM 范围 */
  onHideDems?: () => void;
  /**
   * 终止某个正在运行的任务（确认框与提示文案都在上层，面板不自己弹窗）。
   *
   * @returns true 表示请求已被受理 ⇒ 面板把该行锁成「终止中」，等任务真的从
   *          running 里消失再解锁；false 表示失败/被取消 ⇒ 立刻恢复可点。
   */
  onStopTask?: (taskId: string, taskName: string) => Promise<boolean>;
}

interface Props {
  groups: LoadedGroup[];
  running: RunningTaskRow[];
  /** 地图上当前选中的断面 id（用于高亮面板里的对应行） */
  activeSectionId?: string | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  actions?: LoadedOnMapActions;
}

const ICONS: Record<LoadedGroup['key'], typeof Layers> = {
  banks: Waves,
  sections: Ruler,
  dems: Layers,
};

/** 被折叠的分组：换页面/刷新后保持，避免每次进来都要重新收一遍 */
const COLLAPSED_KEY = 'loaded-groups-collapsed';

function readCollapsed(): string[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(COLLAPSED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function writeCollapsed(keys: string[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(keys));
  } catch {
    /* 隐私模式下写不进去，忽略即可 */
  }
}

function IconOf({ groupKey }: { groupKey: LoadedGroup['key'] }) {
  const Icon = ICONS[groupKey];
  return <Icon size={12} />;
}

export default function LoadedOnMapPanel({
  groups,
  running,
  activeSectionId,
  collapsed,
  onToggleCollapsed,
  actions,
}: Props) {
  const [collapsedKeys, setCollapsedKeys] = useState<string[]>(readCollapsed);
  /** 用户点过「显示全部」的分组：不受每组 60 条上限约束 */
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  /**
   * 已受理「终止」但服务端还没把它从 running 里摘掉的 taskId。
   *
   * <p>为什么需要这个中间态：协作式取消只是"请求已受理"，任务还要把当前断面算完才停，
   * 这期间任务列表里它依旧是 running。如果不锁住按钮，用户会以为没生效而反复点。
   */
  const [stoppingIds, setStoppingIds] = useState<string[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  // 运行时长每秒刷新一次；没有任务在跑时不起定时器（空跑会让 CPU 白转）
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (running.length === 0) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running.length]);

  const runningRows = useMemo(
    () =>
      running.map((r) => {
        const started = parseServerTime(r.startedAt);
        return { ...r, elapsed: started == null ? '' : formatElapsed(now - started) };
      }),
    [running, now],
  );

  const view = useMemo(
    () => buildLoadedView(groups, { collapsed: collapsedKeys, expandKeys: expandedKeys }),
    [groups, collapsedKeys, expandedKeys],
  );

  // 任务真的停了（从 running 里消失）⇒ 解锁它，别把「终止中」钉死在界面上
  useEffect(() => {
    setStoppingIds((prev) => {
      if (prev.length === 0) return prev;
      const live = new Set(running.map((r) => r.taskId));
      const next = prev.filter((id) => live.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [running]);

  const stopRunningTask = async (taskId: string, taskName: string) => {
    if (!actions?.onStopTask) return;
    setBusyId(taskId);
    let accepted = false;
    try {
      accepted = await actions.onStopTask(taskId, taskName);
    } finally {
      setBusyId(null);
      if (accepted) setStoppingIds((prev) => (prev.includes(taskId) ? prev : [...prev, taskId]));
    }
  };

  const toggleGroup = (key: LoadedGroup['key']) => {
    setCollapsedKeys((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      writeCollapsed(next);
      return next;
    });
  };

  const expandGroup = (key: LoadedGroup['key']) => {
    setExpandedKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
  };

  const groupAction = (g: DisplayGroup) => {
    if (g.total === 0) return null;
    if (g.key === 'banks' && actions?.onRemoveAllBanks) {
      return (
        <button type="button" className={styles.groupBtn} title="把地图上的岸段（连同其断面）全部移出"
          onClick={(e) => { e.stopPropagation(); actions.onRemoveAllBanks!(); }}>
          <EyeOff size={11} /> 全部移出
        </button>
      );
    }
    if (g.key === 'sections' && actions?.onRemoveAllSections) {
      return (
        <button type="button" className={styles.groupBtn} title="把地图上的断面全部移出"
          onClick={(e) => { e.stopPropagation(); actions.onRemoveAllSections!(); }}>
          <EyeOff size={11} /> 全部移出
        </button>
      );
    }
    if (g.key === 'dems' && actions?.onHideDems) {
      return (
        <button type="button" className={styles.groupBtn} title="隐藏地图上的 DEM 范围框"
          onClick={(e) => { e.stopPropagation(); actions.onHideDems!(); }}>
          <EyeOff size={11} /> 隐藏
        </button>
      );
    }
    return null;
  };

  const focusRow = (g: DisplayGroup, row: LoadedRow) => {
    if (g.key === 'banks') actions?.onFocusBank?.(row.id);
    else if (g.key === 'sections') actions?.onFocusSection?.(row.id);
    else actions?.onFocusDem?.(row.id);
  };

  const rowActions = (g: DisplayGroup, row: LoadedRow) => {
    const remove = () => {
      if (g.key === 'banks') actions?.onRemoveBank?.(row.id);
      else if (g.key === 'sections') actions?.onRemoveSection?.(row.id);
    };
    const canFocus = g.key === 'dems'
      ? Boolean(actions?.onFocusDem)
      : g.key === 'banks' ? Boolean(actions?.onFocusBank) : Boolean(actions?.onFocusSection);
    const canRemove = g.key === 'dems'
      ? false
      : g.key === 'banks' ? Boolean(actions?.onRemoveBank) : Boolean(actions?.onRemoveSection);
    if (!canFocus && !canRemove) return null;
    return (
      <span className={styles.rowActions}>
        {canFocus && (
          <button type="button" className={styles.rowBtn} title="定位"
            onClick={(e) => { e.stopPropagation(); focusRow(g, row); }}>
            <Crosshair size={12} />
          </button>
        )}
        {canRemove && (
          <button type="button" className={styles.rowBtn} title="移出地图"
            onClick={(e) => { e.stopPropagation(); remove(); }}>
            <X size={12} />
          </button>
        )}
      </span>
    );
  };

  const groupHiddenNote = (g: DisplayGroup) =>
    g.key === 'sections' && g.rows.length > 0 && g.rows.every((r) => r.dimmed);

  return (
    <section className={styles.panel} data-tour="tree-loaded">
      <header className={styles.head} onClick={onToggleCollapsed} title={collapsed ? '展开' : '收起'}>
        <span className={styles.chevron}>{collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}</span>
        <span className={styles.headTitle}>已加载到屏幕</span>
        <span className={styles.headCount}>{view.total}</span>
        {runningRows.length > 0 && (
          <span className={styles.live} title={`正在运行：${runningRows.map((r) => r.taskName).join('、')}`}>
            <i className={styles.dot} />
            运行中 {runningRows.length}
          </span>
        )}
      </header>

      {!collapsed && (
        <>
          {/* 运行横幅放在滚动区之外：滚到列表深处也不会把「在跑哪个任务」滚丢 */}
          {runningRows.length > 0 && (
            <div className={styles.running} data-tour="tree-loaded-running">
              {runningRows.map((r) => {
                const stopping = stoppingIds.includes(r.taskId);
                const busy = busyId === r.taskId;
                return (
                  <div key={r.taskId} className={styles.runningRow}>
                    <span className={styles.spinner} />
                    <span className={styles.runningText}>
                      <b className={styles.runningName} title={`${r.taskName}（${r.taskId}）`}>
                        正在运行：{r.taskName}
                      </b>
                      {r.elapsed && <span className={styles.runningTime}>{r.elapsed}</span>}
                    </span>
                    {actions?.onStopTask && (
                      <button
                        type="button"
                        className={styles.stopBtn}
                        data-tour="tree-loaded-stop"
                        disabled={busy || stopping}
                        title={stopping
                          ? '已请求终止：正在等当前断面算完，完成后这一行会自动消失'
                          : `终止「${r.taskName}」的运行`}
                        onClick={() => { void stopRunningTask(r.taskId, r.taskName); }}
                      >
                        <Square size={10} />
                        {stopping ? '终止中' : '终止'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className={styles.body}>
            {view.total === 0 ? (
              <p className={styles.empty}>
                地图上还没有加载任何资源。在资源树里双击条目，或右键选「加载到地图」——这里会立刻把它们列出来。
              </p>
            ) : (
              <>
                {view.groups.map((g) => (
                  <div key={g.key} className={styles.group}>
                    <div
                      className={styles.groupHead}
                      role="button"
                      tabIndex={0}
                      aria-expanded={!g.collapsed}
                      title={g.collapsed ? `展开「${g.title}」` : `收起「${g.title}」`}
                      onClick={() => toggleGroup(g.key)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleGroup(g.key); }
                      }}
                    >
                      <span className={styles.groupChevron}>
                        {g.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                      </span>
                      <span className={styles.groupIcon}><IconOf groupKey={g.key} /></span>
                      <span className={styles.groupTitle}>{g.title}</span>
                      <span className={styles.groupCount}>{g.total}</span>
                      <span className={styles.groupAction}>{groupAction(g)}</span>
                    </div>

                    {g.collapsed ? null : g.emptyKind === 'no-data' ? (
                      <p className={styles.groupEmpty}>{g.hint}</p>
                    ) : (
                      <>
                        {groupHiddenNote(g) && (
                          <p className={styles.groupEmpty}>断面已加载，但「断面」图层当前是关闭的（视图开关）。</p>
                        )}
                        <ul className={styles.rows}>
                          {g.rows.map((row) => (
                            <li
                              key={row.id}
                              className={[
                                styles.row,
                                row.dimmed ? styles.rowDimmed : '',
                                g.key === 'sections' && activeSectionId === row.id ? styles.rowActive : '',
                              ].join(' ')}
                              title={`${row.label}${row.meta ? ` · ${row.meta}` : ''}`}
                              onClick={() => focusRow(g, row)}
                            >
                              <span className={styles.rowLabel}>{row.label}</span>
                              {row.currentTask && <span className={styles.tagCurrent}>当前任务</span>}
                              <span className={styles.spacer} />
                              {row.meta && <span className={styles.rowMeta}>{row.meta}</span>}
                              {rowActions(g, row)}
                            </li>
                          ))}
                        </ul>
                        {g.hiddenByLimit > 0 && (
                          <button type="button" className={styles.moreBtn}
                            onClick={() => expandGroup(g.key)}>
                            还有 {g.hiddenByLimit} 条未显示 · 显示全部
                          </button>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
