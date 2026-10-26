/**
 * 地图「框选分析」结果面板（任务右键 → 分析）。
 *
 * <p>只做展示：不算数、不读接口。统计口径全部在 `map/areaRiskAnalysis.ts`，
 * 这里负责把「单位、分母、判定规则」写清楚 —— 用户看的是占比，必须知道分母是谁。
 *
 * <p>为什么做成浮在地图左上角的面板而不是弹窗：用户要一边看地图上的选区一边看数，
 * 弹窗会把选区挡掉一半；面板可滚动、可关闭，也不抢地图的左键。
 */
import { HelpCircle, Pentagon, RotateCcw, Square, X } from 'lucide-react';

import type { AreaRiskStats } from '../map/areaRiskAnalysis';

export type AreaAnalysisShape = 'rect' | 'polygon';

export interface AreaAnalysisPanelState {
  taskId: string;
  taskName: string;
  shape: AreaAnalysisShape;
  /** 已经画好的选区（矩形或多边形都算） */
  hasSelection: boolean;
  stats: AreaRiskStats | null;
}

interface Props {
  state: AreaAnalysisPanelState;
  /** 正在等用户画选区（面板上要给出"现在该做什么"的提示） */
  drawing: boolean;
  onShapeChange: (shape: AreaAnalysisShape) => void;
  /** 重新画：清掉当前选区并重新进入绘制 */
  onRedraw: () => void;
  onClose: () => void;
}

const fmtInt = (value: number): string => {
  if (!Number.isFinite(value)) return '-';
  return Math.round(value).toLocaleString('zh-CN');
};

const fmtPct = (ratio: number): string => {
  if (!Number.isFinite(ratio) || ratio <= 0) return '0.0%';
  const pct = ratio * 100;
  // 极小但非零的占比别显示成 0.0%（用户会以为漏了一条）
  if (pct < 0.05) return '<0.1%';
  return `${pct.toFixed(1)}%`;
};

const fmtAreaKm2 = (m2: number): string => {
  if (!Number.isFinite(m2) || m2 <= 0) return '-';
  const km2 = m2 / 1_000_000;
  return km2 >= 100 ? `${km2.toFixed(0)} km²` : `${km2.toFixed(2)} km²`;
};

export default function AreaRiskAnalysisPanel({
  state,
  drawing,
  onShapeChange,
  onRedraw,
  onClose,
}: Props) {
  const stats = state.stats;
  const shapeLabel = state.shape === 'polygon' ? '多边形' : '矩形';

  return (
    <div className="area-analysis-panel" data-tour="area-analysis-panel">
      <div className="aap-head">
        <div className="aap-title">
          <span>框选分析</span>
          <span className="aap-task" title={state.taskName}>{state.taskName}</span>
        </div>
        <button type="button" className="aap-icon-btn" onClick={onClose} title="关闭分析面板">
          <X size={14} />
        </button>
      </div>

      <div className="aap-shape">
        <span className="aap-shape-label">选区形状</span>
        <div className="aap-seg" role="group" aria-label="选区形状">
          <button
            type="button"
            className={state.shape === 'rect' ? 'is-active' : ''}
            onClick={() => onShapeChange('rect')}
            title="按住鼠标拖出矩形"
          >
            <Square size={12} /> 矩形
          </button>
          <button
            type="button"
            className={state.shape === 'polygon' ? 'is-active' : ''}
            onClick={() => onShapeChange('polygon')}
            title="单击逐点圈选，双击或回车闭合"
          >
            <Pentagon size={12} /> 多边形
          </button>
        </div>
      </div>

      {drawing && (
        <div className="aap-hint">
          {state.shape === 'polygon'
            ? '在地图上单击落点，双击或回车闭合；Esc / 右键放弃'
            : '在地图上按住鼠标拖出矩形；Esc / 右键放弃'}
        </div>
      )}

      {!state.hasSelection && !drawing && (
        <div className="aap-empty">
          还没有选区。点下方「重新绘制」，在地图上框出要统计的范围。
        </div>
      )}

      {state.hasSelection && stats && (
        <>
          <table className="aap-table">
            <thead>
              <tr>
                <th>风险等级</th>
                <th className="num">断面数</th>
                <th className="num">长度 (m)</th>
                <th className="num">长度占比</th>
              </tr>
            </thead>
            <tbody>
              {stats.rows.map((row) => (
                <tr key={row.key} className={row.rendered ? '' : 'is-muted'}>
                  <td>
                    <span className="aap-dot" style={{ background: row.color }} />
                    {row.label}
                    {!row.rendered && <span className="aap-tag">图上为灰色虚线</span>}
                  </td>
                  <td className="num">
                    {row.sectionCount}
                    <span className="aap-sub">{fmtPct(row.sectionRatio)}</span>
                  </td>
                  <td className="num">{fmtInt(row.lengthM)}</td>
                  <td className="num">{fmtPct(row.lengthRatio)}</td>
                </tr>
              ))}
              <tr className="aap-total">
                <td>合计</td>
                <td className="num">{stats.sectionCount}</td>
                <td className="num">{fmtInt(stats.totalLengthM)}</td>
                <td className="num">100%</td>
              </tr>
            </tbody>
          </table>

          <div className="aap-meta">
            <span>选区面积 <b>{fmtAreaKm2(stats.areaM2)}</b></span>
            <span>岸段 <b>{stats.bankCount}</b> 条</span>
          </div>
        </>
      )}

      <div className="aap-actions">
        <button type="button" className="aap-btn" onClick={onRedraw}>
          <RotateCcw size={12} /> 重新绘制
        </button>
        <span className="aap-shape-now">{shapeLabel}</span>
      </div>

      <details className="aap-notes">
        <summary><HelpCircle size={12} /> 统计口径与单位</summary>
        <ul>
          <li><b>长度</b>：沿<b>岸段折线</b>的球面长度，单位<b>米</b>。取值方式与图上色带一致 ——
            断面几何中点投影到岸线、以相邻断面中点为界切段，再把每段裁剪到选区内累加。
            所以「图上那一段颜色多长，这里就是多少米」。</li>
          <li><b>长度占比</b>：该等级长度 ÷ 选区内岸段总长。<b>断面数</b>：断面几何与选区
            <b>相交</b>即计入（贴边穿过也算，不要求中点落在里面）。</li>
          <li><b>低风险 / 未计算</b>：这两档在图上是<b>不着色</b>的，但长度仍计入分母 ——
            否则「高风险 60%」会因为分母只剩着色段而虚高成 100%。</li>
          <li><b>面积</b>：球面多边形面积，按 km² 显示，只描述选区大小，不参与占比。</li>
          <li><b>等级来源</b>：取任务<b>已落库的</b> <code>risk_level</code>（与出图、报告同源）。
            若结果页按自定义阈值重算过、但任务没有重跑，两边可能差一档。</li>
        </ul>
      </details>
    </div>
  );
}
