import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
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

/**
 * 危险/不可逆操作的确认框。
 *
 * 三条曾经的误触路径，已逐个堵掉：
 * 1. 遮罩上一按就取消 —— 危险操作里点空白 = 把"确认"变成"随手关掉"；
 *    现在只有非危险场景才允许点遮罩取消。
 * 2. 任意 `Enter` 即确认 —— content 允许放输入框，用户打字回车会直接提交；
 *    现在 Enter 只在"焦点不在可输入元素上"时生效。
 * 3. 打开时不抢焦点、Esc 关不掉 —— 现在挂载即聚焦"取消"，焦点在框内循环。
 */
export default function ConfirmModal({
  title = '确认操作',
  content,
  confirmText = '确认',
  cancelText = '取消',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const titleId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  // 挂载即把焦点收进弹窗：默认落在"取消"上，危险操作不会被一次回车带走。
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  // 焦点陷阱：Tab 在弹窗内循环，不跑到背后的页面上。
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
      return;
    }
    if (e.key === 'Enter') {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      const editable = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable;
      if (!editable) {
        e.preventDefault();
        onConfirm();
      }
      return;
    }
    if (e.key !== 'Tab') return;
    const focusables = containerRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (!focusables || focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      className={styles.overlay}
      onClick={danger ? undefined : onCancel}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={containerRef}
        className={`${styles.container} ${styles.containerCompact}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id={titleId} className={styles.title}>
          {title}
        </h3>
        <div className={`${styles.confirmContent} ${styles.mb15}`}>{content}</div>
        <div className={styles.actions}>
          <button ref={cancelRef} onClick={onCancel} className={styles.cancelButton}>
            {cancelText}
          </button>
          <button onClick={onConfirm} className={danger ? styles.dangerButton : styles.primaryButton}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
