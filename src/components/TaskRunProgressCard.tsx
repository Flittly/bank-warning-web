import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Loader2, OctagonX, X } from 'lucide-react';
import {
  formatElapsed,
  percentOf,
  type TaskRunSnapshot,
} from '../pages/editor/taskRunProgress';
import styles from './TaskRunProgressCard.module.css';

interface Props {
  snapshot: TaskRunSnapshot;
  /** 点「终止」：交给编辑器统一实现（带确认弹窗 + 状态提示） */
  onStop?: () => Promise<boolean> | void;
  onViewResult: () => void;
  onDismiss: () => void;
}

const PHASE_TEXT: Record<TaskRunSnapshot['phase'], string> = {
  running: '正在计算',
  completed: '计算完成',
  cancelled: '已终止',
  failed: '未执行',
};

/**
 * 编辑器里的运行进度卡：贴在「执行风险分析」按钮下面。
 *
 * <p>它只回答三个问题 —— 算到第几条了、有没有失败、算完去哪看。完整的断面结果
 * 与风险分级留给任务列表/结果页，这里不重复展示，否则侧栏会被结果淹没。
 */
export default function TaskRunProgressCard({ snapshot, onStop, onViewResult, onDismiss }: Props) {
  const [openErrors, setOpenErrors] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const running = snapshot.phase === 'running';
  const pct = percentOf(snapshot.done, snapshot.total);

  // 用时每秒走一格；算完就停，别让一个静态卡片还在耗着定时器。
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [running]);

  // 任务一旦收尾，「终止中…」这个中间态就该退场（成功、失败、被终止都一样）
  useEffect(() => {
    if (!running) setStopping(false);
  }, [running]);

  const elapsed = useMemo(() => {
    const end = running ? now : snapshot.updatedAt;
    return formatElapsed(end - snapshot.startedAt);
  }, [running, now, snapshot.updatedAt, snapshot.startedAt]);

  const handleStop = async () => {
    if (!onStop) return;
    const accepted = await onStop();
    if (accepted !== false) setStopping(true);
  };

  return (
    <div className={styles.card} data-phase={snapshot.phase} data-tour="run-progress">
      <div className={styles.head}>
        <span className={styles.dot} aria-hidden />
        <span className={styles.title}>
          {stopping && running ? '正在停止…' : PHASE_TEXT[snapshot.phase]}
        </span>
        <span className={styles.count}>
          {snapshot.done}/{snapshot.total > 0 ? snapshot.total : '?'}
        </span>
        <button type="button" className={styles.close} onClick={onDismiss} title="收起进度" aria-label="收起进度">
          <X size={12} />
        </button>
      </div>

      <div className={styles.track}>
        {pct === null ? (
          <div className={styles.indeterminate} />
        ) : (
          <div className={styles.fill} style={{ width: `${pct}%` }} />
        )}
      </div>

      <div className={styles.meta}>
        <span className={styles.ok}>
          {snapshot.phase === 'completed' ? <CheckCircle2 size={11} /> : null}
          成功 {snapshot.success}
        </span>
        {snapshot.errorCount > 0 && (
          <button
            type="button"
            className={styles.bad}
            onClick={() => setOpenErrors((v) => !v)}
            title="展开失败明细"
          >
            <OctagonX size={11} /> 失败 {snapshot.errorCount}
            {openErrors ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
        )}
        <span className={styles.elapsed}>{elapsed}</span>
      </div>

      {running && snapshot.success > 0 && (
        <div className={styles.paintHint}>地图上已按结果上色 {snapshot.success} 条断面</div>
      )}

      {openErrors && snapshot.errors.length > 0 && (
        <div className={styles.errors}>
          {snapshot.errors.map((e, i) => (
            <div className={styles.errorRow} key={`${e.sectionId}-${i}`} title={e.message}>
              <span className={styles.errorName}>{e.sectionName || e.sectionId || '运行请求'}</span>
              <span className={styles.errorMsg}>{e.message}</span>
            </div>
          ))}
        </div>
      )}

      <div className={styles.actions}>
        {running ? (
          <button
            type="button"
            className={styles.stop}
            onClick={() => { void handleStop(); }}
            disabled={stopping || !onStop}
          >
            {stopping ? <><Loader2 size={11} className={styles.spin} /> 等待当前断面算完</> : '终止'}
          </button>
        ) : (
          <button type="button" className={styles.primary} onClick={onViewResult}>
            去任务列表看结果 →
          </button>
        )}
      </div>
    </div>
  );
}
