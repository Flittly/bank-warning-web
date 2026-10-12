import styles from '../Modal.module.css';

export interface InfoGroup {
  heading?: string;
  rows: Array<[string, string]>;
}

interface Props {
  title: string;
  groups: InfoGroup[];
  onClose: () => void;
}

export default function InfoModal({ title, groups, onClose }: Props) {
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={`${styles.container} ${styles.containerMedium}`} onClick={(e) => e.stopPropagation()}>
        <h3 className={styles.title}>{title}</h3>
        {groups.map((g, gi) => (
          <fieldset className={styles.fieldset} key={gi}>
            <legend className={styles.legend}>{g.heading || '信息'}</legend>
            {g.rows.map(([k, v]) => (
              <div className={styles.infoRow} key={k}>
                <span>{k}</span>
                <strong style={{ wordBreak: 'break-all', textAlign: 'right', maxWidth: '62%' }}>{v}</strong>
              </div>
            ))}
          </fieldset>
        ))}
        <div className={styles.actions}>
          <button className={styles.cancelButton} onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
