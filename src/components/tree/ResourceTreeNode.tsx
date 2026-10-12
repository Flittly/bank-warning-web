import type { MouseEvent } from 'react';
import {
  ChevronRight, ChevronDown, Folder, Database, ListTodo, FileText, Map as MapIcon,
  Layers, Settings, Zap, Scissors, Trash2, Eye, EyeOff, Target, Ruler,
  CircleCheck, Download, RotateCw, Move, Plus, Play, ChartColumn, Upload,
  Eraser, Globe, Palette, Check,
} from 'lucide-react';
import type { TreeNode } from '../../tree/types';
import { getActions } from '../../tree/actions';
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
  trash: Trash2, globe: Globe,
};

interface Props {
  node: TreeNode;
  depth: number;
  expanded: boolean;
  selected: boolean;
  onToggle: (node: TreeNode) => void;
  onSelect: (node: TreeNode) => void;
  onDoubleClick: (node: TreeNode) => void;
  onAction: (node: TreeNode, actionKey: string) => void;
  onContextMenu: (node: TreeNode, x: number, y: number) => void;
}

const HOVER_ACTIONS: Record<string, string[]> = {
  bank: ['bank.loadMap', 'bank.removeMap', 'bank.delete'],
  task: ['task.run'],
  dem: ['dem.toggleBounds', 'dem.selectBanks'],
  // 断面尾部露出「加载到地图」：岸段被「移出地图」会连带摘掉其断面，
  // 这里是把断面找回来的最快入口，必须显眼。
  section: ['section.loadMap', 'section.props'],
  param: ['param.props'],
};

// 文件夹行尾只露这一对批量动作（且只有真正装着断面的文件夹才带着它们，
// 见 treeModel 里各断面文件夹的 actions）——避免参数模板/DEM 等文件夹也跟着长出无用图标。
const FOLDER_HOVER_KEYS = ['section.loadAll', 'section.removeAll'];

const ROW_H = 28;
const ROW_TALL = 42;

export default function ResourceTreeNode({
  node, depth, expanded, selected, onToggle, onSelect, onDoubleClick, onAction, onContextMenu,
}: Props) {
  const hasChildren = Boolean(node.children && node.children.length > 0);
  const Icon = ICONS[node.icon || node.kind] || FileText;
  const hoverKeys = node.kind === 'folder'
    ? (node.actions || []).filter((k) => FOLDER_HOVER_KEYS.includes(k)).slice(0, 3)
    : (HOVER_ACTIONS[node.kind] || []).slice(0, 3);
  const tall = Boolean(node.subtitle);

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    onSelect(node);
    if (hasChildren) onToggle(node);
  };

  return (
    <div style={{ height: tall ? ROW_TALL : ROW_H }}>
      <div
        className={`${styles.row} ${selected ? styles.rowSelected : ''} ${node.invalid ? styles.rowInvalid : ''}`}
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
        <span className={styles.label}>{node.label}</span>
        {node.meta ? <span className={styles.meta}>{node.meta}</span> : null}
        {hoverKeys.length > 0 && (
          <span className={styles.hoverActions}>
            {getActions(hoverKeys).map((a) => {
              const AIcon = ACTION_ICONS[a.icon] || Settings;
              return (
                <span
                  key={a.key}
                  className={styles.hIcon}
                  title={a.label}
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
