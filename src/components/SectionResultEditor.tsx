import { useEffect, useMemo, useState } from 'react';
import { formatCellValue } from '../utils/indicatorDisplay';
import {
  ENUM_TIER_OPTIONS,
  RISK_COLORS,
  RISK_INDICATOR_KEYS,
  RISK_LABELS,
  RISK_MATRIX_GROUPS,
  computeRisk,
  formatEditableValue,
  type IndicatorValue,
  type RiskIndicatorKey,
} from '../utils/riskScoring';
import { revertSectionResultOverride, saveSectionResultOverride } from '../services/resultOverrideApi';

type Props = {
  sectionId: string;
  taskId: string | null;
  /** 弹窗当前展示的这条结果（已铺平：含 id / raw_values / thresholds / matrices / result / edited）。 */
  detail: any;
  onSaved: (result: any) => void;
  onReverted: (result: any) => void;
  onCancel: () => void;
};

const buildDraft = (detail: any): Record<string, string> => {
  const raw = detail?.raw_values ?? {};
  const draft: Record<string, string> = {};
  RISK_INDICATOR_KEYS.forEach(key => {
    draft[key] = formatEditableValue(raw?.[key]);
  });
  return draft;
};

/**
 * 单断面结果编辑。
 *
 * 只允许改 9 个指标的原始数值；档位、风险值、风险等级都由 `computeRisk()` 现算。
 * 这是刻意的：等级若能手填，就会与数值脱钩，出图与报告两套口径必然打架。
 *
 * ## 两种模式
 * `detail.id == null`（后端返回 `not_computed`）时是**新建**：该断面一条结果都没有，
 * 这张空表就是它的录入入口，保存会 INSERT 一行人工结果。此时：
 *   - 「原值」全是空，`original.riskValue` 为 null，底部对比只显示箭头右侧；
 *   - 9 个指标必须全部填完才能保存（少一个，综合风险值就无从谈起）；
 *   - 撤销按钮的语义是「删掉这条人工结果」，不是「恢复模型原值」。
 */
