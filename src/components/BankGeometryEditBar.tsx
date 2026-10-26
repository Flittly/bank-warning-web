import { AlertTriangle, Check, Pencil, Redo2, Undo2, X } from 'lucide-react';

interface BankGeometryEditBarProps {
  bankId: string;
  bankName: string;
  vertexCount: number;
  /** 折点是否有未保存的改动。没有改动时「保存」应当是禁用的，避免无意义写入。 */
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  saving: boolean;
  /** 引用面：被多少任务 / 断面用着。取不到时为 null，此时不显示影响提示。 */
  usage: { taskCount: number; sectionCount: number } | null;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onCancel: () => void;
}

/**
 * 岸段折点编辑的浮栏。
 *
 * <p>为什么必须有个浮栏而不是「改完自动保存」：岸段是**用户级共享资源**
 * （`banks` 表没有 task_id，全库 195 条在用岸段里有 111 条被 2~40 个任务共用），
 * 一次拖动就会同时改变所有引用它的任务的色带位置。没有「保存」这一步，
 * 用户会在毫不知情的情况下改掉别人的图。
 *
 * <p>影响面（引用任务数）刻意放在标题下面第一行，而且只在 >1 时高亮 ——
 * 只被当前任务使用的岸段是绝大多数，天天报警会让这条提示被无视。
 */
export default function BankGeometryEditBar({
  bankId,
  bankName,
  vertexCount,
  dirty,
  canUndo,
  canRedo,
  saving,
  usage,
  onUndo,
  onRedo,
  onSave,
  onCancel,
}: BankGeometryEditBarProps) {
  const shared = (usage?.taskCount ?? 0) > 1;
  return (
    <div className="bank-edit-bar" data-tour="bank-edit-bar">
      <div className="bank-edit-bar-head">
        <span className="bank-edit-bar-title">
          <Pencil size={14} /> 岸段折点编辑
        </span>
        <span className="bank-edit-bar-name" title={bankId}>
          {bankName || bankId}
        </span>
        <button className="bank-edit-bar-close" onClick={onCancel} title="退出编辑（未保存的改动会丢弃）">
          <X size={14} />
        </button>
      </div>

      <div className="bank-edit-bar-meta">
        折点 <b>{vertexCount}</b>
        {usage && (
          <>
            <span className="bank-edit-bar-dot">·</span>
            引用任务 <b>{usage.taskCount}</b>
            <span className="bank-edit-bar-dot">·</span>
            断面 <b>{usage.sectionCount}</b>
          </>
        )}
        {dirty && <span className="bank-edit-bar-dirty">未保存</span>}
      </div>

      {shared && (
        <div className="bank-edit-bar-warn">
          <AlertTriangle size={13} />
          <span>
            该岸段被 <b>{usage!.taskCount}</b> 个任务共用，保存后它们的色带都会跟着移动到新位置。
          </span>
        </div>
      )}

      <div className="bank-edit-bar-hint">
        拖动折点改位置 · 双击岸线插入折点 · Alt 点击折点删除 · Esc 退出
      </div>

      <div className="bank-edit-bar-actions">
        <button
          className="bank-edit-btn ghost"
          onClick={onUndo}
          disabled={!canUndo || saving}
          title="撤销上一步折点操作"
        >
          <Undo2 size={13} /> 撤销
        </button>
        <button
          className="bank-edit-btn ghost"
          onClick={onRedo}
          disabled={!canRedo || saving}
          title="重做"
        >
          <Redo2 size={13} /> 重做
        </button>
        <span className="bank-edit-bar-spacer" />
        <button className="bank-edit-btn ghost" onClick={onCancel} disabled={saving}>
          取消
        </button>
        <button
          className="bank-edit-btn primary"
          onClick={onSave}
          disabled={!dirty || saving}
          title={dirty ? '保存岸段几何' : '折点没有改动'}
        >
          <Check size={13} /> {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  );
}
