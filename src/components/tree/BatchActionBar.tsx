import { Eye, EyeOff, Trash2, X, Settings, type LucideIcon } from 'lucide-react';
import type { TreeNode } from '../../tree/types';
import { BATCH_ACTIONS, groupSelectedByKind } from '../../tree/batchActions';
import styles from './ResourceSidebar.module.css';

const KIND_LABEL: Record<string, string> = {
  bank: '岸段',
  section: '断面',
  dem: 'DEM',
  task: '任务',
  param: '参数模板',
};

const ACTION_ICONS: Record<string, LucideIcon> = {
  eye: Eye, eyeOff: EyeOff, trash: Trash2,
};

interface Props {
  nodes: TreeNode[];
  onBatchAction: (kind: string, nodes: TreeNode[], actionKey: string) => void;
  onClear: () => void;
}

/**
 * 多选批量操作条：悬浮在资源树上方，选中 ≥2 个（或含批量动作的）节点时出现。
 * 按类型分组展示各自支持的批量动作，避免"混合选择时只给删除"这种一刀切。
 */
export default function BatchActionBar({ nodes, onBatchAction, onClear }: Props) {
  const groups = groupSelectedByKind(nodes);
  const total = nodes.length;
  if (total === 0 || groups.size === 0) return null;

  return (
    <div className={styles.batchBar}>
      <span className={styles.batchCount}>已选 {total} 项</span>
      {[...groups.entries()].map(([kind, list]) => (
        <span key={kind} className={styles.batchGroup}>
          <span className={styles.batchKind}>{KIND_LABEL[kind] || kind}</span>
          {BATCH_ACTIONS[kind].map((a) => {
            const AIcon = ACTION_ICONS[a.icon] || Settings;
            return (
              <button
                key={a.key}
                type="button"
                className={`${styles.batchBtn} ${a.danger ? styles.batchBtnDanger : ''}`}
                title={a.label}
                onClick={() => onBatchAction(kind, list, a.key)}
              >
                <AIcon size={13} /> {a.label}
              </button>
            );
          })}
        </span>
      ))}
      <button type="button" className={styles.batchClear} title="取消选择" onClick={onClear}>
        <X size={13} />
      </button>
    </div>
  );
}
