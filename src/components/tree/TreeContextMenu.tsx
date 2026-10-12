import { useEffect } from 'react';
import {
  Upload, Palette, Eye, EyeOff, Target, Settings, Zap, Scissors, Check,
  Layers, RotateCw, Eraser, Ruler, CircleCheck, Download, Move, Plus,
  Play, ChartColumn, Trash2, Globe,
} from 'lucide-react';
import type { TreeNode } from '../../tree/types';
import { getActions } from '../../tree/actions';
import styles from './ResourceSidebar.module.css';

const ACTION_ICONS: Record<string, any> = {
  upload: Upload, palette: Palette, eye: Eye, eyeOff: EyeOff, target: Target,
  settings: Settings, zap: Zap, scissors: Scissors, check: Check, layers: Layers,
  rotate: RotateCw, eraser: Eraser, ruler: Ruler, checkCircle: CircleCheck,
  download: Download, move: Move, plus: Plus, play: Play, chart: ChartColumn,
  trash: Trash2, globe: Globe,
};

interface Props {
  node: TreeNode;
  x: number;
  y: number;
  onAction: (node: TreeNode, actionKey: string) => void;
  onClose: () => void;
}

export default function TreeContextMenu({ node, x, y, onAction, onClose }: Props) {
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener('click', close);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('click', close); window.removeEventListener('resize', close); };
  }, [onClose]);

  const items = getActions(node.actions || []);
  return (
    <div className={styles.ctx} style={{ left: x, top: y }} onClick={(e) => e.stopPropagation()}>
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
