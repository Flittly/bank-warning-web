import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './Modal.module.css';

/**
 * 「给已有任务补充岸段」弹窗。
 *
 * <p>入口在资源树的任务节点（右键 → 补充岸段…）。与「创建任务」的区别只有一点：
 * 这里**不会新建任务**，只在选定任务上追加岸段与断面，已有断面与其结果一条都不动。
 *
 * <p>候选清单在打开时就由调用方算好（全库岸段 − 该任务已有岸段）。
 * 没有候选时不做"空弹窗"，直接给一句明确的结论 ——
 * 否则用户会以为是加载失败，反复点。
 */

export interface AddBanksForm {
  bankIds: string[];
  interval: number;
  length: number;
  sectionType: 'display' | 'compute';
  /** 追加后立即只算新增断面（不动已有结果） */
  runNow: boolean;
}

interface Props {
  taskId: string;
  taskName: string;
  /** 该任务还没有的岸段（已由调用方过滤） */
  candidates: Array<Record<string, any>>;
  /** 该任务已有断面数，用于说明"补充不会动到它们" */
  existingSectionCount: number;
  /** 该任务已关联的岸段数 */
  existingBankCount: number;
  defaultInterval: number;
  defaultLength: number;
  onConfirm: (form: AddBanksForm) => void;
  onCancel: () => void;
}