export default function SectionResultEditor({ sectionId, taskId, detail, onSaved, onReverted, onCancel }: Props) {
  const detailId = detail?.id ?? null;
  const isNew = detailId === null;
  const isEdited = Boolean(detail?.edited ?? detail?.manual_override?.edited);
  /** 这一行本来就是人工新建的 ⇒ 撤销 = 删除，没有「模型原值」可恢复。 */
  const isCreatedManual = Boolean(detail?.manual_override?.created_manual ?? detail?.created_manual);

  const [draft, setDraft] = useState<Record<string, string>>(() => buildDraft(detail));
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(buildDraft(detail));
    setNote('');
    setError(null);
    setSaving(false);
    setReverting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailId]);

  const originalValues = useMemo(() => detail?.raw_values ?? {}, [detail]);

  const parsedValues = useMemo(() => {
    const out: Record<string, IndicatorValue> = {};
    RISK_INDICATOR_KEYS.forEach((key: RiskIndicatorKey) => {
      const text = String(draft[key] ?? '').trim();
      if (key === 'PL' || key === 'LC') {
        out[key] = text === '' ? null : text;
      } else {
        out[key] = text === '' ? null : Number(text);
      }
    });
    return out;
  }, [draft]);

  const preview = useMemo(() => computeRisk(detail, parsedValues), [detail, parsedValues]);
  const original = useMemo(() => computeRisk(detail), [detail]);

  const dirtyKeys = useMemo(
    () => RISK_INDICATOR_KEYS.filter(key => String(draft[key] ?? '') !== formatEditableValue(originalValues?.[key])),
    [draft, originalValues],
  );

  const invalidKeys = useMemo(() => {
    const bad = new Set<string>(preview.unresolved as string[]);
    RISK_INDICATOR_KEYS.forEach(key => {
      const text = String(draft[key] ?? '').trim();
      if (key === 'PL' || key === 'LC') return;
      if (text !== '' && !Number.isFinite(Number(text))) bad.add(key);
    });
    return bad;
  }, [preview.unresolved, draft]);

  const canSave = dirtyKeys.length > 0 && preview.riskLevel !== null && invalidKeys.size === 0 && !saving && !reverting;

  const levelChanged = original.level !== null && preview.level !== null && original.level !== preview.level;

  const setValue = (key: RiskIndicatorKey, value: string) => {
    setDraft(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    if (!canSave || preview.riskValue === null || preview.riskLevel === null) return;
    // 未改动的指标原样回传原始数值：避免把 1.5200000000000002 这类浮点噪声按显示精度截断后写回。
    const rawForSave: Record<string, IndicatorValue> = {};
    RISK_INDICATOR_KEYS.forEach(key => {
      rawForSave[key] = dirtyKeys.includes(key)
        ? (parsedValues[key] as IndicatorValue)
        : ((originalValues?.[key] ?? null) as IndicatorValue);
    });

    setSaving(true);
    setError(null);
    try {
      const saved = await saveSectionResultOverride({
        sectionId,
        taskId,
        resultId: typeof detail?.id === 'number' ? detail.id : null,
        note: note.trim(),
        patch: {
          raw_values: rawForSave as Record<string, number | string | null>,
          matrices: preview.matrices,
          result: preview.riskValue,
          risk_level: preview.riskLevel,
        },
      });
      onSaved(saved);
    } catch (err: any) {
      setError(err?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleRevert = async () => {
    const message = isCreatedManual
      ? '撤销人工录入？这条结果会被删除，该断面回到「无数据」状态（图上显示为灰色虚线）。'
      : '恢复模型原始结果？人工修改的内容与备注会被清除。';
    if (!window.confirm(message)) return;
    setReverting(true);
    setError(null);
    try {
      const restored = await revertSectionResultOverride(sectionId, taskId);
      onReverted(restored);
    } catch (err: any) {
      setError(err?.message || '恢复失败');
    } finally {
      setReverting(false);
    }
  };

  return (
    <div className="result-editor">
      <div className="result-editor-banner">
        <span className="result-editor-banner-title">{isNew || isCreatedManual ? '人工录入' : '人工修改'}</span>
        <span className="result-editor-banner-text">
          {isNew || isCreatedManual
            ? '该断面暂无计算结果。填完 9 个指标即可人工评定：档位与风险等级由系统按阈值算，保存后立即上色，不需要重跑模型。'
            : '只改数值，档位与风险等级由系统按阈值重算；保存后立即生效，不需要重跑模型。'}
        </span>
      </div>

      {(isNew || isCreatedManual) && (
        <div className="result-editor-hint">
          {detail?.not_computed_reason
            ? `${detail.not_computed_reason}。`
            : '该断面没有模型算出的结果，这一行完全是人工录入的。'}
          {' '}9 项必须全部有值（或选择枚举），少一项就无法得到综合风险值。
        </div>
      )}

      {preview.params.fellBack.length > 0 && (
        <div className="result-editor-hint warn">
          {isNew || isCreatedManual
            ? `该任务没有可参照的参数快照（${preview.params.fellBack.join('、')}），将按系统默认阈值/权重判定。`
            : `该结果未记录完整参数（${preview.params.fellBack.join('、')}），已按默认阈值/权重判定。`}
        </div>
      )}

      {RISK_MATRIX_GROUPS.map((group, groupIdx) => {
        const weights = preview.params[group.weightKey];
        return (
          <div className="result-editor-group" key={group.title}>
            <div className="result-editor-group-head">
              <span className="result-editor-group-title">{group.title}</span>
              <span className="result-editor-group-weight">
                准则权重 {formatCellValue(preview.params.wRL[groupIdx])}
              </span>
            </div>
            <table className="result-editor-table">
              <thead>
                <tr>
                  <th>指标</th>
                  <th>当前值</th>
                  <th>风险阈值</th>
                  <th>档位</th>
                  <th>权重</th>
                </tr>
              </thead>
              <tbody>
                {group.indicatorKeys.map(({ key, label }, idx) => {
                  const originalTier = original.tiers[key];
                  const nextTier = preview.tiers[key];
                  const tierChanged = nextTier !== null && originalTier !== null && nextTier !== originalTier;
                  const isEnum = key === 'PL' || key === 'LC';
                  const invalid = invalidKeys.has(key);
                  const thresholds = preview.params.sub[key];

                  return (
                    <tr key={key} className={tierChanged ? 'tier-changed' : undefined}>
                      <th scope="row">{label}</th>
                      <td>
                        {isEnum ? (
                          <select
                            className="result-editor-select"
                            value={String(draft[key] ?? '')}
                            onChange={e => setValue(key, e.target.value)}
                          >
                            <option value="">未记录</option>
                            {ENUM_TIER_OPTIONS[key as 'PL' | 'LC'].map(option => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            inputMode="decimal"
                            className={`result-editor-input${invalid ? ' invalid' : ''}`}
                            value={String(draft[key] ?? '')}
                            onChange={e => setValue(key, e.target.value)}
                          />
                        )}
                      </td>
                      <td className="result-editor-threshold">
                        {isEnum ? '—' : thresholds.map(v => formatCellValue(v)).join(' / ')}
                      </td>
                      <td className="result-editor-tier">
                        {/* 新建模式下没有「原档位」可对比，直接显示现算档位 ——
                            否则这一列整片是「—」，用户看不到自己填的值落在第几档。 */}
                        {isNew ? (
                          nextTier === null ? '—' : nextTier
                        ) : (
                          <>
                            {originalTier ?? '—'}
                            {tierChanged ? <span className="result-editor-tier-arrow"> → {nextTier}</span> : null}
                          </>
                        )}
                      </td>
                      <td>{formatCellValue(weights[idx])}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}

      {invalidKeys.size > 0 && (
        <div className="result-editor-hint error">
          {isNew || isCreatedManual
            ? `还需填写 ${invalidKeys.size} 项：${Array.from(invalidKeys).join('、')}。未填报不会被当作最低风险，也无法保存。`
            : `${Array.from(invalidKeys).join('、')} 无法判定档位：请填写有效数值/选择枚举，未填报不会被当作最低风险。`}
        </div>
      )}
      {invalidKeys.size === 0 && dirtyKeys.length > 0 && !levelChanged && preview.riskLevel !== null && (
        <div className="result-editor-hint">
          修改后的指标仍处在同一档位，风险值与风险等级不变。
        </div>
      )}

      <div className="result-editor-footer">
        <div className="result-editor-delta">
          <div className="result-editor-delta-row">
            <span>风险值</span>
            <strong>{original.riskValue === null ? '—' : original.riskValue.toFixed(4)}</strong>
            <span className="result-editor-delta-arrow">→</span>
            <strong>{preview.riskValue === null ? '—' : preview.riskValue.toFixed(4)}</strong>
          </div>
          <div className="result-editor-delta-row">
            <span>风险等级</span>
            {original.level === null ? (
              <strong>—</strong>
            ) : (
              <span className="result-editor-level" style={{ color: RISK_COLORS[String(original.level)] }}>
                {RISK_LABELS[original.level]}
              </span>
            )}
            <span className="result-editor-delta-arrow">→</span>
            {preview.level === null ? (
              <strong>—</strong>
            ) : (
              <span className="result-editor-level" style={{ color: RISK_COLORS[String(preview.level)] }}>
                {RISK_LABELS[preview.level]}
              </span>
            )}
          </div>
          {levelChanged && (
            <div className="result-editor-hint">
              保存后该断面颜色与所属岸段色带会一起更新，不需要重新加载任务。
            </div>
          )}
        </div>

        <div className="result-editor-actions">
          <input
            type="text"
            className="result-editor-note"
            placeholder="修改原因（选填，≤200 字）"
            maxLength={200}
            value={note}
            onChange={e => setNote(e.target.value)}
          />
          {isEdited && (
            <button type="button" className="result-editor-btn ghost" onClick={handleRevert} disabled={saving || reverting}>
              {reverting ? '撤销中…' : (isCreatedManual ? '撤销人工录入' : '恢复模型原值')}
            </button>
          )}
          <button type="button" className="result-editor-btn ghost" onClick={onCancel} disabled={saving || reverting}>
            取消
          </button>
          <button type="button" className="result-editor-btn primary" onClick={handleSave} disabled={!canSave}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>

      {error && <div className="result-editor-hint error">{error}</div>}
    </div>
  );
}
