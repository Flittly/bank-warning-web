import { useEffect, useRef, useState } from 'react';
import styles from './Modal.module.css';

interface TaskNameModalProps {
  title?: string;
  defaultValue?: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export default function TaskNameModal({
  title = '创建任务',
  defaultValue = '',
  onConfirm,
  onCancel,
}: TaskNameModalProps) {
  const [name, setName] = useState(defaultValue);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleConfirm = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('任务名称不能为空');
      return;
    }
    onConfirm(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div
        className={`${styles.container} ${styles.containerCompact}`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <h3 className={styles.title}>{title}</h3>
        <div className={styles.mb15}>
          <label className={styles.label}>任务名称</label>
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError('');
            }}
            className={styles.input}
            placeholder="请输入任务名称"
          />
          {error && <div className={styles.errorText}>{error}</div>}
        </div>
        <div className={styles.actions}>
          <button onClick={onCancel} className={styles.cancelButton}>
            取消
          </button>
          <button onClick={handleConfirm} className={styles.primaryButton}>
            确认
          </button>
        </div>
      </div>
    </div>
  );
}
