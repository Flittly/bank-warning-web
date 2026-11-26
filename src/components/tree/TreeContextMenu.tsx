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
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  // 打开前的焦点（通常是树里那一行）。菜单关闭后必须还回去，
  // 否则键盘用户的焦点会掉到 body 上，等于被踢出了树。
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // 打开即聚焦第一项：Shift+F10 之后如果焦点还留在行上，按 ↓ 会移动树而不是菜单
    itemRefs.current[0]?.focus();
    return () => {
      restoreRef.current?.focus?.({ preventScroll: true });
    };
  }, []);

  const focusItem = (index: number) => {
    const list = itemRefs.current.filter(Boolean) as HTMLDivElement[];
    if (list.length === 0) return;
    const next = (index + list.length) % list.length;
    list[next].focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const list = itemRefs.current.filter(Boolean) as HTMLDivElement[];
    const current = list.indexOf(document.activeElement as HTMLDivElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusItem(current + 1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusItem(current - 1);
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      focusItem(0);
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      focusItem(list.length - 1);
      return;
    }
    if (e.key === 'Tab') {
      // 菜单是模态浮层，Tab 不应该把焦点带到背后的树上
      e.preventDefault();
      onClose();
    }
  };

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
    <div
      ref={ref}
      className={styles.ctx}
      style={{ left: x, top: y }}
      role="menu"
      aria-label="节点操作"
      onKeyDown={handleKeyDown}
    >
      {items.map((a, i) => {
        const AIcon = ACTION_ICONS[a.icon] || Settings;
        return (
          <div key={a.key}>
            {a.separatorBefore && <div className={styles.ctxSep} role="separator" />}
            <div
              ref={(el) => { itemRefs.current[i] = el; }}
              className={`${styles.ctxItem} ${a.danger ? styles.ctxDanger : ''}`}
              role="menuitem"
              tabIndex={-1}
              onClick={() => { onAction(node, a.key); onClose(); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onAction(node, a.key);
                  onClose();
                }
              }}
            >
              <AIcon size={13} /> {a.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}
