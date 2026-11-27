/**
 * 中键（滚轮键）拖动调整视角：纵向改俯仰角、横向改方位角。
 *
 * <h3>为什么不用 Mapbox 自带的 dragRotate</h3>
 * 那套**绑死在右键**（3.19 的 `DragRotateHandler` 只认 `button === 2`），且它的纵向行为是
 * 「绕着屏幕中心转地球」——想只调 pitch 时手会被迫画弧，微调很飘。三维软件（Blender / Cesium）
 * 的通用手感是**中键轨道**：上下拖改俯仰、左右拖转方位，这里照抄。
 *
 * <h3>两个必须处理的浏览器默认行为</h3>
 * <ol>
 *   <li>中键 `mousedown` 会进入**自动滚动**模式（Windows 上是那个四向圆盘），不
 *       `preventDefault` 的话松手后页面会自己滚。</li>
 *   <li>中键可能触发 `auxclick`（部分浏览器会拿它开新标签），一并掐掉。</li>
 * </ol>
 */
import type { Map as MapboxMap } from 'mapbox-gl';

export interface TiltStart {
  pitch: number;
  bearing: number;
}

export interface TiltResult {
  pitch: number;
  bearing: number;
}

/** 纵向灵敏度：1 px 改多少度。拖满 600 px 走完 0→85°，接近三维软件的行程。 */
export const PITCH_PER_PIXEL = 0.14;
/** 横向灵敏度：1 px 改多少度。比纵向钝一点，避免转方位时手抖。 */
export const BEARING_PER_PIXEL = 0.26;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** 把 bearing 归一化到 [-180, 180)，与 Mapbox 的约定一致。 */
function normalizeBearing(value: number): number {
  const wrapped = ((value % 360) + 360) % 360;
  return wrapped >= 180 ? wrapped - 360 : wrapped;
}

/**
 * 一次拖动的结果：**始终相对按下时的值**累加，不要在上一帧结果上叠 ——
 * 后者会把浮点误差和 clamp 的截断一起累积，拖回原点时回不到原始角度。
 *
 * @param dy 向下为正（浏览器坐标系）；向上拖 dy 为负 ⇒ pitch 增大（更倾斜）
 * @param dx 向右为正
 */
export function tiltFromDrag(
  start: TiltStart,
  dx: number,
  dy: number,
  maxPitch: number,
): TiltResult {
  return {
    pitch: clamp(start.pitch - dy * PITCH_PER_PIXEL, 0, maxPitch),
    bearing: normalizeBearing(start.bearing + dx * BEARING_PER_PIXEL),
  };
}

/**
 * 挂上中键拖动。返回解绑函数（建图 effect 的 cleanup 里调用）。
 *
 * <p>`mousemove`/`mouseup` 挂在 `window` 上而不是画布上：鼠标拖出画布再松手是很常见的，
 * 只挂画布会留下「拖动状态卡住、之后地图一直在倾斜」的幽灵 bug（框选那边踩过同款）。
 */
export function attachMiddleDragTilt(map: MapboxMap): () => void {
  const canvas = map.getCanvas();
  let drag: { x: number; y: number; pitch: number; bearing: number } | null = null;
  let prevCursor = '';
  let panWasEnabled = false;

  const onDown = (ev: MouseEvent) => {
    if (ev.button !== 1) return;
    // 掐掉自动滚动；不掐的话松手后页面会自己往下滚一屏
    ev.preventDefault();
    drag = { x: ev.clientX, y: ev.clientY, pitch: map.getPitch(), bearing: map.getBearing() };
    prevCursor = canvas.style.cursor;
    // `move` 而不是 `ns-resize`：纵向调俯仰、横向转方位，两个方向都能拖
    canvas.style.cursor = 'move';
    // 少数 Mapbox 版本对中键也会启动 dragPan，会和倾斜抢同一批移动事件 ⇒ 拖动期间关掉，
    // 松手按原状态恢复（框选模式本来就禁用了它，不能无条件 enable 回来）
    panWasEnabled = map.dragPan.isEnabled();
    if (panWasEnabled) map.dragPan.disable();
  };

  const onMove = (ev: MouseEvent) => {
    if (!drag) return;
    ev.preventDefault();
    const { pitch, bearing } = tiltFromDrag(
      drag,
      ev.clientX - drag.x,
      ev.clientY - drag.y,
      map.getMaxPitch(),
    );
    map.setPitch(pitch);
    map.setBearing(bearing);
  };

  const onUp = (ev: MouseEvent) => {
    if (ev.button !== 1 || !drag) return;
    drag = null;
    canvas.style.cursor = prevCursor;
    if (panWasEnabled) map.dragPan.enable();
  };

  /** 中键的 auxclick 在部分浏览器会开新标签 / 触发粘贴 */
  const onAuxClick = (ev: MouseEvent) => {
    if (ev.button === 1) ev.preventDefault();
  };

  canvas.addEventListener('mousedown', onDown);
  canvas.addEventListener('auxclick', onAuxClick);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);

  return () => {
    canvas.removeEventListener('mousedown', onDown);
    canvas.removeEventListener('auxclick', onAuxClick);
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    // 卸载时若正在拖动，别把 dragPan 锁死
    if (drag && panWasEnabled) map.dragPan.enable();
    drag = null;
  };
}