export default function AddBanksToTaskModal({
  taskId,
  taskName,
  candidates,
  existingSectionCount,
  existingBankCount,
  defaultInterval,
  defaultLength,
  onConfirm,
  onCancel,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [interval, setInterval] = useState(defaultInterval);
  const [length, setLength] = useState(defaultLength);
  const [stype, setStype] = useState<'display' | 'compute'>('compute');
  const [runNow, setRunNow] = useState(true);
  const [error, setError] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const bankIdOf = (b: Record<string, any>) => String(b?.bank_id ?? '').trim();

  // 按 region_code 分组：库里岸段上百条，平铺成一列根本找不到东西
  const groups = useMemo(() => {
    const kw = query.trim().toLowerCase();
    const map = new Map<string, Array<Record<string, any>>>();
    for (const b of candidates) {
      const bid = bankIdOf(b);
      if (!bid) continue;
      const name = String(b?.bank_name ?? b?.bankName ?? '');
      if (kw && !bid.toLowerCase().includes(kw) && !name.toLowerCase().includes(kw)) continue;
      const rc = String(b?.region_code || '未分组');
      if (!map.has(rc)) map.set(rc, []);
      map.get(rc)!.push(b);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [candidates, query]);

  const visibleIds = useMemo(
    () => groups.flatMap(([, list]) => list.map(bankIdOf)).filter(Boolean),
    [groups],
  );

  const toggle = (bid: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(bid)) next.delete(bid);
      else next.add(bid);
      return next;
    });
    if (error) setError('');
  };

  const toggleGroup = (list: Array<Record<string, any>>) => {
    const ids = list.map(bankIdOf).filter(Boolean);
    const allOn = ids.length > 0 && ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (allOn) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const submit = () => {
    const bankIds = [...selected];
    if (bankIds.length === 0) {
      setError('请至少选择一条要补充的岸段');
      return;
    }
    if (!Number.isFinite(interval) || interval < 10) {
      setError('断面间距不能小于 10 米');
      return;
    }
    if (!Number.isFinite(length) || length < 100) {
      setError('断面长度不能小于 100 米');
      return;
    }
    onConfirm({ bankIds, interval, length, sectionType: stype, runNow });
  };

  const hasCandidates = candidates.length > 0;

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div
        className={`${styles.container} ${styles.containerMedium}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className={styles.title}>补充岸段 · {taskName || taskId}</h3>

        <div className={styles.hint} style={{ marginBottom: 12 }}>
          该任务已有 <b>{existingBankCount}</b> 条岸段、<b>{existingSectionCount}</b> 条断面。
          本次只<b>追加</b>岸段与断面，已有断面及其计算结果不会被修改或删除。
        </div>

        {hasCandidates ? (
          <>
            <div className={styles.inputRow} style={{ marginBottom: 8 }}>
              <input
                ref={searchRef}
                type="text"
                className={styles.input}
                value={query}
                placeholder="按岸段名称或 bank_id 过滤…"
                onChange={(e) => setQuery(e.target.value)}
              />
              <button
                type="button"
                className={styles.smallButton}
                onClick={() =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    const allOn = visibleIds.length > 0 && visibleIds.every((id) => next.has(id));
                    for (const id of visibleIds) {
                      if (allOn) next.delete(id);
                      else next.add(id);
                    }
                    return next;
                  })
                }
                title="对当前过滤结果全选 / 取消"
              >
                {visibleIds.length > 0 && visibleIds.every((id) => selected.has(id)) ? '取消全选' : '全选'}
              </button>
            </div>

            <div className={styles.bankPickList}>
              {groups.map(([region, list]) => {
                const ids = list.map(bankIdOf).filter(Boolean);
                const allOn = ids.length > 0 && ids.every((id) => selected.has(id));
                return (
                  <div key={region} className={styles.bankPickGroup}>
                    <label className={styles.bankPickGroupHeader}>
                      <input type="checkbox" checked={allOn} onChange={() => toggleGroup(list)} />
                      <span>{region}</span>
                      <span className={styles.bankPickCount}>{ids.length} 条</span>
                    </label>
                    {list.map((b) => {
                      const bid = bankIdOf(b);
                      const name = String(b?.bank_name ?? b?.bankName ?? bid);
                      const reversed = b?.reversed === true || b?.reversed === 'true';
                      return (
                        <label key={bid} className={styles.bankCheck}>
                          <input
                            type="checkbox"
                            checked={selected.has(bid)}
                            onChange={() => toggle(bid)}
                          />
                          <span className={styles.bankCheckName}>{name}</span>
                          <span className={styles.bankCheckId}>{bid}</span>
                          {reversed && <span className={styles.bankCheckFlag}>反向</span>}
                        </label>
                      );
                    })}
                  </div>
                );
              })}
              {groups.length === 0 && (
                <div className={styles.hint}>没有匹配的岸段，换个关键词试试。</div>
              )}
            </div>
          </>
        ) : (
          <div className={styles.hint} style={{ marginBottom: 12 }}>
            库里的岸段已经全部在该任务中，没有可补充的岸段。
          </div>
        )}

        <div className={`${styles.grid2} ${styles.mb15}`} style={{ marginTop: 14 }}>
          <div>
            <label className={styles.label}>断面间距 (m)</label>
            <input
              type="number"
              className={styles.input}
              value={interval}
              min={10}
              step={10}
              onChange={(e) => setInterval(Number(e.target.value))}
            />
          </div>
          <div>
            <label className={styles.label}>断面长度 (m)</label>
            <input
              type="number"
              className={styles.input}
              value={length}
              min={100}
              step={100}
              onChange={(e) => setLength(Number(e.target.value))}
            />
          </div>
        </div>

        <div className={styles.mb15}>
          <label className={styles.label}>断面类型</label>
          <select
            className={styles.select}
            value={stype}
            onChange={(e) => setStype(e.target.value as 'display' | 'compute')}
          >
            <option value="compute">计算断面（延长到对岸，用于计算）</option>
            <option value="display">展示断面（精细断面，预览用）</option>
          </select>
        </div>

        <label className={styles.checkRow}>
          <input type="checkbox" checked={runNow} onChange={(e) => setRunNow(e.target.checked)} />
          追加后立即计算这批新断面（只算本次生成的，不重算任务里其他断面）
        </label>
        {!runNow && (
          <div className={styles.hint}>
            不勾选时只补岸段与断面、不算结果。结果页对「没有风险值」的岸段按透明处理，
            新岸段要等计算完成才会着色（可稍后右键任务 →「只算未计算断面」）。
          </div>
        )}

        {error && <div className={styles.errorText}>{error}</div>}

        <div className={styles.actions} style={{ marginTop: 12 }}>
          <button className={styles.cancelButton} onClick={onCancel}>
            取消
          </button>
          <button
            className={styles.primaryButton}
            onClick={submit}
            disabled={!hasCandidates || selected.size === 0}
          >
            补充 {selected.size > 0 ? `${selected.size} 条岸段` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
