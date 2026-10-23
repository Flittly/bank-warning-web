import { useEffect, useRef } from 'react';
import {
  Upload, Palette, Eye, EyeOff, Target, Settings, Zap, Scissors, Check,
  Layers, RotateCw, Eraser, Ruler, CircleCheck, Download, Move, Plus,
  Play, ChartColumn, Trash2, Globe, Copy,
} from 'lucide-react';
import type { TreeNode } from '../../tree/types';
import { getActions } from '../../tree/actions';
import styles from './ResourceSidebar.module.css';

const ACTION_ICONS: Record<string, any> = {
  upload: Upload, palette: Palette, eye: Eye, eyeOff: EyeOff, target: Target,
  settings: Settings, zap: Zap, scissors: Scissors, check: Check, layers: Layers,
  rotate: RotateCw, eraser: Eraser, ruler: Ruler, checkCircle: CircleCheck,
  download: Download, move: Move, plus: Plus, play: Play, chart: ChartColumn,
  trash: Trash2, globe: Globe, copy: Copy,
};

interface Props {
  node: TreeNode;
  x: number;
  y: number;
  onAction: (node: TreeNode, actionKey: string) => void;
  onClose: () => void;
}

export default function TreeContextMenu({ node, x, y, onAction, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 捕获阶段监听 mousedown：避免被树行 onClick 的 stopPropagation 吞掉
    const onDocMouseDown = (e: MouseEvent) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDocMouseDown, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const items = getActions(node.actions || []);
  if (items.length === 0) return null;

  return (
    <div ref={ref} className={styles.ctx} style={{ left: x, top: y }}>
      {items.map((a) => {
        const AIcon = ACTION_ICONS[a.icon] || Settings;
        return (
          <div key={a.key}>
            {a.separatorBefore && <div className={styles.ctxSep} />}
            <div
              className={`${styles.ctxItem} ${a.danger ? styles.ctxDanger : ''}`}
              onClick={() => { onAction(node, a.key); onClose(); }}
            >
              <AIcon size={13} /> {a.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}
