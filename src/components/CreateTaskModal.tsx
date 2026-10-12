import { useEffect, useRef, useState } from 'react';
import styles from './Modal.module.css';

export interface CreateTaskForm {
  name: string;
  interval: number;
  length: number;
  templateId: string | null;
  sectionType: 'display' | 'compute';
}

interface Props {
  defaultName: string;
  interval: number;
  length: number;
  templates: Array<{ id: string | number; label: string }>;
  selectedTemplateId: string | null;
  bankCount: number;
  onConfirm: (form: CreateTaskForm) => void;
  onCancel: () => void;
}

export default function CreateTaskModal({
  defaultName,
  interval,
  length,
  templates,
  selectedTemplateId,
  bankCount,
  onConfirm,
  onCancel,
}: Props) {
  const [name, setName] = useState(defaultName);
  const [iv, setIv] = useState(interval);
  const [ln, setLn] = useState(length);
  const [tpl, setTpl] = useState<string>(selectedTemplateId ?? '');
  const [stype, setStype] = useState<'display' | 'compute'>('compute');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = () => {
    const n = name.trim();
    if (!n) {
      setError('任务名称不能为空');
      return;
    }
    onConfirm({ name: n, interval: iv, length: ln, templateId: tpl || null, sectionType: stype });
  };

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={`${styles.container} ${styles.containerMedium}`} onClick={(e) => e.stopPropagation()}>
        <h3 className={styles.title}>创建任务</h3>

        <div className={styles.mb15}>
          <label className={styles.label}>任务名称</label>
          <input
            ref={inputRef}
            type="text"
            className={styles.input}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError('');
            }}
            placeholder="请输入任务名称"
          />
          {error && <div className={styles.errorText}>{error}</div>}
        </div>

        <div className={`${styles.grid2} ${styles.mb15}`}>
          <div>
            <label className={styles.label}>断面间距 (m)</label>
            <input
              type="number"
              className={styles.input}
              value={iv}
              min={10}
              step={10}
              onChange={(e) => setIv(Number(e.target.value))}
            />
          </div>
          <div>
            <label className={styles.label}>断面长度 (m)</label>
            <input
              type="number"
              className={styles.input}
              value={ln}
              min={100}
              step={100}
              onChange={(e) => setLn(Number(e.target.value))}
            />
          </div>
        </div>

        <div className={styles.mb15}>
          <label className={styles.label}>断面类型</label>
          <select className={styles.select} value={stype} onChange={(e) => setStype(e.target.value as 'display' | 'compute')}>
            <option value="display">展示断面（精细断面，预览用）</option>
            <option value="compute">计算断面（延长到对岸，用于计算）</option>
          </select>
        </div>

        <div className={styles.mb15}>
          <label className={styles.label}>参数模板</label>
          <select className={styles.select} value={tpl} onChange={(e) => setTpl(e.target.value)}>
            <option value="">（不使用模板）</option>
            {templates.map((t) => (
              <option key={String(t.id)} value={String(t.id)}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.hint}>将加入任务：已选高亮岸段 {bankCount} 条</div>

        <div className={styles.actions}>
          <button className={styles.cancelButton} onClick={onCancel}>
            取消
          </button>
          <button className={styles.primaryButton} onClick={submit}>
            确认
          </button>
        </div>
      </div>
    </div>
  );
}
