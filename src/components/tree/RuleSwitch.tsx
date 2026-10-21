import { Lock } from 'lucide-react';
import styles from './RuleSwitch.module.css';

/**
 * 规则行尾的开关。
 *
 * <p>刻意不复用 `ResourceTreeNode` 的「行尾图标」通道：那套通道是 hover 才出现的小图标，
 * 表达的是"对这个对象做一件事"；规则开关表达的是"这条判定现在生效吗"，是**状态**，
 * 必须常驻可见 —— 用户不该靠点一下再点一下来试出当前状态（DEM 范围开关踩过这个坑）。
 */
interface Props {
  checked: boolean;
  /** 锁定态：不渲染开关，只渲染锁 + 文案 */
  locked?: boolean;
  disabled?: boolean;
  title?: string;
  onToggle: () => void;
}

export default function RuleSwitch({ checked, locked, disabled, title, onToggle }: Props) {
  if (locked) {
    return (
      <span className={styles.locked} title={title || '模型必需，不可关闭'}>
        <Lock size={11} />
        <span>固定</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={checked ? '停用该规则' : '启用该规则'}
      title={title || (checked ? '点击停用' : '点击启用')}
      disabled={disabled}
      className={`${styles.switch} ${checked ? styles.on : ''}`}
      onClick={(e) => {
        // 规则行不可选中、也没有展开态，但点击仍会冒泡到树行（触发 onSelect）。
        // 开关是独立控件，必须自己把事件截住，否则会顺带把整行高亮/滚动定位一次。
        e.stopPropagation();
        onToggle();
      }}
    >
      <span className={styles.knob} />
    </button>
  );
}
