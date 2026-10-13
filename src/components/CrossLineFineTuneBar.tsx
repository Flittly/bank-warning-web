import {
  Layout,
  Move,
  MoveHorizontal,
  Plus,
  RotateCw,
  Settings,
  Trash2,
  X,
} from 'lucide-react';
import styles from './EditorSidebar.module.css';

interface CrossLineFineTuneBarProps {
  crossLineControlMode: 'shoreline' | 'free';
  setCrossLineControlMode: (mode: 'shoreline' | 'free') => void;
  crossLineEditMode: 'none' | 'select' | 'add';
  setCrossLineEditMode: (mode: 'none' | 'select' | 'add') => void;
  selectedCrossLineIndex: number | null;
  onExit: () => void;
  translateSelectedCrossLine: (offsetMeters: number) => void;
  rotateSelectedCrossLine: (angleDegrees: number) => void;
  scaleSelectedCrossLine: (deltaMeters: number) => void;
  configureSelectedCrossLineProperties: () => void;
  deleteSelectedCrossLine: () => void;
  reverseSelectedCrossLine: () => void;
}

/**
 * 地图左下角的「断面精细调整」浮栏 —— 只在**资源树侧栏**模式下渲染。
 *
 * 为什么需要它：资源树是默认侧栏（useEditorStore 的 sidebarMode 默认 'tree'），
 * 而 EditorPage 里 `{sidebarMode === 'classic' && <EditorSidebar …/>}` ——
 * 也就是说精调那批操作（沿线约束 / 自由拖动 / 按垂线生成 / 自由创建 / 平移 / 旋转 / 缩放 / 反切）
 * 只写在 EditorSidebar 里，默认模式下**整块都不渲染**。
 * 结果：树里右键「进入精细调整」确实把 isSelectingCrossLines 置为 true（地图进入编辑态），
 * 但屏幕上没有任何控件可选工具（crossLineEditMode 停在 'none'，点地图自然"没反应"）。
 *
 * 这里把那批操作原样搬到地图上；样式直接复用 EditorSidebar.module.css，
 * 与经典面板里的观感保持一致，不引入第二套按钮样式。
 */
