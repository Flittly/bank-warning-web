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
import { createPortal } from 'react-dom';
import {
  ChevronDown,
  ChevronRight,
  Crosshair,
  EyeOff,
  Layers,
  Ruler,
  Scan,
  Square,
  SquareDashed,
  Waves,
  X,
} from 'lucide-react';
import type { DisplayGroup, LoadedGroup, LoadedRow, RunningTaskRow } from './loadedOnMap';
import { buildLoadedView, formatElapsed, parseServerTime } from './loadedOnMap';
import styles from './LoadedOnMapPanel.module.css';

/** 「岸段」框选的结果，只用于在面板里标出命中项与计数（判定本身在 `map/boxSelection.ts`）。 */
export interface LoadedBoxSelection {
  /** 命中的岸段 id */
  bankIds: string[];
  /** 参与判定的候选条数（已加载 N 条 / 全库 N 条） */
  candidates: number;
  scope: 'loaded' | 'library';
}

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
  /**
   * 进入"在地图上拖矩形框选岸段"的模式。
   *
   * @param scope `loaded` = 只在已加载到屏幕的岸段里选；`library` = 从资源库全量选（命中后加载到地图）
   */
  onStartBoxSelect?: (scope: 'loaded' | 'library') => void;
  /** 清除已生效的框选（地图上的矩形与高亮一起消失，不动岸段本身） */
  onClearBoxSelect?: () => void;
}

interface Props {
  groups: LoadedGroup[];
  running: RunningTaskRow[];
  /** 地图上当前选中的断面 id（用于高亮面板里的对应行） */
  activeSectionId?: string | null;
  /** 当前生效的框选结果；null / undefined = 没有框选 */
  boxSelection?: LoadedBoxSelection | null;
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
  boxSelection,
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

  /**
   * 「岸段」右键菜单的屏幕坐标。
   *
   * <p>这个面板以前没有右键菜单（行尾就两个图标）。框选是个"作用于整组"的动作，
   * 摆在组标题上比塞进行尾更合适 —— 而窄栏里再挤一个按钮会挤压标签文本，
   * 所以走右键：与资源树的交互保持一致，老用户不用学新入口。
   */
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  /** 命中集合：只有框选生效时才有意义，用 Set 查得更快 */
  const boxHitIds = useMemo(
    () => (boxSelection ? new Set(boxSelection.bankIds.map(String)) : null),
    [boxSelection],
  );

