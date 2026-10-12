import { Upload, Plus, Eraser, Eye, EyeOff } from 'lucide-react';
import styles from './ResourceSidebar.module.css';

interface Props {
  onUploadBank: () => void;
  onUploadSections: () => void;
  onNewTask: () => void;
  onClear: () => void;
  showCrossLines: boolean;
  onToggleCrossLines: () => void;
}

export default function TreeToolbar({
  onUploadBank, onUploadSections, onNewTask, onClear, showCrossLines, onToggleCrossLines,
}: Props) {
  return (
    <div className={styles.toolbar}>
      <button type="button" className={styles.tb} onClick={onUploadBank} title="上传岸段">
        <Upload size={13} /> 上传岸段
      </button>
      <button type="button" className={styles.tb} onClick={onUploadSections} title="上传断面">
        <Upload size={13} /> 上传断面
      </button>
      <button type="button" className={`${styles.tb} ${styles.tbPrimary}`} onClick={onNewTask} title="新建任务">
        <Plus size={13} /> 新建任务
      </button>
      <button type="button" className={styles.tb} onClick={onToggleCrossLines} title="显示/隐藏设计">
        {showCrossLines ? <EyeOff size={13} /> : <Eye size={13} />}
      </button>
      <button type="button" className={styles.tb} onClick={onClear} title="清空">
        <Eraser size={13} />
      </button>
    </div>
  );
}
