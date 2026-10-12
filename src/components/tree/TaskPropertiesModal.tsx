import styles from '../Modal.module.css';

interface Props {
  task: any;
  onClose: () => void;
}

const fmtTime = (v: any): string => {
  if (!v) return '-';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('zh-CN', { hour12: false });
};

export default function TaskPropertiesModal({ task, onClose }: Props) {
  const bankCount = Array.isArray(task?.bank_ids) ? task.bank_ids.length : 0;
  const rows: Array<[string, string]> = [
    ['任务名称', task?.task_name || '-'],
    ['任务 ID', task?.task_id || '-'],
    ['状态', task?.status || '-'],
    ['岸段数量', `${bankCount} 条`],
    ['描述', task?.description || '-'],
    ['创建时间', fmtTime(task?.created_at)],
    ['更新时间', fmtTime(task?.updated_at)],
    ['开始运行', fmtTime(task?.run_started_at)],
    ['完成运行', fmtTime(task?.run_completed_at)],
  ];

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={`${styles.container} ${styles.containerMedium}`} onClick={(e) => e.stopPropagation()}>
        <h3 className={styles.title}>任务属性</h3>

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>基本信息</legend>
          {rows.map(([k, v]) => (
            <div className={styles.infoRow} key={k}>
              <span>{k}</span>
              <strong style={{ wordBreak: 'break-all', textAlign: 'right', maxWidth: '62%' }}>{v}</strong>
            </div>
          ))}
        </fieldset>

        <div className={styles.actions}>
          <button className={styles.cancelButton} onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
