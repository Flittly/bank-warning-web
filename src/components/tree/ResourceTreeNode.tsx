import type { MouseEvent } from 'react';
import { useState } from 'react';
import {
  ChevronRight, ChevronDown, Folder, FolderOpen, FileText, Map as MapIcon,
  Layers, Settings, Zap, Scissors, Trash2, Eye, EyeOff, Target, Ruler,
  CircleCheck, Download, RotateCw, Move, Plus, Play, ChartColumn, Upload,
  Eraser, Globe, Palette, Check,
} from 'lucide-react';
import type { TreeNode } from '../../tree/types';
import { getActions } from '../../tree/actions';
import styles from './ResourceSidebar.module.css';

const ICONS: Record<string, any> = {
  folder: Folder, bank: MapIcon, section: FileText, param: Settings,
  dem: Layers, task: ChartColumn,
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
  dem: ['dem.toggleBounds'],
  section: ['section.props'],
  param: ['param.props'],
};

const CHILD_CAP = 200;

export default function ResourceTreeNode({
  node, depth, expanded, selected, onToggle, onSelect, onDoubleClick, onAction, onContextMenu,
}: Props) {
  const [showAll, setShowAll] = useState(false);
  const hasChildren = Boolean(node.children && node.children.length > 0);
  const Icon = ICONS[node.kind] || FileText;
  const RowIcon = hasChildren && expanded ? (node.kind === 'folder' || node.kind === 'group' ? FolderOpen : Icon) : Icon;
  const hoverKeys = (HOVER_ACTIONS[node.kind] || []).slice(0, 3);
  const allChildren = node.children || [];
  const capped = !showAll && allChildren.length > CHILD_CAP;
  const visibleChildren = capped ? allChildren.slice(0, CHILD_CAP) : allChildren;

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    onSelect(node);
    if (hasChildren) onToggle(node);
  };

  return (
    <div>
      <div
        className={`${styles.row} ${selected ? styles.rowSelected : ''} ${node.invalid ? styles.rowInvalid : ''}`}
        style={{ paddingLeft: depth * 20 + 6 }}
        onClick={handleClick}
        onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick(node); }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(node, e.clientX, e.clientY); }}
        title={node.label}
      >
        <span className={styles.chevron}>
          {hasChildren ? (expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : null}
        </span>
        <span className={styles.icon}><RowIcon size={14} /></span>
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
      {hasChildren && expanded && (
        <div>
          {visibleChildren.map((child) => (
            <ResourceTreeNodeBridge
              key={child.id}
              node={child}
              depth={depth + 1}
              onToggle={onToggle}
              onSelect={onSelect}
              onDoubleClick={onDoubleClick}
              onAction={onAction}
              onContextMenu={onContextMenu}
            />
          ))}
          {capped && (
            <div
              className={styles.row}
              style={{ paddingLeft: (depth + 1) * 20 + 6, color: '#2563eb', fontStyle: 'italic' }}
              onClick={(e) => { e.stopPropagation(); setShowAll(true); }}
            >
              显示全部 {allChildren.length} 条…
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import ResourceTreeNodeBridge from './ResourceTreeNodeBridge';
