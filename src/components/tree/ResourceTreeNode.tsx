import type { MouseEvent } from 'react';
import {
  ChevronRight, ChevronDown, Folder, Database, ListTodo, FileText, Map as MapIcon,
  Layers, Settings, Zap, Scissors, Trash2, Eye, EyeOff, Target, Ruler,
  CircleCheck, Download, RotateCw, Move, Plus, Play, ChartColumn, Upload,
  Eraser, Globe, Palette, Check, Square,
} from 'lucide-react';
import type { TreeNode } from '../../tree/types';
import { getActions } from '../../tree/actions';
import { splitHighlight } from '../../utils/highlight';
import styles from './ResourceSidebar.module.css';

const ICONS: Record<string, any> = {
  folder: Folder, bank: MapIcon, section: FileText, param: Settings,
  dem: Layers, task: ChartColumn, resources: Database, tasks: ListTodo,
};
const ACTION_ICONS: Record<string, any> = {
  upload: Upload, palette: Palette, eye: Eye, eyeOff: EyeOff, target: Target,
  settings: Settings, zap: Zap, scissors: Scissors, check: Check, layers: Layers,
  rotate: RotateCw, eraser: Eraser, ruler: Ruler, checkCircle: CircleCheck,
  download: Download, move: Move, plus: Plus, play: Play, chart: ChartColumn,
  trash: Trash2, globe: Globe, stop: Square,
};

interface Props {
  node: TreeNode;
  depth: number;
  expanded: boolean;
  selected: boolean;
  /** 当前画在地图上的 DEM tiff_key 集合（把对应行的开关标成"已开"） */
  activeDemKeys?: Set<string>;
  /** 搜索词：命中的片段用 <mark> 标出（非搜索态传空数组） */
  highlightTerms?: string[];
  onToggle: (node: TreeNode) => void;
  onSelect: (node: TreeNode, mod: { shift: boolean; ctrlOrMeta: boolean }) => void;
  onDoubleClick: (node: TreeNode) => void;
  onAction: (node: TreeNode, actionKey: string) => void;
  onContextMenu: (node: TreeNode, x: number, y: number) => void;
}

const HOVER_ACTIONS: Record<string, string[]> = {
  bank: ['bank.loadMap', 'bank.removeMap', 'bank.delete'],
  dem: ['dem.toggleBounds', 'dem.selectBanks'],
  // 断面尾部露出「加载到地图」：岸段被「移出地图」会连带摘掉其断面，
  // 这里是把断面找回来的最快入口，必须显眼。
  section: ['section.loadMap', 'section.props'],
  param: ['param.props'],
  // task 不走这张表：它的行尾按钮要随 status 变（见下面 TASK_HOVER_PRIORITY）
};

/**
 * 任务节点行尾**只露一个**按钮，且随状态切换：运行中露「终止运行」，否则露「执行风险分析」。
 * 两个同时摆出来会诱使人在任务正跑着的时候点重跑 —— 那是另一条会把已有结果清掉的路径
 * （后端 runTask 第一件事就是 clearTaskResults），不能让它挨着终止按钮。
 * 右键菜单里两个都在，需要时够得着。
 */
const TASK_HOVER_PRIORITY = ['task.stop', 'task.run'];

// 文件夹行尾只露这几对批量动作（且只有真正带着它们的文件夹才长出来，
// 见 treeModel 里各文件夹的 actions）——避免参数模板/DEM 等文件夹也跟着长出无用图标。
// 「岸段」文件夹用的是同名同义的 bank.loadAll / bank.removeAll（与断面那对完全对称）。
const FOLDER_HOVER_KEYS = ['section.loadAll', 'section.removeAll', 'bank.loadAll', 'bank.removeAll'];

const ROW_H = 28;
const ROW_TALL = 42;

export default function ResourceTreeNode({
  node, depth, expanded, selected, activeDemKeys, highlightTerms, onToggle, onSelect, onDoubleClick, onAction, onContextMenu,
}: Props) {
  const hasChildren = Boolean(node.children && node.children.length > 0);
  const Icon = ICONS[node.icon || node.kind] || FileText;
  const hoverKeys = node.kind === 'folder'
    ? (node.actions || []).filter((k) => FOLDER_HOVER_KEYS.includes(k)).slice(0, 3)
    : node.kind === 'task'
      ? TASK_HOVER_PRIORITY.filter((k) => (node.actions || []).includes(k)).slice(0, 1)
      : (HOVER_ACTIONS[node.kind] || []).slice(0, 3);
  const tall = Boolean(node.subtitle);
  // 这条 DEM 的范围是否正画在图上 —— 开关要有"已开"的样子，
  // 否则用户只能靠点第二次来试出当前状态（这正是之前那次误判的成因之一）。
  const demActive = node.kind === 'dem'
    && node.ref?.key != null
    && Boolean(activeDemKeys?.has(String(node.ref.key)));

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    const shift = e.shiftKey;
    const ctrlOrMeta = e.ctrlKey || e.metaKey;
    onSelect(node, { shift, ctrlOrMeta });
    // 范围/多选点击（Shift / Ctrl/Cmd）不触发展开折叠——那是"挑范围"的意图，
    // 展开折叠只留给普通单击，避免范围选择时节点开开关关晃眼。
    if (hasChildren && !shift && !ctrlOrMeta) onToggle(node);
  };

  return (
    <div style={{ height: tall ? ROW_TALL : ROW_H }}>
      <div
        className={`${styles.row} ${selected ? styles.rowSelected : ''} ${node.invalid ? styles.rowInvalid : ''} ${demActive ? styles.rowDemActive : ''}`}
        style={{ paddingLeft: depth * 20 + 6, height: ROW_H }}
        onClick={handleClick}
        onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick(node); }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(node, e.clientX, e.clientY); }}
        title={node.label}
      >
        <span className={styles.chevron}>
          {hasChildren ? (expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : null}
        </span>
        <span className={styles.icon}><Icon size={14} /></span>
        <span className={styles.label}>
          {!highlightTerms || highlightTerms.length === 0
            ? node.label
            : splitHighlight(node.label, highlightTerms).map((seg, i) =>
                seg.hit ? (
                  <mark key={i} className={styles.hl}>{seg.text}</mark>
                ) : (
                  <span key={i}>{seg.text}</span>
                ),
              )}
        </span>
        {node.meta ? <span className={styles.meta}>{node.meta}</span> : null}
        {hoverKeys.length > 0 && (
          <span className={styles.hoverActions}>
            {getActions(hoverKeys).map((a) => {
              const AIcon = ACTION_ICONS[a.icon] || Settings;
              return (
                <span
                  key={a.key}
                  className={`${styles.hIcon} ${a.key === 'dem.toggleBounds' && demActive ? styles.hIconActive : ''}`}
                  title={a.key === 'dem.toggleBounds' && demActive ? '不再显示该 DEM 的范围' : a.label}
                  onClick={(e) => { e.stopPropagation(); onAction(node, a.key); }}
                >
                  <AIcon size={13} />
                </span>
              );
            })}
          </span>
        )}
      </div>
      {tall && (
        <div className={styles.subtitleRow} style={{ paddingLeft: depth * 20 + 34 }}>
          <span className={styles.subtitle}>{node.subtitle}</span>
        </div>
      )}
    </div>
  );
}