  // 点空白处 / 滚轮 / 缩放窗口都关掉右键菜单（与 TreeContextMenu 同一套关闭时机）
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      // 菜单自身的点击由菜单项自己处理，这里放行
      if (el?.closest?.('[data-loaded-ctx]')) return;
      close();
    };
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('resize', close);
    window.addEventListener('wheel', close, { passive: true });
    window.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('wheel', close);
      window.removeEventListener('keydown', close);
    };
  }, [menu]);

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
    // 岸段组单独处理：即使一条都没加载，「框选(box)」也该能用（可以从全库框选后加载进来），
    // 所以不能套用下面那句 `g.total === 0 ⇒ 不渲染`。
    if (g.key === 'banks') {
      const canBox = Boolean(actions?.onStartBoxSelect);
      if (g.total === 0 && !canBox) return null;
      return (
        <>
          {canBox && (
            <button
              type="button"
              className={styles.groupBtn}
              data-tour="tree-loaded-box-select"
              title="在地图上按住鼠标拖一个矩形，框选范围内的岸段（与「按 DEM 筛选」互不影响）"
              onClick={(e) => { e.stopPropagation(); actions!.onStartBoxSelect!('loaded'); }}
            >
              <Scan size={11} /> 框选
            </button>
          )}
          {g.total > 0 && actions?.onRemoveAllBanks && (
            <button type="button" className={styles.groupBtn} title="把地图上的岸段（连同其断面）全部移出"
              onClick={(e) => { e.stopPropagation(); actions.onRemoveAllBanks!(); }}>
              <EyeOff size={11} /> 全部移出
            </button>
          )}
        </>
      );
    }
    if (g.total === 0) return null;
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
              <>
                <p className={styles.empty}>
                  地图上还没有加载任何资源。在资源树里双击条目，或右键选「加载到地图」——这里会立刻把它们列出来。
                </p>
                {/* 地图空着的时候，恰恰是最想"划一块区域把岸段找出来"的时候：
                    组列表整体被空态替换掉了，所以在这里补一个框选全库的入口。 */}
                {actions?.onStartBoxSelect && (
                  <button type="button" className={styles.emptyBoxBtn}
                    onClick={() => actions.onStartBoxSelect!('library')}>
                    <Scan size={12} /> 在地图上框选全库岸段
                  </button>
                )}
              </>
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
                      onContextMenu={(e) => {
                        // 只有「岸段」组有框选菜单；其它组的右键交还给浏览器（保持原行为）
                        if (g.key !== 'banks' || !actions?.onStartBoxSelect) return;
                        e.preventDefault();
                        e.stopPropagation();
                        setMenu({ x: e.clientX, y: e.clientY });
                      }}
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
                          {g.rows.map((row) => {
                            // 框选生效时：命中项打「框内」标，未命中的淡出。
                            // 只对「岸段」组生效——断面/DEM 不参与框选，不该被一起标灰。
                            const inBox = g.key === 'banks' && boxHitIds ? boxHitIds.has(String(row.id)) : null;
                            const outOfBox = inBox === false && boxHitIds !== null;
                            return (
                              <li
                                key={row.id}
                                className={[
                                  styles.row,
                                  row.dimmed ? styles.rowDimmed : '',
                                  outOfBox ? styles.rowOutsideBox : '',
                                  g.key === 'sections' && activeSectionId === row.id ? styles.rowActive : '',
                                ].join(' ')}
                                title={`${row.label}${row.meta ? ` · ${row.meta}` : ''}`}
                                onClick={() => focusRow(g, row)}
                                onContextMenu={(e) => {
                                  if (g.key !== 'banks' || !actions?.onStartBoxSelect) return;
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setMenu({ x: e.clientX, y: e.clientY });
                                }}
                              >
                                <span className={styles.rowLabel}>{row.label}</span>
                                {inBox && <span className={styles.tagInBox}>框内</span>}
                                {row.currentTask && <span className={styles.tagCurrent}>当前任务</span>}
                                <span className={styles.spacer} />
                                {row.meta && <span className={styles.rowMeta}>{row.meta}</span>}
                                {rowActions(g, row)}
                              </li>
                            );
                          })}
                        </ul>
                        {/* 框选结果的计数与清除入口：挂在「岸段」组下面，用户不用回忆框在哪 */}
                        {g.key === 'banks' && boxSelection && (
                          <div className={styles.boxNote}>
                            <SquareDashed size={11} />
                            <span className={styles.boxNoteText}>
                              框选命中 <b>{boxSelection.bankIds.length}</b> / {boxSelection.candidates} 条
                              {boxSelection.scope === 'library' ? '（全库）' : ''}
                            </span>
                            {actions?.onClearBoxSelect && (
                              <button type="button" className={styles.boxClear}
                                title="清除框选：地图上的矩形与高亮一起移除，岸段保持不动"
                                onClick={() => actions.onClearBoxSelect!()}>
                                清除
                              </button>
                            )}
                            {actions?.onStartBoxSelect && (
                              <button type="button" className={styles.boxClear}
                                title="重新框选（把范围收紧或换一块）"
                                onClick={() => actions.onStartBoxSelect!('loaded')}>
                                重框
                              </button>
                            )}
                          </div>
                        )}
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

      {/* 「岸段」右键菜单：框选的两个范围口径 + 清除。
          用 portal 挂到 body 上：面板有 `overflow: hidden`，而且祖先链上有 backdrop-filter
          （会为 fixed 后代创建包含块），菜单留在组件树里会被裁掉一截。
          定位仍是 position: fixed，坐标直接取 clientX/clientY。 */}
      {menu && actions?.onStartBoxSelect && createPortal(
        <div className={styles.ctx} style={{ left: menu.x, top: menu.y }} data-loaded-ctx>
          <div className={styles.ctxItem}
            onClick={() => { setMenu(null); actions.onStartBoxSelect!('loaded'); }}>
            <Scan size={13} /> 框选岸段（已加载范围内）
          </div>
          <div className={styles.ctxItem}
            onClick={() => { setMenu(null); actions.onStartBoxSelect!('library'); }}>
            <Layers size={13} /> 框选全库岸段…
          </div>
          <div className={styles.ctxSep} />
          <div
            className={`${styles.ctxItem} ${boxSelection ? '' : styles.ctxDisabled}`}
            title={boxSelection ? '移除地图上的矩形与高亮（岸段保持不动）' : '当前没有生效的框选'}
            onClick={() => {
              setMenu(null);
              if (boxSelection) actions?.onClearBoxSelect?.();
            }}
          >
            <X size={13} /> 清除框选
          </div>
        </div>,
        document.body,
      )}
    </section>
  );
}
