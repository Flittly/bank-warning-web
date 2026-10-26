/**
 * 「框选设为无效断面」的操作面板（任务右键 → 框选设为无效断面）。
 *
 * <p>只做展示与按钮，不算数：命中口径在 `map/sectionBoxInvalid.ts`，批量提交走
 * `services/sectionInvalidApi`（与单条「设为无效断面」同一个接口、同一套服务端语义）。
 *
 * <h3>为什么把「撤销本次」放在面板里，而不是靠浏览器 confirm 的"确认/取消"</h3>
 * 确认框只能撤销"这一次点击"，撤销不了"这次批量操作"。用户框错了范围（比如框到了对岸
 * 另一段岸线）时，需要在**已经看到结果之后**整批回退；而已经提交过的东西没法用确认框
 * 拦。所以这里记录本次真正被改动的那批 id，单独给一个撤销入口 —— 只回退本次改的，
 * 之前手工标过的无效断面不受影响。
 *
 * <h3>为什么命中数在拖拽时就显示</h3>
 * 框选是"先看会删/会藏多少，再决定松不松手"的动作。等松手才报数，用户已经画完了，
 * 只能反复重画。所以 `drawing` 期间面板读的是实时草稿数（每帧由调用方更新）。
 */
import { Check, HelpCircle, SquareDashed, Undo2, X } from 'lucide-react';

import { SECTION_BOX_INVALID_RULE_TEXT } from '../map/sectionBoxInvalid';

interface Props {
  taskName: string;
  /** 正在等用户拖框 */
  drawing: boolean;
  /** 已画定的选区（矩形）是否还在图上 */
  hasSelection: boolean;
  /** 命中条数（drawing 期间是实时草稿数） */
  matchedCount: number;
  /** 命中的里面有多少条此前已经是无效（撤销时不会动它们） */
  alreadyInvalid: number;
  /** 最近一次应用实际生效的条数；0 = 当前这个选区还没应用 */
  appliedCount: number;
  /** 可撤销的条数（本次真正从「有效」改成「无效」的那批）；0 = 没有可撤销的 */
  undoCount: number;
  /** 提交中（按钮置灰，避免连点产生两次批量写） */
  busy: boolean;
  onApply: () => void;
  onUndo: () => void;
  onRedraw: () => void;
  onClose: () => void;
}

export default function SectionBoxInvalidPanel({
  taskName,
  drawing,
  hasSelection,
  matchedCount,
  alreadyInvalid,
  appliedCount,
  undoCount,
  busy,
  onApply,
  onUndo,
  onRedraw,
  onClose,
}: Props) {
  const applied = appliedCount > 0;
  const toMark = Math.max(0, matchedCount - alreadyInvalid);

  return (
    <div className="section-box-invalid-panel" data-tour="section-box-invalid-panel">
      <div className="sbi-head">
        <div className="sbi-title">
          <span>框选设为无效断面</span>
          <span className="sbi-task" title={taskName}>{taskName}</span>
        </div>
        <button type="button" className="sbi-icon-btn" onClick={onClose} title="关闭（不保留选区）">
          <X size={14} />
        </button>
      </div>

      {drawing && (
        <div className="sbi-hint">
          在地图上按住鼠标拖出矩形；Esc / 右键放弃
        </div>
      )}

      {/* 实时草稿数：拖拽过程中就要能看见"现在会藏掉几条" */}
      {drawing && matchedCount > 0 && (
        <div className="sbi-live">
          <b>{matchedCount}</b> 条断面起点在框内
          {alreadyInvalid > 0 && <span className="sbi-sub">（{alreadyInvalid} 条已是无效）</span>}
        </div>
      )}

      {!hasSelection && !drawing && !applied && (
        <div className="sbi-empty">
          还没有选区。点下方「重新框选」，在地图上框出要隐藏的范围。
        </div>
      )}

      {hasSelection && (
        <div className={`sbi-count${matchedCount === 0 ? ' is-zero' : ''}`}>
          <span className="sbi-count-num">{matchedCount}</span>
          <span className="sbi-count-unit">条断面命中</span>
          {alreadyInvalid > 0 && (
            <div className="sbi-count-note">其中 {alreadyInvalid} 条此前已是无效（不会重复改动）</div>
          )}
          {matchedCount === 0 && (
            <div className="sbi-count-note">框内没有断面起点。断面是横跨河道的线，只有岸边那一端落在框里才算选中。</div>
          )}
        </div>
      )}

      {applied && (
        <div className="sbi-done">
          已把 {appliedCount} 条断面设为无效：图上为灰色虚线，不参与统计与导出。
          {undoCount === 0 && matchedCount > 0 && matchedCount === alreadyInvalid && (
            <div className="sbi-count-note">这次选中的断面此前都是无效，因此没有可撤销的改动。</div>
          )}
        </div>
      )}

      <div className="sbi-actions">
        <button
          type="button"
          className="sbi-btn is-primary"
          disabled={busy || drawing || matchedCount === 0 || applied}
          title={
            matchedCount === 0
              ? '框内没有断面起点，先重新框选'
              : applied
                ? (undoCount > 0
                  ? '当前选区已应用；要重做请先「撤销本次」或「重新框选」'
                  : '当前选区已应用：命中的断面此前都已是无效，没有实际改动')
                : '把命中断面一起设为无效（可撤销）'
          }
          onClick={onApply}
        >
          <Check size={12} /> 设为无效{toMark > 0 && !applied ? `（${toMark} 条）` : ''}
        </button>

        <button
          type="button"
          className="sbi-btn"
          disabled={busy || undoCount === 0}
          title={
            undoCount === 0
              ? '暂无可撤销的操作：只有真正从「有效」改为「无效」的断面才会被还原'
              : `把最近一次应用改动的 ${undoCount} 条恢复为有效，并重新进入框选`
          }
          onClick={onUndo}
        >
          <Undo2 size={12} /> 撤销本次
        </button>

        <button type="button" className="sbi-btn" disabled={busy} onClick={onRedraw}>
          <SquareDashed size={12} /> 重新框选
        </button>
      </div>

      <details className="sbi-notes">
        <summary><HelpCircle size={12} /> 判定口径与撤销规则</summary>
        <ul>
          <li><b>{SECTION_BOX_INVALID_RULE_TEXT}</b>（边界包含在内）。</li>
          <li><b>为什么看起点不看整条线</b>：框住一段岸，只想关掉<b>挂在这段岸上</b>的断面。
            若按"线与框相交"判，从框里横穿过去、起点在别处的断面也会被顺手隐藏。</li>
          <li><b>无效 ≠ 删除</b>：结果行原样保留，恢复后颜色与统计立刻回来，不需要重算。</li>
          <li><b>撤销本次</b>只还原这次真正改动的那批；之前手工标过的无效断面不会被放出来。</li>
          <li><b>起点缺失的断面</b>（几何退化）无法被框选命中，请单条点开设置。</li>
          <li><b>报告与导出</b>同样排除无效断面 —— 框掉的不只是图上的颜色。</li>
        </ul>
      </details>
    </div>
  );
}