export default function CrossLineFineTuneBar({
  crossLineControlMode,
  setCrossLineControlMode,
  crossLineEditMode,
  setCrossLineEditMode,
  selectedCrossLineIndex,
  onExit,
  translateSelectedCrossLine,
  rotateSelectedCrossLine,
  scaleSelectedCrossLine,
  configureSelectedCrossLineProperties,
  deleteSelectedCrossLine,
  reverseSelectedCrossLine,
}: CrossLineFineTuneBarProps) {
  return (
    <div className="editor-finetune-bar">
      <div className="eft-header">
        <span className="eft-title">
          <Layout size={14} /> 断面精细调整
        </span>
        <button
          type="button"
          className="eft-close"
          onClick={onExit}
          title="退出精调"
          aria-label="退出精调"
        >
          <X size={15} />
        </button>
      </div>

      {/* 进入精调时 editMode 是 'none'（避免误触），此时点地图不会有任何动作。
          给一句提示，免得用户以为"点了没反应"。 */}
      {crossLineEditMode === 'none' && (
        <p className="eft-hint">先选一个工具，再在地图上操作断面。</p>
      )}

      <span className={styles.modeLabel}>调整已有断面</span>
      <div className={styles.buttonGrid}>
        <button
          type="button"
          className={`${styles.outlineButton} ${crossLineEditMode === 'select' && crossLineControlMode === 'shoreline' ? styles.active : ''}`}
          onClick={() => { setCrossLineEditMode('select'); setCrossLineControlMode('shoreline'); }}
          title="沿线约束：选中断面后沿岸段线平移，保持垂直"
          aria-label="沿线约束调整"
        >
          <MoveHorizontal size={14} /> 沿线约束
        </button>
        <button
          type="button"
          className={`${styles.outlineButton} ${crossLineEditMode === 'select' && crossLineControlMode === 'free' ? styles.active : ''}`}
          onClick={() => { setCrossLineEditMode('select'); setCrossLineControlMode('free'); }}
          title="自由拖动：选中断面后可拖拽移动、旋转、缩放"
          aria-label="自由拖动调整"
        >
          <Move size={14} /> 自由拖动
        </button>
      </div>

      <span className={styles.modeLabel}>新建断面</span>
      <div className={styles.buttonGrid}>
        <button
          type="button"
          className={`${styles.outlineButton} ${crossLineEditMode === 'add' && crossLineControlMode === 'shoreline' ? styles.active : ''}`}
          onClick={() => { setCrossLineEditMode('add'); setCrossLineControlMode('shoreline'); }}
          title="按垂线生成：点击岸段线，在点击位置生成垂直断面"
          aria-label="按垂线生成断面"
        >
          <Plus size={14} /> 按垂线生成
        </button>
        <button
          type="button"
          className={`${styles.outlineButton} ${crossLineEditMode === 'add' && crossLineControlMode === 'free' ? styles.active : ''}`}
          onClick={() => { setCrossLineEditMode('add'); setCrossLineControlMode('free'); }}
          title="自由创建：点击地图上两点，自由绘制断面"
          aria-label="自由创建断面"
        >
          <Plus size={14} /> 自由创建
        </button>
      </div>

      {selectedCrossLineIndex !== null && (
        <div className={styles.borderTopCard}>
          <div className={styles.flexBetween}>
            <span className={styles.crossTitle}>断面 #{selectedCrossLineIndex + 1}</span>
            <button
              type="button"
              onClick={deleteSelectedCrossLine}
              className={styles.dangerTextButton}
              title="删除断面"
              aria-label={`删除断面 ${selectedCrossLineIndex + 1}`}
            >
              <Trash2 size={16} />
            </button>
          </div>

          {crossLineControlMode === 'shoreline' && (
            <>
              <span className={styles.modeLabel}>沿线平移</span>
              <div className={styles.buttonGrid}>
                <button type="button" onClick={() => translateSelectedCrossLine(-5)} className={`${styles.outlineButton} ${styles.smallPad}`}>-5m</button>
                <button type="button" onClick={() => translateSelectedCrossLine(-1)} className={`${styles.outlineButton} ${styles.smallPad}`}>-1m</button>
                <button type="button" onClick={() => translateSelectedCrossLine(1)} className={`${styles.outlineButton} ${styles.smallPad}`}>+1m</button>
                <button type="button" onClick={() => translateSelectedCrossLine(5)} className={`${styles.outlineButton} ${styles.smallPad}`}>+5m</button>
              </div>
            </>
          )}

          <span className={styles.modeLabel}>旋转</span>
          <div className={styles.buttonGrid}>
            <button type="button" onClick={() => rotateSelectedCrossLine(-5)} className={`${styles.outlineButton} ${styles.smallPad}`} title="逆时针旋转 5°" aria-label="逆时针旋转">-5°</button>
            <button type="button" onClick={() => rotateSelectedCrossLine(5)} className={`${styles.outlineButton} ${styles.smallPad}`} title="顺时针旋转 5°" aria-label="顺时针旋转">+5°</button>
          </div>

          <span className={styles.modeLabel}>缩放</span>
          <div className={styles.buttonGrid}>
            <button type="button" onClick={() => scaleSelectedCrossLine(-10)} className={`${styles.outlineButton} ${styles.smallPad}`} title="缩短 10m" aria-label="缩短">-10m</button>
            <button type="button" onClick={() => scaleSelectedCrossLine(10)} className={`${styles.outlineButton} ${styles.smallPad}`} title="拉长 10m" aria-label="拉长">+10m</button>
          </div>

          <span className={styles.modeLabel}>其他</span>
          <div className={styles.buttonGrid}>
            <button type="button" onClick={() => reverseSelectedCrossLine()} className={styles.outlineButton} title="反转方向" aria-label="反转断面方向">
              <RotateCw size={14} /> 反切
            </button>
            <button type="button" onClick={() => configureSelectedCrossLineProperties()} className={styles.outlineButton} title="断面属性" aria-label="断面属性">
              <Settings size={14} /> 属性
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
