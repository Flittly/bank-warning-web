import styles from './Modal.module.css';

interface ConfirmModalProps {
  title?: string;
  content: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  title = '确认操作',
  content,
  confirmText = '确认',
  cancelText = '取消',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div
        className={`${styles.container} ${styles.containerCompact}`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onConfirm();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
      >
        <h3 className={styles.title}>{title}</h3>
        <div className={`${styles.confirmContent} ${styles.mb15}`}>{content}</div>
        <div className={styles.actions}>
          <button onClick={onCancel} className={styles.cancelButton}>
            {cancelText}
          </button>
          <button onClick={onConfirm} className={danger ? styles.dangerButton : styles.primaryButton}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
